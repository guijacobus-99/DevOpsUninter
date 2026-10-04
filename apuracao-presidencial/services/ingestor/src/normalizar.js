// Adaptador: converte o layout bruto do TSE no modelo público do site.
// Todo o conhecimento sobre os nomes de campo do TSE fica neste arquivo — se o layout
// mudar em 2026, só ele precisa ser alterado.

// Inteiros chegam como string ("156454011"). Parsing estrito: qualquer outra coisa vira NaN
// e é barrada pela validação de esquema, em vez de virar um número errado no site.
export function inteiro(v) {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// Percentuais chegam com vírgula decimal ("50,90").
export function percentual(v) {
  const s = String(v ?? '').trim();
  return /^\d+(,\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN;
}

// "04/10/2026" + "19:42:10" (horário de Brasília) -> "2026-10-04T19:42:10-03:00"
export function dataHoraIso(dg, hg) {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dg ?? ''));
  const h = /^\d{2}:\d{2}:\d{2}$/.test(String(hg ?? ''));
  if (!d || !h) return null;
  return `${d[3]}-${d[2]}-${d[1]}T${hg}-03:00`;
}

export function normalizar(bruto, { fonte, hash }) {
  const candidatos = (Array.isArray(bruto.cand) ? bruto.cand : [])
    .map((c) => ({
      numero: inteiro(c.n),
      nome: String(c.nm ?? ''),
      partido: String(c.cc ?? ''),
      votos: inteiro(c.vap),
      pct: percentual(c.pvap),
      eleito: c.e === 's',
      situacao: String(c.st ?? ''),
    }))
    .sort((a, b) => b.votos - a.votos || a.numero - b.numero);

  return {
    eleicao: String(bruto.ele ?? ''),
    abrangencia: String(bruto.cdabr ?? '').toUpperCase(),
    turno: inteiro(bruto.t),
    geradoEm: dataHoraIso(bruto.dg, bruto.hg),
    secoes: { total: inteiro(bruto.s), totalizadas: inteiro(bruto.st), pct: percentual(bruto.pst) },
    eleitorado: { total: inteiro(bruto.e), apurado: inteiro(bruto.ea) },
    comparecimento: { total: inteiro(bruto.c), pct: percentual(bruto.pc) },
    abstencoes: { total: inteiro(bruto.a), pct: percentual(bruto.pa) },
    votos: {
      validos: inteiro(bruto.vvc),
      brancos: inteiro(bruto.vb),
      nulos: inteiro(bruto.tvn),
    },
    candidatos,
    fonte,
    versao: hash.slice(0, 16),
  };
}
