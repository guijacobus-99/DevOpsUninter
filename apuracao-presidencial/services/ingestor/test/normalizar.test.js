import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataHoraIso, inteiro, normalizar, percentual } from '../src/normalizar.js';
import { arquivoTse } from './fixtures.js';

test('inteiro aceita só dígitos', () => {
  assert.equal(inteiro('156454011'), 156454011);
  assert.ok(Number.isNaN(inteiro('1.000')));
  assert.ok(Number.isNaN(inteiro('')));
  assert.ok(Number.isNaN(inteiro(undefined)));
  assert.ok(Number.isNaN(inteiro('-5')));
});

test('percentual converte vírgula decimal', () => {
  assert.equal(percentual('50,90'), 50.9);
  assert.equal(percentual('100'), 100);
  assert.ok(Number.isNaN(percentual('50.90')));
});

test('data/hora de Brasília vira ISO 8601 com offset', () => {
  assert.equal(dataHoraIso('04/10/2026', '19:42:10'), '2026-10-04T19:42:10-03:00');
  assert.equal(dataHoraIso('2026-10-04', '19:42:10'), null);
});

test('normaliza o arquivo e ordena candidatos por votos', () => {
  const bruto = arquivoTse();
  bruto.cand[1].vap = '32000';
  const m = normalizar(bruto, { fonte: 'teste', hash: 'abcdef0123456789ffff' });
  assert.equal(m.abrangencia, 'SP');
  assert.equal(m.secoes.pct, 25);
  assert.equal(m.candidatos[0].numero, 92);
  assert.equal(m.versao, 'abcdef0123456789');
});
