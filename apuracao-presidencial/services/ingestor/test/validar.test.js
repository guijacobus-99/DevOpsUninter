import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar } from '../src/normalizar.js';
import { validar } from '../src/validar.js';
import { arquivoTse } from './fixtures.js';

const ESPERADO = { eleicao: '9001', turno: 1 };
const modelo = (sobrescrever) => normalizar(arquivoTse(sobrescrever), { fonte: 'teste', hash: '0'.repeat(64) });
const regras = (lista) => lista.map((v) => v.regra);

test('arquivo coerente não gera violações', () => {
  assert.deepEqual(validar(modelo(), null, ESPERADO), { bloqueantes: [], alertas: [] });
});

test('soma dos candidatos diferente dos válidos bloqueia', () => {
  const { bloqueantes } = validar(modelo({ vvc: '62001' }), null, ESPERADO);
  assert.ok(regras(bloqueantes).includes('soma_candidatos'));
});

test('campo numérico malformado bloqueia como esquema e interrompe as demais regras', () => {
  const { bloqueantes } = validar(modelo({ st: '25O' }), null, ESPERADO);
  assert.deepEqual(regras(bloqueantes), ['esquema']);
});

test('eleição ou turno diferentes do configurado bloqueiam', () => {
  assert.deepEqual(regras(validar(modelo({ t: '2' }), null, ESPERADO).bloqueantes), ['esquema']);
  assert.deepEqual(regras(validar(modelo({ ele: '544' }), null, ESPERADO).bloqueantes), ['esquema']);
});

test('percentual de seções incoerente bloqueia', () => {
  const { bloqueantes } = validar(modelo({ pst: '26,00' }), null, ESPERADO);
  assert.deepEqual(regras(bloqueantes), ['pct_secoes']);
});

test('mais votos que comparecimento bloqueia', () => {
  const { bloqueantes } = validar(modelo({ c: '65000' }), null, ESPERADO);
  assert.ok(regras(bloqueantes).includes('votos_limite'));
});

test('regressão em relação ao snapshot anterior só gera alerta', () => {
  const anterior = modelo({ st: '300', pst: '30,00' });
  anterior.candidatos[0].votos = 40000;
  const { bloqueantes, alertas } = validar(modelo(), anterior, ESPERADO);
  assert.deepEqual(bloqueantes, []);
  assert.deepEqual(regras(alertas).sort(), ['regressao_secoes', 'regressao_votos']);
});
