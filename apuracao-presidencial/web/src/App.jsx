import { useMemo, useState } from 'react'
import { Candidatos } from './components/Candidatos.jsx'
import { Indicadores } from './components/Indicadores.jsx'
import { Progresso } from './components/Progresso.jsx'
import { TabelaAbrangencias } from './components/TabelaAbrangencias.jsx'
import { NOMES_ABRANGENCIA, formatarHora } from './formatar.js'
import { useJsonPeriodico } from './useJsonPeriodico.js'
import './App.css'

const INTERVALO_MS = 5000
const LIMITE_DESATUALIZADO_MS = 3 * 60 * 1000
const SLOTS_DE_COR = 8

// A cor segue o candidato (pelo número), nunca a posição no ranking: quem passa à frente
// não troca de cor.
function criarCorDe(candidatos) {
  const numeros = [...new Set(candidatos.map((c) => c.numero))].sort((a, b) => a - b)
  return (numero) => {
    const i = numeros.indexOf(numero)
    return i >= 0 && i < SLOTS_DE_COR ? `var(--serie-${i + 1})` : 'var(--serie-outros)'
  }
}

export default function App() {
  const [abrangencia, setAbrangencia] = useState('BR')
  const resultado = useJsonPeriodico(`/api/v1/resultados/${abrangencia.toLowerCase()}`, INTERVALO_MS)
  const resumo = useJsonPeriodico('/api/v1/resultados', INTERVALO_MS * 2)

  const r = resultado.dados
  const corDe = useMemo(() => criarCorDe(r?.candidatos ?? []), [r])
  const desatualizado =
    r && r.secoes.pct < 100 && Date.now() - Date.parse(r.geradoEm) > LIMITE_DESATUALIZADO_MS

  return (
    <div className="pagina">
      {r && r.fonte !== 'tse' && (
        <div className="faixa faixa-simulada" role="note">
          Dados simulados para teste — não são resultados oficiais.
        </div>
      )}

      <header className="cabecalho">
        <div>
          <h1>Apuração · Presidente{r ? ` · ${r.turno}º turno` : ''}</h1>
          <p className="subtitulo">
            {r
              ? `${NOMES_ABRANGENCIA[r.abrangencia] ?? r.abrangencia} · atualizado às ${formatarHora(r.geradoEm)} (horário de Brasília)`
              : 'Carregando…'}
          </p>
        </div>
        <label className="seletor">
          <span>Abrangência</span>
          <select value={abrangencia} onChange={(e) => setAbrangencia(e.target.value)}>
            {Object.entries(NOMES_ABRANGENCIA).map(([sigla, nome]) => (
              <option key={sigla} value={sigla}>{nome}</option>
            ))}
          </select>
        </label>
      </header>

      {resultado.erro && (
        <div className="faixa faixa-aviso" role="status">
          ⚠ Sem conexão com o servidor ({resultado.erro}).{r ? ' Exibindo o último dado recebido.' : ''}
        </div>
      )}
      {desatualizado && (
        <div className="faixa faixa-aviso" role="status">
          ⚠ Os dados podem estar desatualizados: a última atualização foi há mais de 3 minutos.
        </div>
      )}

      {r && (
        <main className={resultado.atualizando ? 'conteudo atualizando' : 'conteudo'} aria-busy={resultado.atualizando}>
          <div className="grade">
            <Progresso secoes={r.secoes} />
            <Candidatos candidatos={r.candidatos} corDe={corDe} />
          </div>
          <Indicadores r={r} />
          {resumo.dados && (
            <TabelaAbrangencias
              itens={resumo.dados.abrangencias}
              corDe={corDe}
              selecionada={abrangencia}
              aoSelecionar={(abr) => {
                setAbrangencia(abr)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          )}
        </main>
      )}

      <footer className="rodape">
        Fonte: Tribunal Superior Eleitoral (TSE). Atualização automática a cada ~5 segundos.
      </footer>
    </div>
  )
}
