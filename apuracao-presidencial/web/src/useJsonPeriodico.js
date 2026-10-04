import { useEffect, useState } from 'react'

// Polling com jitter (evita que milhões de navegadores batam na CDN no mesmo instante)
// e pausa quando a aba está em segundo plano. Em erro, mantém o último dado recebido.
export function useJsonPeriodico(url, intervaloMs = 5000) {
  const [estado, setEstado] = useState({ dados: null, erro: null, url: null })

  useEffect(() => {
    let ativo = true
    let timer
    const controle = new AbortController()

    async function buscar() {
      if (!document.hidden) {
        try {
          // no-cache: o navegador sempre revalida (ETag -> 304 barato); quem segura cache é a borda.
          const resp = await fetch(url, { signal: controle.signal, cache: 'no-cache' })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const dados = await resp.json()
          if (ativo) setEstado({ dados, erro: null, url })
        } catch (err) {
          if (!ativo || err.name === 'AbortError') return
          setEstado((anterior) => ({ ...anterior, erro: err.message }))
        }
      }
      if (ativo) timer = setTimeout(buscar, intervaloMs * (0.8 + Math.random() * 0.4))
    }

    const aoVoltar = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        buscar()
      }
    }

    buscar()
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      ativo = false
      controle.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [url, intervaloMs])

  // "atualizando" = ainda exibindo o dado de outra URL (troca de UF): mantém o quadro, esmaecido.
  return { ...estado, atualizando: estado.url !== url }
}
