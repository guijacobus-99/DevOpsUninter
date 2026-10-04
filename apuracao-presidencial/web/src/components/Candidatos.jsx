import { formatarInteiro, formatarPct } from '../formatar.js'

// Cada barra vai de 0 a 100% dos votos válidos; a marca de 50% mostra o limiar de maioria
// absoluta que decide a eleição no 1º turno.
export function Candidatos({ candidatos, corDe }) {
  return (
    <section className="cartao" aria-labelledby="titulo-candidatos">
      <h2 id="titulo-candidatos">Votos válidos por candidato</h2>
      <ol className="barras">
        {candidatos.map((c) => (
          <li key={c.numero} className="barra-linha" tabIndex={0}>
            <div className="barra-rotulo">
              <span className="barra-nome">
                {c.nome} <span className="barra-numero">{c.numero}</span>
              </span>
              {c.situacao && <span className="selo">{c.situacao}</span>}
              <span className="barra-valor">{formatarPct(c.pct)}</span>
            </div>
            <div className="barra-trilho" style={{ '--pct': `${c.pct}%` }}>
              <div className="barra" style={{ background: corDe(c.numero) }} />
              <div className="marca-maioria" aria-hidden="true" />
              <div className="dica" role="tooltip">
                <strong>{formatarInteiro(c.votos)} votos</strong>
                <span>{c.partido}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="nota">A linha vertical marca 50% dos votos válidos (maioria absoluta).</p>
    </section>
  )
}
