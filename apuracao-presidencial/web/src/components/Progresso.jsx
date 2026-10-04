import { formatarInteiro, formatarPct } from '../formatar.js'

export function Progresso({ secoes }) {
  return (
    <section className="cartao progresso" aria-labelledby="titulo-progresso">
      <h2 id="titulo-progresso">Seções totalizadas</h2>
      <p className="heroi">{formatarPct(secoes.pct)}</p>
      <div
        className="medidor"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={secoes.pct}
        aria-labelledby="titulo-progresso"
      >
        <div className="medidor-preenchido" style={{ width: `${secoes.pct}%` }} />
      </div>
      <p className="nota">
        {formatarInteiro(secoes.totalizadas)} de {formatarInteiro(secoes.total)} seções
      </p>
    </section>
  )
}
