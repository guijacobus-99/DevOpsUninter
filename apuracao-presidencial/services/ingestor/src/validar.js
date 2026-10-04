// Regras de qualidade de dados aplicadas a cada snapshot antes da publicação.
//
// - bloqueantes: o arquivo é internamente inconsistente ou não é o que esperamos.
//   Não é publicado; o site continua mostrando o último snapshot bom.
// - alertas: o arquivo é coerente, mas destoa do snapshot anterior (ex.: regressão).
//   É publicado — o TSE é a fonte da verdade e uma retotalização legítima não pode
//   congelar o site — e o alerta vai para o monitoramento, para análise humana.
import { ABRANGENCIAS } from './config.js';

const TOLERANCIA_PCT = 0.01; // o TSE arredonda percentuais para 2 casas

// Catálogo das regras (usado também para pré-criar as séries de métricas com valor 0).
export const REGRAS = [
  ['esquema', 'bloqueante'],
  ['soma_candidatos', 'bloqueante'],
  ['secoes_limite', 'bloqueante'],
  ['pct_secoes', 'bloqueante'],
  ['comparecimento_limite', 'bloqueante'],
  ['votos_limite', 'bloqueante'],
  ['pct_candidato', 'bloqueante'],
  ['regressao_secoes', 'alerta'],
  ['regressao_votos', 'alerta'],
];

const CAMPOS_INTEIROS = [
  ['turno', (m) => m.turno],
  ['secoes.total', (m) => m.secoes.total],
  ['secoes.totalizadas', (m) => m.secoes.totalizadas],
  ['eleitorado.total', (m) => m.eleitorado.total],
  ['eleitorado.apurado', (m) => m.eleitorado.apurado],
  ['comparecimento.total', (m) => m.comparecimento.total],
  ['abstencoes.total', (m) => m.abstencoes.total],
  ['votos.validos', (m) => m.votos.validos],
  ['votos.brancos', (m) => m.votos.brancos],
  ['votos.nulos', (m) => m.votos.nulos],
];

function validarEsquema(m, esperado) {
  const erros = [];
  for (const [campo, ler] of CAMPOS_INTEIROS) {
    if (!Number.isSafeInteger(ler(m))) erros.push(`${campo} ausente ou não inteiro`);
  }
  if (!Number.isFinite(m.secoes.pct)) erros.push('secoes.pct ausente ou inválido');
  if (!m.geradoEm) erros.push('data/hora de geração ausente ou inválida');
  if (!ABRANGENCIAS.includes(m.abrangencia)) erros.push(`abrangência desconhecida: ${m.abrangencia}`);
  if (m.candidatos.length === 0) erros.push('lista de candidatos vazia');
  m.candidatos.forEach((c, i) => {
    if (!Number.isSafeInteger(c.numero) || !Number.isSafeInteger(c.votos) || !Number.isFinite(c.pct)) {
      erros.push(`candidato[${i}] com campos numéricos inválidos`);
    }
  });
  if (m.eleicao !== esperado.eleicao) erros.push(`eleição ${m.eleicao} ≠ esperada ${esperado.eleicao}`);
  if (m.turno !== esperado.turno) erros.push(`turno ${m.turno} ≠ esperado ${esperado.turno}`);
  return erros;
}

export function validar(m, anterior, esperado) {
  const bloqueantes = [];
  const alertas = [];
  const bloquear = (regra, detalhe) => bloqueantes.push({ regra, detalhe });
  const alertar = (regra, detalhe) => alertas.push({ regra, detalhe });

  const errosEsquema = validarEsquema(m, esperado);
  if (errosEsquema.length > 0) {
    bloquear('esquema', errosEsquema.join('; '));
    return { bloqueantes, alertas }; // as demais regras dependem de campos válidos
  }

  const somaCandidatos = m.candidatos.reduce((s, c) => s + c.votos, 0);
  if (somaCandidatos !== m.votos.validos) {
    bloquear('soma_candidatos', `soma dos candidatos ${somaCandidatos} ≠ votos válidos ${m.votos.validos}`);
  }

  if (m.secoes.totalizadas > m.secoes.total) {
    bloquear('secoes_limite', `totalizadas ${m.secoes.totalizadas} > total ${m.secoes.total}`);
  }

  if (m.secoes.total > 0) {
    const calculado = (m.secoes.totalizadas / m.secoes.total) * 100;
    if (Math.abs(calculado - m.secoes.pct) > TOLERANCIA_PCT) {
      bloquear('pct_secoes', `informado ${m.secoes.pct}% ≠ calculado ${calculado.toFixed(2)}%`);
    }
  }

  if (m.comparecimento.total > m.eleitorado.apurado) {
    bloquear('comparecimento_limite', `comparecimento ${m.comparecimento.total} > eleitorado apurado ${m.eleitorado.apurado}`);
  }

  const votosApurados = m.votos.validos + m.votos.brancos + m.votos.nulos;
  if (votosApurados > m.comparecimento.total) {
    bloquear('votos_limite', `válidos+brancos+nulos ${votosApurados} > comparecimento ${m.comparecimento.total}`);
  }

  if (m.votos.validos > 0) {
    for (const c of m.candidatos) {
      const calculado = (c.votos / m.votos.validos) * 100;
      if (Math.abs(calculado - c.pct) > TOLERANCIA_PCT) {
        bloquear('pct_candidato', `candidato ${c.numero}: informado ${c.pct}% ≠ calculado ${calculado.toFixed(2)}%`);
      }
    }
  }

  if (anterior) {
    if (m.secoes.totalizadas < anterior.secoes.totalizadas) {
      alertar('regressao_secoes', `${anterior.secoes.totalizadas} → ${m.secoes.totalizadas}`);
    }
    const votosAnteriores = new Map(anterior.candidatos.map((c) => [c.numero, c.votos]));
    for (const c of m.candidatos) {
      const antes = votosAnteriores.get(c.numero);
      if (antes !== undefined && c.votos < antes) {
        alertar('regressao_votos', `candidato ${c.numero}: ${antes} → ${c.votos}`);
      }
    }
  }

  return { bloqueantes, alertas };
}
