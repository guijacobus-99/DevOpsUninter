// Simulação determinística de uma apuração presidencial no layout "dados simplificados"
// do TSE. Candidatos e partidos são FICTÍCIOS. O eleitorado por UF é apenas uma ordem de
// grandeza para a simulação ficar realista — não use estes números como dado oficial.

export const ELEITORADO_POR_ABRANGENCIA = {
  AC: 597_000, AL: 2_290_000, AM: 2_650_000, AP: 550_000, BA: 11_290_000,
  CE: 6_820_000, DF: 2_200_000, ES: 2_920_000, GO: 4_880_000, MA: 5_030_000,
  MG: 16_290_000, MS: 2_010_000, MT: 2_470_000, PA: 6_080_000, PB: 3_080_000,
  PE: 7_020_000, PI: 2_570_000, PR: 8_470_000, RJ: 12_830_000, RN: 2_550_000,
  RO: 1_220_000, RR: 366_000, RS: 8_590_000, SC: 5_490_000, SE: 1_690_000,
  SP: 34_670_000, TO: 1_060_000,
  ZZ: 697_000, // eleitores no exterior
};

export const ABRANGENCIAS_FILHAS = Object.keys(ELEITORADO_POR_ABRANGENCIA);

// Números 91–96 não pertencem a nenhum partido registrado: deixa explícito que é ficção.
export const CANDIDATOS = [
  { seq: 1, numero: 91, nome: 'CANDIDATA ALFA', coligacao: 'PARTIDO ALFA', peso: 0.38 },
  { seq: 2, numero: 92, nome: 'CANDIDATO BETA', coligacao: 'PARTIDO BETA', peso: 0.34 },
  { seq: 3, numero: 93, nome: 'CANDIDATA GAMA', coligacao: 'PARTIDO GAMA', peso: 0.12 },
  { seq: 4, numero: 94, nome: 'CANDIDATO DELTA', coligacao: 'PARTIDO DELTA', peso: 0.08 },
  { seq: 5, numero: 95, nome: 'CANDIDATA ÉPSILON', coligacao: 'PARTIDO ÉPSILON', peso: 0.05 },
  { seq: 6, numero: 96, nome: 'CANDIDATO ZETA', coligacao: 'PARTIDO ZETA', peso: 0.03 },
];

const ELEITORES_POR_SECAO = 330;

// PRNG determinístico (mulberry32) semeado pelo código da abrangência.
function prng(semente) {
  let h = 1779033703 ^ semente.length;
  for (const ch of semente) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Resultado final (100% das seções) de cada UF, calculado uma única vez.
function resultadoFinal(abr) {
  const rnd = prng(abr);
  const eleitorado = ELEITORADO_POR_ABRANGENCIA[abr];
  const comparecimento = Math.round(eleitorado * (0.76 + rnd() * 0.08));
  const brancos = Math.round(comparecimento * (0.012 + rnd() * 0.01));
  const nulos = Math.round(comparecimento * (0.025 + rnd() * 0.015));
  const validos = comparecimento - brancos - nulos;

  const pesos = CANDIDATOS.map((c) => c.peso * (0.6 + rnd() * 0.8));
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  const shares = pesos.map((p) => p / somaPesos);
  // drift ∈ [-0.3, 0.3]: o candidato começa a apuração acima/abaixo do resultado final e
  // converge para ele. Com |drift| <= 0.3 os votos continuam monotônicos (ver testes).
  const drifts = CANDIDATOS.map(() => (rnd() - 0.5) * 0.6);
  const meio = 0.3 + rnd() * 0.3; // quando a curva de totalização acelera nesta UF

  return {
    eleitorado,
    secoes: Math.ceil(eleitorado / ELEITORES_POR_SECAO),
    brancos,
    nulos,
    validos,
    shares,
    drifts,
    meio,
  };
}

const FINAIS = Object.fromEntries(ABRANGENCIAS_FILHAS.map((abr) => [abr, resultadoFinal(abr)]));

// Curva logística normalizada: progresso(0) = 0 e progresso(1) = 1.
function progresso(x, meio) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const l = (v) => 1 / (1 + Math.exp(-12 * (v - meio)));
  return (l(x) - l(0)) / (l(1) - l(0));
}

