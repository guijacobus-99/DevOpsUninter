import { formatarInteiro, formatarPct } from '../formatar.js'

function Bloco({ rotulo, valor, pct }) {
  return (
    <div className="indicador">
      <span className="indicador-rotulo">{rotulo}</span>
      <span className="indicador-valor">{formatarInteiro(valor)}</span>
      <span className="indicador-pct">{formatarPct(pct)}</span>
    </div>
  )
}

export function Indicadores({ r }) {
  const pctDe = (v) => (r.comparecimento.total > 0 ? (v / r.comparecimento.total) * 100 : 0)
  return (
    <section className="indicadores" aria-label="Comparecimento e votos não válidos">
      <Bloco rotulo="Comparecimento" valor={r.comparecimento.total} pct={r.comparecimento.pct} />
      <Bloco rotulo="Abstenções" valor={r.abstencoes.total} pct={r.abstencoes.pct} />
      <Bloco rotulo="Brancos" valor={r.votos.brancos} pct={pctDe(r.votos.brancos)} />
      <Bloco rotulo="Nulos" valor={r.votos.nulos} pct={pctDe(r.votos.nulos)} />
    </section>
  )
}
