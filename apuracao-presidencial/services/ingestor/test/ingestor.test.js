import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarIngestor } from '../src/ingestor.js';
import { arquivoTse } from './fixtures.js';

const config = { eleicao: '9001', turno: 1, fonteNome: 'teste', concorrencia: 2 };
const logMudo = { info() {}, warn() {}, error() {} };

function montar() {
  const respostas = [];
  const brutos = [];
  const apuracoes = [];
  const publicados = [];
  const falhas = { redis: 0 };
  const ingestor = criarIngestor({
    config,
    log: logMudo,
    buscar: async () => respostas.shift() ?? { tipo: 'nao_modificado' },
    repo: {
      registrarBruto: async (r) => { if (!brutos.some((b) => b.hash === r.hash)) brutos.push(r); },
      salvarApuracao: async (mdl) => { if (!apuracoes.some((a) => a.geradoEm === mdl.geradoEm)) apuracoes.push(mdl); },
      ultimasApuracoes: async () => [],
    },
    pub: {
      publicar: async (mdl) => {
        if (falhas.redis > 0) { falhas.redis--; throw new Error('redis fora'); }
        publicados.push(mdl);
      },
    },
  });
  const servir = (obj) => respostas.push({ tipo: 'ok', corpo: JSON.stringify(obj), etag: `"${respostas.length}"` });
  return { ingestor, servir, brutos, apuracoes, publicados, falhas };
}

test('snapshot válido é gravado nas duas camadas e publicado', async () => {
  const t = montar();
  t.servir(arquivoTse());
  await t.ingestor.processar('SP');
  assert.equal(t.brutos[0].status, 'aceito');
  assert.equal(t.apuracoes.length, 1);
  assert.equal(t.publicados[0].abrangencia, 'SP');
});

test('conteúdo idêntico é descartado como duplicado', async () => {
  const t = montar();
  t.servir(arquivoTse());
  t.servir(arquivoTse());
  await t.ingestor.processar('SP');
  await t.ingestor.processar('SP');
  assert.equal(t.publicados.length, 1);
  assert.equal(t.brutos.length, 1);
});

test('snapshot inconsistente é auditado mas não publicado; o seguinte válido passa', async () => {
  const t = montar();
  t.servir(arquivoTse({ vvc: '1' }));
  t.servir(arquivoTse());
  await t.ingestor.processar('SP');
  assert.equal(t.publicados.length, 0);
  assert.equal(t.brutos[0].status, 'rejeitado');
  await t.ingestor.processar('SP');
  assert.equal(t.publicados.length, 1);
});

test('snapshot com data de geração anterior à publicada é ignorado', async () => {
  const t = montar();
  t.servir(arquivoTse({ hg: '18:40:00' }));
  t.servir(arquivoTse({ hg: '18:30:00' }));
  await t.ingestor.processar('SP');
  await t.ingestor.processar('SP');
  assert.equal(t.publicados.length, 1);
  assert.equal(t.brutos[1].status, 'desatualizado');
  assert.equal(t.ingestor.estado.get('SP').modelo.geradoEm, '2026-10-04T18:40:00-03:00');
});

test('falha no Redis não avança o estado: o mesmo snapshot é reprocessado sem duplicar gravações', async () => {
  const t = montar();
  t.falhas.redis = 1;
  t.servir(arquivoTse());
  await assert.rejects(t.ingestor.processar('SP'), /redis fora/);
  assert.equal(t.ingestor.estado.get('SP'), undefined);

  t.servir(arquivoTse()); // sem ETag avançado, a fonte devolve o mesmo conteúdo
  await t.ingestor.processar('SP');
  assert.equal(t.publicados.length, 1);
  assert.equal(t.brutos.length, 1);
  assert.equal(t.apuracoes.length, 1);
});

test('séries de contadores nascem zeradas, para o primeiro incremento ser visto pelo increase()', async () => {
  montar();
  const { registro } = await import('../src/metricas.js');
  const texto = await registro.metrics();
  assert.match(texto, /ingestor_snapshots_total\{abrangencia="RR",status="rejeitado"\} 0/);
  assert.match(texto, /ingestor_violacoes_total\{abrangencia="ZZ",regra="regressao_votos",severidade="alerta"\} 0/);
  assert.match(texto, /ingestor_falhas_persistencia_total\{destino="postgres"\} \d/);
});