// Estado numérico de uma UF numa fração x ∈ [0, 1] do tempo total de apuração.
export function estadoUf(abr, x) {
  const f = FINAIS[abr];
  const st = Math.floor(f.secoes * progresso(x, f.meio));
  const q = st / f.secoes;

  const pesoDrift = f.shares.map((s, i) => s * (1 + f.drifts[i] * (1 - q)));
  const somaDrift = pesoDrift.reduce((s, p) => s + p, 0);
  const votosCand = pesoDrift.map((p) => Math.floor(f.validos * q * (p / somaDrift)));

  const validos = votosCand.reduce((s, v) => s + v, 0);
  const brancos = Math.floor(f.brancos * q);
  const nulos = Math.floor(f.nulos * q);
  const comparecimento = validos + brancos + nulos;
  const eleitoradoApurado = Math.floor(f.eleitorado * q);

  return {
    eleitorado: f.eleitorado,
    eleitoradoApurado,
    secoes: f.secoes,
    secoesTotalizadas: st,
    comparecimento,
    abstencoes: Math.max(0, eleitoradoApurado - comparecimento),
    brancos,
    nulos,
    validos,
    votosCand,
  };
}

function somarEstados(estados) {
  const soma = {
    eleitorado: 0, eleitoradoApurado: 0, secoes: 0, secoesTotalizadas: 0, comparecimento: 0,
    abstencoes: 0, brancos: 0, nulos: 0, validos: 0, votosCand: CANDIDATOS.map(() => 0),
  };
  for (const e of estados) {
    for (const k of Object.keys(soma)) {
      if (k === 'votosCand') e.votosCand.forEach((v, i) => { soma.votosCand[i] += v; });
      else soma[k] += e[k];
    }
  }
  return soma;
}

export function estadoAbrangencia(abr, x) {
  if (abr === 'BR') return somarEstados(ABRANGENCIAS_FILHAS.map((a) => estadoUf(a, x)));
  return estadoUf(abr, x);
}

// ---------- serialização no formato do TSE (números como string, decimal com vírgula) ----------

const pct = (parte, todo) => (todo > 0 ? ((parte / todo) * 100).toFixed(2) : '0.00').replace('.', ',');

function dataHoraBrasilia(date) {
  // Horário de Brasília = UTC-3 (sem horário de verão desde 2019).
  const d = new Date(date.getTime() - 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    dg: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    hg: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
  };
}

export function montarArquivo({ abr, x, geradoEm, eleicao, turno }) {
  const e = estadoAbrangencia(abr, x);
  const { dg, hg } = dataHoraBrasilia(geradoEm);
  const finalizado = e.secoesTotalizadas === e.secoes;

  const ordem = CANDIDATOS.map((c, i) => ({ c, votos: e.votosCand[i] })).sort((a, b) => b.votos - a.votos);
  const maioriaAbsoluta = finalizado && ordem[0].votos * 2 > e.validos;

  const situacao = (posicao) => {
    if (!finalizado) return '';
    if (maioriaAbsoluta) return posicao === 0 ? 'Eleito' : 'Não eleito';
    return posicao < 2 ? '2º turno' : 'Não eleito';
  };

  return {
    ele: String(eleicao),
    tpabr: abr === 'BR' ? 'PAIS' : abr === 'ZZ' ? 'EXTERIOR' : 'UF',
    cdabr: abr,
    t: String(turno),
    dg,
    hg,
    s: String(e.secoes),
    st: String(e.secoesTotalizadas),
    pst: pct(e.secoesTotalizadas, e.secoes),
    e: String(e.eleitorado),
    ea: String(e.eleitoradoApurado),
    c: String(e.comparecimento),
    pc: pct(e.comparecimento, e.eleitoradoApurado),
    a: String(e.abstencoes),
    pa: pct(e.abstencoes, e.eleitoradoApurado),
    vvc: String(e.validos),
    pvvc: pct(e.validos, e.comparecimento),
    vb: String(e.brancos),
    pvb: pct(e.brancos, e.comparecimento),
    tvn: String(e.nulos),
    ptvn: pct(e.nulos, e.comparecimento),
    cand: ordem.map(({ c, votos }, posicao) => ({
      seq: String(c.seq),
      n: String(c.numero),
      nm: c.nome,
      cc: c.coligacao,
      e: maioriaAbsoluta && posicao === 0 ? 's' : 'n',
      st: situacao(posicao),
      vap: String(votos),
      pvap: pct(votos, e.validos),
    })),
  };
}
