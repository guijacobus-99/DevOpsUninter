import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABRANGENCIAS_FILHAS, estadoAbrangencia, montarArquivo } from '../src/simulacao.js';

const AMOSTRAS = Array.from({ length: 201 }, (_, i) => i / 200);

test('votos e seções nunca regridem ao longo da apuração', () => {
  for (const abr of ['BR', ...ABRANGENCIAS_FILHAS]) {
    let anterior = null;
    for (const x of AMOSTRAS) {
      const e = estadoAbrangencia(abr, x);
      if (anterior) {
        assert.ok(e.secoesTotalizadas >= anterior.secoesTotalizadas, `${abr} seções x=${x}`);
        e.votosCand.forEach((v, i) => assert.ok(v >= anterior.votosCand[i], `${abr} cand ${i} x=${x}`));
      }
      anterior = e;
    }
  }
});

test('BR é a soma das UFs e do exterior', () => {
  const br = estadoAbrangencia('BR', 0.5);
  const soma = ABRANGENCIAS_FILHAS.reduce((s, abr) => s + estadoAbrangencia(abr, 0.5).validos, 0);
  assert.equal(br.validos, soma);
});

test('arquivo respeita invariantes aritméticas', () => {
  for (const x of [0, 0.1, 0.5, 1]) {
    const a = montarArquivo({ abr: 'SP', x, geradoEm: new Date('2026-10-04T21:00:00Z'), eleicao: '9001', turno: 1 });
    const somaCand = a.cand.reduce((s, c) => s + Number(c.vap), 0);
    assert.equal(somaCand, Number(a.vvc));
    assert.ok(Number(a.vvc) + Number(a.vb) + Number(a.tvn) <= Number(a.c));
    assert.ok(Number(a.c) <= Number(a.ea));
    assert.ok(Number(a.st) <= Number(a.s));
  }
});

test('horário de geração é convertido para Brasília (UTC-3)', () => {
  const a = montarArquivo({ abr: 'BR', x: 0, geradoEm: new Date('2026-10-04T20:05:09Z'), eleicao: '9001', turno: 1 });
  assert.equal(a.dg, '04/10/2026');
  assert.equal(a.hg, '17:05:09');
});

test('com 100% apurado e sem maioria absoluta, os dois primeiros vão ao 2º turno', () => {
  const a = montarArquivo({ abr: 'BR', x: 1, geradoEm: new Date(), eleicao: '9001', turno: 1 });
  assert.equal(a.pst, '100,00');
  assert.deepEqual(a.cand.slice(0, 2).map((c) => c.st), ['2º turno', '2º turno']);
});
