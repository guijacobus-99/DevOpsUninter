// Cópia em memória de todos os snapshots publicados (29 JSONs pequenos).
// Nenhuma requisição de usuário toca o Redis: a memória é atualizada por pub/sub e por
// uma ressincronização periódica (pub/sub do Redis não garante entrega).
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { ABRANGENCIAS } from './abrangencias.js';

const CANAL = 'resultado:atualizado';

function resumir(modelo) {
  const [lider, segundo] = modelo.candidatos;
  const resumo = (c) => c && { numero: c.numero, nome: c.nome, pct: c.pct, votos: c.votos };
  return {
    abrangencia: modelo.abrangencia,
    geradoEm: modelo.geradoEm,
    pctSecoes: modelo.secoes.pct,
    lider: resumo(lider),
    segundo: resumo(segundo),
  };
}

export function criarMemoria({ redisUrl, intervaloResyncMs = 30_000, log }) {
  const snapshots = new Map(); // abr -> { corpo, etag, modelo }
  let resumo = null; // { corpo, etag }
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const assinante = new Redis(redisUrl);
  for (const conexao of [redis, assinante]) conexao.on('error', (err) => log.warn('redis', { erro: err.message }));

  function guardar(abr, json) {
    const modelo = JSON.parse(json);
    if (snapshots.get(abr)?.modelo.versao === modelo.versao) return false;
    snapshots.set(abr, { corpo: json, etag: `"${modelo.versao}"`, modelo });
    return true;
  }

  function recalcularResumo() {
    const itens = ABRANGENCIAS.filter((a) => snapshots.has(a)).map((a) => resumir(snapshots.get(a).modelo));
    const corpo = JSON.stringify({ abrangencias: itens });
    resumo = { corpo, etag: `"${createHash('sha1').update(corpo).digest('hex').slice(0, 16)}"` };
  }

  async function carregar(abr) {
    const json = await redis.get(`resultado:${abr}`);
    return json ? guardar(abr, json) : false;
  }

  async function sincronizarTudo() {
    const valores = await redis.mget(ABRANGENCIAS.map((a) => `resultado:${a}`));
    let mudou = false;
    valores.forEach((json, i) => { if (json) mudou = guardar(ABRANGENCIAS[i], json) || mudou; });
    if (mudou || !resumo) recalcularResumo();
  }

  let timer;
  return {
    async iniciar() {
      await assinante.subscribe(CANAL);
      assinante.on('message', async (_canal, abr) => {
        try {
          if (ABRANGENCIAS.includes(abr) && (await carregar(abr))) recalcularResumo();
        } catch (err) {
          log.warn('falha ao carregar snapshot notificado', { abrangencia: abr, erro: err.message });
        }
      });
      await sincronizarTudo();
      timer = setInterval(() => sincronizarTudo().catch((err) => log.warn('falha na ressincronização', { erro: err.message })), intervaloResyncMs);
    },
    obter: (abr) => snapshots.get(abr),
    resumo: () => resumo,
    snapshots,
    pronto: () => snapshots.has('BR'),
    async fechar() {
      clearInterval(timer);
      await Promise.allSettled([redis.quit(), assinante.quit()]);
    },
  };
}
