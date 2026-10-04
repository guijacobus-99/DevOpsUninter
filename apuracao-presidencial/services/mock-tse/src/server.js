// Servidor que imita os arquivos "dados simplificados" do TSE para testes locais.
// Rota: /oficial/ele2026/{eleicao}/dados-simplificados/{abr}/{abr}-c0001-e{eleicao6}-r.json
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { ABRANGENCIAS_FILHAS, montarArquivo } from './simulacao.js';

const PORTA = Number(process.env.PORT ?? 8080);
const ELEICAO = process.env.ELEICAO ?? '9001';
const TURNO = Number(process.env.TURNO ?? 1);
const DURACAO_S = Number(process.env.SIM_DURACAO_S ?? 900); // tempo até 100% das seções
const INTERVALO_GERACAO_S = Number(process.env.SIM_INTERVALO_GERACAO_S ?? 10);
const FALHA_5XX = Number(process.env.FALHA_TAXA_5XX ?? 0);
const FALHA_INCONSISTENTE = Number(process.env.FALHA_TAXA_INCONSISTENTE ?? 0);

const ABRANGENCIAS = new Set(['BR', ...ABRANGENCIAS_FILHAS]);
const inicio = Date.now();
const ROTA = /^\/oficial\/ele\d{4}\/(\d+)\/dados-simplificados\/([a-z]{2})\/\2-c0001-e(\d{6})-r\.json$/;

function arquivoAtual(abr) {
  // O TSE regenera os arquivos em intervalos; entre duas gerações o conteúdo não muda.
  const decorrido = Math.min((Date.now() - inicio) / 1000, DURACAO_S);
  const instante = Math.floor(decorrido / INTERVALO_GERACAO_S) * INTERVALO_GERACAO_S;
  return montarArquivo({
    abr,
    x: instante / DURACAO_S,
    geradoEm: new Date(inicio + instante * 1000),
    eleicao: ELEICAO,
    turno: TURNO,
  });
}

function responder(res, status, corpo, headers = {}) {
  res.writeHead(status, headers);
  res.end(corpo);
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return responder(res, 200, 'ok');

  const m = ROTA.exec(url.pathname);
  const abr = m?.[2].toUpperCase();
  if (!m || m[1] !== ELEICAO || m[3] !== ELEICAO.padStart(6, '0') || !ABRANGENCIAS.has(abr)) {
    return responder(res, 404, 'not found');
  }

  // Injeção de falhas para exercitar retry, validação e alertas.
  if (Math.random() < FALHA_5XX) return responder(res, 503, 'service unavailable');
  const arquivo = arquivoAtual(abr);
  if (Math.random() < FALHA_INCONSISTENTE) {
    arquivo.cand[0].vap = String(Number(arquivo.cand[0].vap) + 1000);
  }

  const corpo = JSON.stringify(arquivo);
  const etag = `"${createHash('sha1').update(corpo).digest('hex')}"`;
  if (req.headers['if-none-match'] === etag) return responder(res, 304, undefined, { ETag: etag });

  responder(res, 200, corpo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=5',
    ETag: etag,
  });
});

servidor.listen(PORTA, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), nivel: 'info', msg: 'mock-tse no ar', porta: PORTA, eleicao: ELEICAO, duracaoS: DURACAO_S }));
});

process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
