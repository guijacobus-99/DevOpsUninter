#!/usr/bin/env node
// Ferramenta de linha de comando para trabalhar com o feed de resultados (TSE ou simulador).
//
//   validar  baixa os 29 arquivos uma vez, compara o layout com o que o adaptador espera e
//            roda as mesmas regras de qualidade do ingestor. Sai com código 1 se algo falhar.
//   gravar   baixa os arquivos em laço e salva cada versão nova, byte a byte, para ser
//            reproduzida depois pelo simulador (modo replay).
//
// Exemplos:
//   node src/cli/feed.js validar
//   node src/cli/feed.js validar --eleicao 619 --turno 1
//   node src/cli/feed.js gravar --saida ../../gravacoes/2026-10-04 --intervalo 15 --parar-em-100
//   node src/cli/feed.js validar --base http://localhost:8081/oficial --eleicao 9001
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as dormir } from 'node:timers/promises';
import { ABRANGENCIAS } from '../config.js';
import { normalizar } from '../normalizar.js';
import { validar } from '../validar.js';

// Campos que normalizar.js lê. Se o TSE mudar o layout, a diferença aparece aqui primeiro.
const CAMPOS_RAIZ = ['ele', 'cdabr', 't', 'dg', 'hg', 's', 'st', 'pst', 'e', 'ea', 'c', 'pc', 'a', 'pa', 'vvc', 'vb', 'tvn', 'cand'];
const CAMPOS_CANDIDATO = ['n', 'nm', 'cc', 'vap', 'pvap', 'e', 'st'];

const { positionals, values: opcoes } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string', default: 'https://resultados.tse.jus.br/oficial' },
    ano: { type: 'string', default: '2026' },
    eleicao: { type: 'string' },
    turno: { type: 'string', default: '1' },
    'url-template': { type: 'string' },
    saida: { type: 'string' },
    intervalo: { type: 'string', default: '15' },
    'parar-em-100': { type: 'boolean', default: false },
    ajuda: { type: 'boolean', short: 'h', default: false },
  },
});

const comando = positionals[0];
if (opcoes.ajuda || !['validar', 'gravar'].includes(comando)) {
  console.log(`uso: feed.js <validar|gravar> [--base URL] [--ano 2026] [--eleicao CODIGO] [--turno 1]
                 [--url-template T] [--saida DIR] [--intervalo SEG] [--parar-em-100]

  --base          raiz do feed (padrão: https://resultados.tse.jus.br/oficial)
  --eleicao       código da eleição; sem ele, tenta descobrir pelo comum/config/ele-c.json
  --url-template  padrão de URL, com {base} {ano} {eleicao} {eleicao6} {abr}
  --saida         (gravar) diretório onde salvar as versões dos arquivos
  --intervalo     (gravar) segundos entre ciclos de coleta
  --parar-em-100  (gravar) encerra quando o arquivo BR chegar a 100% das seções`);
  process.exit(opcoes.ajuda ? 0 : 2);
}

const template =
  opcoes['url-template'] ?? '{base}/ele{ano}/{eleicao}/dados-simplificados/{abr}/{abr}-c0001-e{eleicao6}-r.json';
const turno = Number(opcoes.turno);

async function obterJson(url, headers = {}) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'apuracao-presidencial-feed/1.0', ...headers }, signal: AbortSignal.timeout(10_000) });
  return resp;
}

// O layout do ele-c.json não está documentado aqui; em vez de assumir uma estrutura, procura
// recursivamente objetos que pareçam descrever uma eleição (têm "cd" e algum nome/turno).
function eleicoesNoConfig(no, achadas = []) {
  if (Array.isArray(no)) no.forEach((x) => eleicoesNoConfig(x, achadas));
  else if (no && typeof no === 'object') {
    if (no.cd !== undefined && (no.nm || no.ds || no.t)) {
      achadas.push({ cd: String(no.cd), turno: no.t, nome: no.nm ?? no.ds ?? '', data: no.dt ?? '' });
    }
    Object.values(no).forEach((x) => eleicoesNoConfig(x, achadas));
  }
  return achadas;
}

async function descobrirEleicao() {
  if (opcoes.eleicao) return opcoes.eleicao;
  const url = `${opcoes.base}/comum/config/ele-c.json`;
  console.log(`Sem --eleicao: consultando ${url}`);
  const resp = await obterJson(url);
  if (!resp.ok) throw new Error(`ele-c.json respondeu HTTP ${resp.status}; informe --eleicao`);
  const texto = await resp.text();
  if (opcoes.saida) {
    await mkdir(opcoes.saida, { recursive: true });
    await writeFile(join(opcoes.saida, 'ele-c.json'), texto);
  }
  const achadas = eleicoesNoConfig(JSON.parse(texto));
  console.table(achadas);
  const candidatas = achadas.filter((e) => String(e.turno) === String(turno) && /federal|geral|presid/i.test(e.nome));
  if (candidatas.length === 1) {
    console.log(`Usando a eleição ${candidatas[0].cd} (${candidatas[0].nome}).`);
    return candidatas[0].cd;
  }
  throw new Error('Não foi possível escolher a eleição automaticamente; veja a tabela acima e informe --eleicao');
}

function urlDe(eleicao, abr) {
  return template
    .replaceAll('{base}', opcoes.base)
    .replaceAll('{ano}', opcoes.ano)
    .replaceAll('{eleicao}', eleicao)
    .replaceAll('{eleicao6}', eleicao.padStart(6, '0'))
    .replaceAll('{abr}', abr.toLowerCase());
}

