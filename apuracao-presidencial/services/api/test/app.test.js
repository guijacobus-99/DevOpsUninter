import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarApp } from '../src/app.js';

const modeloBR = { abrangencia: 'BR', versao: 'v1', geradoEm: '2026-10-04T18:00:00-03:00', candidatos: [] };
const memoria = {
  obter: (abr) => (abr === 'BR' ? { corpo: JSON.stringify(modeloBR), etag: '"v1"', modelo: modeloBR } : undefined),
  resumo: () => ({ corpo: '{"abrangencias":[]}', etag: '"r1"' }),
  pronto: () => true,
};

let servidor;
let base;
before(async () => {
  servidor = createServer(criarApp(memoria));
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

test('serve o snapshot com cabeçalhos de cache para a CDN', async () => {
  const r = await fetch(`${base}/api/v1/resultados/br`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=5/);
  assert.match(r.headers.get('cache-control'), /stale-if-error/);
  assert.equal(r.headers.get('etag'), '"v1"');
  assert.equal((await r.json()).abrangencia, 'BR');
});

test('responde 304 quando o ETag não mudou', async () => {
  const r = await fetch(`${base}/api/v1/resultados/BR`, { headers: { 'If-None-Match': '"v1"' } });
  assert.equal(r.status, 304);
});

test('abrangência válida ainda sem dados responde 503 sem cache', async () => {
  const r = await fetch(`${base}/api/v1/resultados/sp`);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('abrangência inexistente responde 404', async () => {
  const r = await fetch(`${base}/api/v1/resultados/xx`);
  assert.equal(r.status, 404);
});

test('rejeita métodos de escrita', async () => {
  const r = await fetch(`${base}/api/v1/resultados/br`, { method: 'POST' });
  assert.equal(r.status, 405);
});

test('expõe métricas no formato Prometheus', async () => {
  const texto = await (await fetch(`${base}/metrics`)).text();
  assert.match(texto, /http_requisicoes_total\{rota="\/api\/v1\/resultados\/:abr",status="200"\}/);
});
