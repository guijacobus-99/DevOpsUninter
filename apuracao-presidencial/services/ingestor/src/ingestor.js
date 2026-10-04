// Pipeline de um snapshot: coleta -> deduplicação -> normalização -> validação ->
// persistência (bruto + normalizado) -> publicação.
//
// O estado em memória (hash/ETag/último modelo) só avança depois que o snapshot foi
// totalmente processado. Se o Postgres ou o Redis falharem no meio do caminho, o mesmo
// snapshot é baixado e reprocessado no próximo ciclo; as gravações são idempotentes.
import { createHash } from 'node:crypto';
import { ABRANGENCIAS } from './config.js';
import { normalizar } from './normalizar.js';
import { REGRAS, validar } from './validar.js';
import * as m from './metricas.js';

const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');

async function emDestino(destino, fn) {
  try {
    return await fn();
  } catch (err) {
    m.falhasPersistencia.inc({ destino });
    err.destino = destino;
    throw err;
  }
}

const REPUBLICAR_A_CADA_MS = 60_000;

export function criarIngestor({ buscar, repo, pub, config, log }) {
  const estado = new Map(); // abrangência -> { modelo, hash, etag, ultimaModificacao }
  const esperado = { eleicao: config.eleicao, turno: config.turno };
  let ultimaRepublicacao = Date.now();
  m.inicializarSeries(ABRANGENCIAS, REGRAS);

  function aceitar(abr, modelo) {
    m.pctSecoes.set({ abrangencia: abr }, modelo.secoes.pct);
    m.registrarGeradoEm(abr, modelo.geradoEm);
    for (const c of modelo.candidatos) {
      m.votosCandidato.set({ abrangencia: abr, candidato: String(c.numero) }, c.votos);
    }
  }

  async function reidratar() {
    for (const linha of await repo.ultimasApuracoes()) {
      estado.set(linha.abrangencia, { modelo: linha.modelo, hash: linha.hash });
      await pub.publicar(linha.modelo);
      aceitar(linha.abrangencia, linha.modelo);
    }
    log.info('estado reidratado a partir do Postgres', { abrangencias: estado.size });
  }

  async function processar(abr) {
    const atual = estado.get(abr) ?? {};
    const r = await buscar(abr, atual);

    if (r.tipo !== 'ok') {
      m.coletas.inc({ abrangencia: abr, resultado: r.tipo });
      if (r.tipo !== 'nao_modificado') log.warn('falha na coleta', { abrangencia: abr, ...r });
      return;
    }

    const hash = sha256(r.corpo);
    const avancar = (extra = {}) =>
      estado.set(abr, { ...atual, hash, etag: r.etag, ultimaModificacao: r.ultimaModificacao, ...extra });

    if (hash === atual.hash) {
      m.coletas.inc({ abrangencia: abr, resultado: 'duplicado' });
      avancar();
      return;
    }
    m.coletas.inc({ abrangencia: abr, resultado: 'novo' });

    let bruto = null;
    try {
      bruto = JSON.parse(r.corpo);
    } catch {
      // tratado abaixo como violação de esquema
    }
    const modelo = bruto && typeof bruto === 'object' ? normalizar(bruto, { fonte: config.fonteNome, hash }) : null;
    const { bloqueantes, alertas } = modelo
      ? validar(modelo, atual.modelo, esperado)
      : { bloqueantes: [{ regra: 'esquema', detalhe: 'JSON inválido' }], alertas: [] };

    const registro = {
      abrangencia: abr,
      hash,
      geradoEm: modelo?.geradoEm ?? null,
      payload: bruto ?? { corpo_invalido: r.corpo.slice(0, 2000) },
    };

    if (bloqueantes.length > 0) {
      bloqueantes.forEach((v) => m.violacoes.inc({ abrangencia: abr, regra: v.regra, severidade: 'bloqueante' }));
      const motivo = bloqueantes.map((v) => `${v.regra}: ${v.detalhe}`).join(' | ');
      await emDestino('postgres', () => repo.registrarBruto({ ...registro, status: 'rejeitado', motivo }));
      m.snapshots.inc({ abrangencia: abr, status: 'rejeitado' });
      log.warn('snapshot rejeitado; mantendo o último válido', { abrangencia: abr, motivo });
      avancar();
      return;
    }

    // A CDN do TSE pode servir uma cópia antiga em algum ponto de presença: nunca voltar no tempo.
    if (atual.modelo && Date.parse(modelo.geradoEm) <= Date.parse(atual.modelo.geradoEm)) {
      await emDestino('postgres', () => repo.registrarBruto({ ...registro, status: 'desatualizado', motivo: null }));
      m.snapshots.inc({ abrangencia: abr, status: 'desatualizado' });
      log.warn('snapshot mais antigo que o publicado; ignorado', {
        abrangencia: abr, recebido: modelo.geradoEm, publicado: atual.modelo.geradoEm,
      });
      avancar();
      return;
    }

    alertas.forEach((v) => m.violacoes.inc({ abrangencia: abr, regra: v.regra, severidade: 'alerta' }));
    if (alertas.length > 0) log.warn('snapshot publicado com alertas', { abrangencia: abr, alertas });

    const motivo = alertas.length > 0 ? alertas.map((v) => `${v.regra}: ${v.detalhe}`).join(' | ') : null;
    await emDestino('postgres', () => repo.registrarBruto({ ...registro, status: 'aceito', motivo }));
    await emDestino('postgres', () => repo.salvarApuracao(modelo, hash));
    await emDestino('redis', () => pub.publicar(modelo));

    avancar({ modelo });
    m.snapshots.inc({ abrangencia: abr, status: 'aceito' });
    aceitar(abr, modelo);
  }

  // O arquivo BR e os das UFs são gerados em momentos ligeiramente diferentes, então uma
  // divergência curta é normal; o alerta só dispara se ela persistir.
  function medirDivergencia() {
    const br = estado.get('BR')?.modelo;
    const filhas = ABRANGENCIAS.filter((a) => a !== 'BR').map((a) => estado.get(a)?.modelo);
    if (!br || filhas.some((f) => !f)) return;
    const soma = (ler) => filhas.reduce((s, f) => s + ler(f), 0);
    m.divergencia.set({ campo: 'votos_validos' }, Math.abs(br.votos.validos - soma((f) => f.votos.validos)));
    m.divergencia.set({ campo: 'secoes_totalizadas' }, Math.abs(br.secoes.totalizadas - soma((f) => f.secoes.totalizadas)));
  }

  // Anti-entropia: se o Redis reiniciar vazio depois do fim da apuração (quando não chegam
  // mais snapshots novos), a republicação periódica restaura as chaves.
  async function republicar() {
    if (Date.now() - ultimaRepublicacao < REPUBLICAR_A_CADA_MS) return;
    try {
      for (const { modelo } of estado.values()) if (modelo) await pub.publicar(modelo);
      ultimaRepublicacao = Date.now();
    } catch (err) {
      m.falhasPersistencia.inc({ destino: 'redis' });
      log.error('falha na republicação periódica', { erro: err.message });
    }
  }

  async function ciclo() {
    const fimTimer = m.duracaoCiclo.startTimer();
    const fila = [...ABRANGENCIAS];
    const trabalhador = async () => {
      for (let abr = fila.shift(); abr; abr = fila.shift()) {
        try {
          await processar(abr);
        } catch (err) {
          log.error('falha ao processar snapshot; será reprocessado', { abrangencia: abr, destino: err.destino, erro: err.message });
        }
      }
    };
    await Promise.all(Array.from({ length: config.concorrencia }, trabalhador));
    medirDivergencia();
    await republicar();
    fimTimer();
    m.ultimoCiclo.setToCurrentTime();
  }

  return { ciclo, processar, reidratar, estado };
}