const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');

function compararLayout(bruto) {
  const raiz = Object.keys(bruto);
  const cand = Array.isArray(bruto.cand) && bruto.cand[0] ? Object.keys(bruto.cand[0]) : [];
  return {
    ausentes: [
      ...CAMPOS_RAIZ.filter((c) => !raiz.includes(c)),
      ...(cand.length ? CAMPOS_CANDIDATO.filter((c) => !cand.includes(c)).map((c) => `cand[].${c}`) : []),
    ],
    extras: [...raiz.filter((c) => !CAMPOS_RAIZ.includes(c)), ...cand.filter((c) => !CAMPOS_CANDIDATO.includes(c)).map((c) => `cand[].${c}`)],
  };
}

async function comandoValidar() {
  const eleicao = await descobrirEleicao();
  const esperado = { eleicao, turno };
  const linhas = [];
  const ausentesGerais = new Set();
  const extrasGerais = new Set();
  let falhas = 0;

  for (const abr of ABRANGENCIAS) {
    const url = urlDe(eleicao, abr);
    try {
      const resp = await obterJson(url);
      if (!resp.ok) {
        falhas++;
        linhas.push({ abr, http: resp.status, secoes: '', geradoEm: '', problemas: url });
        continue;
      }
      const corpo = await resp.text();
      const bruto = JSON.parse(corpo);
      const { ausentes, extras } = compararLayout(bruto);
      ausentes.forEach((c) => ausentesGerais.add(c));
      extras.forEach((c) => extrasGerais.add(c));
      const modelo = normalizar(bruto, { fonte: 'validacao', hash: sha256(corpo) });
      const { bloqueantes, alertas } = validar(modelo, null, esperado);
      if (bloqueantes.length > 0 || ausentes.length > 0) falhas++;
      linhas.push({
        abr,
        http: resp.status,
        secoes: `${modelo.secoes.pct}%`,
        geradoEm: modelo.geradoEm ?? '?',
        problemas: [...bloqueantes, ...alertas].map((v) => `${v.regra}: ${v.detalhe}`).join(' | ') || 'ok',
      });
    } catch (err) {
      falhas++;
      linhas.push({ abr, http: 'erro', secoes: '', geradoEm: '', problemas: err.message });
    }
  }

  console.table(linhas);
  console.log(`\nCampos que o adaptador espera e NÃO vieram: ${[...ausentesGerais].join(', ') || 'nenhum'}`);
  console.log(`Campos que vieram e o adaptador ignora:   ${[...extrasGerais].join(', ') || 'nenhum'}`);
  console.log(falhas === 0 ? '\n✔ Layout compatível e todas as regras passaram.' : `\n✘ ${falhas} abrangência(s) com problema.`);
  process.exit(falhas === 0 ? 0 : 1);
}

async function comandoGravar() {
  if (!opcoes.saida) throw new Error('informe --saida DIR');
  const eleicao = await descobrirEleicao();
  const intervaloMs = Number(opcoes.intervalo) * 1000;
  const estado = new Map(); // abr -> { hash, etag, ultimaModificacao }
  let rodando = true;
  let versoes = 0;
  process.on('SIGINT', () => {
    rodando = false;
    console.log('\nEncerrando após o ciclo atual...');
  });

  await mkdir(opcoes.saida, { recursive: true });
  console.log(`Gravando em ${opcoes.saida} a cada ${opcoes.intervalo}s (Ctrl+C para parar).`);

  while (rodando) {
    const inicio = Date.now();
    let pctBR = null;
    for (const abr of ABRANGENCIAS) {
      const anterior = estado.get(abr) ?? {};
      const headers = {};
      if (anterior.etag) headers['If-None-Match'] = anterior.etag;
      if (anterior.ultimaModificacao) headers['If-Modified-Since'] = anterior.ultimaModificacao;
      try {
        const resp = await obterJson(urlDe(eleicao, abr), headers);
        if (resp.status === 304 || !resp.ok) continue;
        const corpo = await resp.text();
        const hash = sha256(corpo);
        if (hash === anterior.hash) continue;
        const bruto = JSON.parse(corpo);
        // Nome ordenável pela data/hora de geração no TSE: AAAAMMDDTHHMMSS-hash.json
        const [d, m, a] = String(bruto.dg ?? '00/00/0000').split('/');
        const carimbo = `${a}${m}${d}T${String(bruto.hg ?? '00:00:00').replaceAll(':', '')}`;
        await mkdir(join(opcoes.saida, abr), { recursive: true });
        await writeFile(join(opcoes.saida, abr, `${carimbo}-${hash.slice(0, 8)}.json`), corpo);
        estado.set(abr, { hash, etag: resp.headers.get('etag'), ultimaModificacao: resp.headers.get('last-modified') });
        versoes++;
        if (abr === 'BR') pctBR = bruto.pst;
      } catch (err) {
        console.warn(`  ${abr}: ${err.message}`);
      }
    }
    console.log(`${new Date().toISOString()}  versões salvas: ${versoes}${pctBR ? `  (BR ${pctBR}% das seções)` : ''}`);
    if (opcoes['parar-em-100'] && pctBR === '100,00') break;
    await dormir(Math.max(0, intervaloMs - (Date.now() - inicio)));
  }
  console.log(`Gravação encerrada: ${versoes} versões em ${opcoes.saida}`);
}

(comando === 'validar' ? comandoValidar() : comandoGravar()).catch((err) => {
  console.error(`erro: ${err.message}`);
  process.exit(1);
});
