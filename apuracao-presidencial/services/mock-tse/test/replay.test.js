import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carregarGravacao, criarReplay, epochBrasilia } from '../src/replay.js';
import { montarArquivo } from '../src/simulacao.js';

let dir;
const T0 = new Date('2026-10-04T20:00:00Z'); // 17:00 em Brasília

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gravacao-'));
  // Três versões de SP, com 60 s de intervalo no "TSE".
  await mkdir(join(dir, 'SP'));
  for (const [i, x] of [0.1, 0.5, 1].entries()) {
    const geradoEm = new Date(T0.getTime() + i * 60_000);
    const arquivo = montarArquivo({ abr: 'SP', x, geradoEm, eleicao: '619', turno: 1 });
    await writeFile(join(dir, 'SP', `v${i}.json`), JSON.stringify(arquivo));
  }
});
after(() => rm(dir, { recursive: true, force: true }));

test('converte data/hora de Brasília para epoch', () => {
  assert.equal(epochBrasilia('04/10/2026', '17:00:00'), T0.getTime());
});

test('carrega a gravação ordenada e extrai eleição e turno', async () => {
  const g = await carregarGravacao(dir);
  assert.equal(g.eleicao, '619');
  assert.equal(g.turno, '1');
  assert.equal(g.porAbrangencia.get('SP').length, 3);
  assert.equal(g.tFim - g.t0, 120_000);
});

test('serve a versão proporcional ao tempo e reescreve a data de geração', async () => {
  const g = await carregarGravacao(dir);
  const inicio = Date.UTC(2026, 9, 5, 12, 0, 0); // 09:00 em Brasília
  const r = criarReplay(g, { velocidade: 10, inicio });
  assert.equal(r.duracaoMs, 12_000);

  assert.equal(r.arquivo('SP', inicio).st, g.porAbrangencia.get('SP')[0].arquivo.st);
  assert.equal(r.arquivo('SP', inicio).hg, '09:00:00');

  const meio = r.arquivo('SP', inicio + 6_500); // 65 s simulados -> 2ª versão
  assert.equal(meio.st, g.porAbrangencia.get('SP')[1].arquivo.st);
  assert.equal(meio.hg, '09:00:06');

  const fim = r.arquivo('SP', inicio + 60_000); // depois do fim, fica na última versão
  assert.equal(fim.pst, '100,00');
  assert.equal(r.arquivo('RJ', inicio), null);
});
