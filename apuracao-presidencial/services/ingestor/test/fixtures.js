// Arquivo no layout do TSE, coerente, usado como base pelos testes.
export function arquivoTse(sobrescrever = {}) {
  return {
    ele: '9001', tpabr: 'UF', cdabr: 'SP', t: '1', dg: '04/10/2026', hg: '18:30:00',
    s: '1000', st: '250', pst: '25,00',
    e: '330000', ea: '82500', c: '66000', pc: '80,00', a: '16500', pa: '20,00',
    vvc: '62000', pvvc: '93,94', vb: '1000', pvb: '1,52', tvn: '3000', ptvn: '4,55',
    cand: [
      { seq: '1', n: '91', nm: 'CANDIDATA ALFA', cc: 'PARTIDO ALFA', e: 'n', st: '', vap: '31000', pvap: '50,00' },
      { seq: '2', n: '92', nm: 'CANDIDATO BETA', cc: 'PARTIDO BETA', e: 'n', st: '', vap: '31000', pvap: '50,00' },
    ],
    ...sobrescrever,
  };
}
