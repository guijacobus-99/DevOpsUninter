import { NOMES_ABRANGENCIA, formatarPct } from '../formatar.js'

function Candidato({ c, corDe }) {
  if (!c) return <td colSpan={2}>—</td>
  return (
    <>
      <td>
        <span className="chave" style={{ background: corDe(c.numero) }} aria-hidden="true" />
        {c.nome}
      </td>
      <td className="num">{formatarPct(c.pct)}</td>
    </>
  )
}

export function TabelaAbrangencias({ itens, corDe, selecionada, aoSelecionar }) {
  const linhas = itens.filter((i) => i.abrangencia !== 'BR')
  return (
    <section className="cartao" aria-labelledby="titulo-tabela">
      <h2 id="titulo-tabela">Por estado</h2>
      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th scope="col">UF</th>
              <th scope="col" className="num">Seções</th>
              <th scope="col">1º colocado</th>
              <th scope="col" className="num">%</th>
              <th scope="col">2º colocado</th>
              <th scope="col" className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((i) => (
              <tr key={i.abrangencia} className={i.abrangencia === selecionada ? 'selecionada' : undefined}>
                <th scope="row">
                  <button type="button" className="link" onClick={() => aoSelecionar(i.abrangencia)}>
                    {NOMES_ABRANGENCIA[i.abrangencia] ?? i.abrangencia}
                  </button>
                </th>
                <td className="num">{formatarPct(i.pctSecoes)}</td>
                <Candidato c={i.lider} corDe={corDe} />
                <Candidato c={i.segundo} corDe={corDe} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
