import { config, urlDaFonte } from './config.js';
import { duracaoColeta } from './metricas.js';

// GET condicional: com ETag/Last-Modified a fonte responde 304 sem corpo quando nada mudou,
// o que reduz banda e carga no TSE.
export async function buscar(abr, { etag, ultimaModificacao } = {}) {
  const fimTimer = duracaoColeta.startTimer({ abrangencia: abr });
  const headers = { 'User-Agent': 'apuracao-presidencial-ingestor/1.0' };
  if (etag) headers['If-None-Match'] = etag;
  if (ultimaModificacao) headers['If-Modified-Since'] = ultimaModificacao;

  try {
    const resp = await fetch(urlDaFonte(abr), { headers, signal: AbortSignal.timeout(config.timeoutMs) });
    if (resp.status === 304) return { tipo: 'nao_modificado' };
    if (!resp.ok) return { tipo: 'erro_http', status: resp.status };
    return {
      tipo: 'ok',
      corpo: await resp.text(),
      etag: resp.headers.get('etag') ?? undefined,
      ultimaModificacao: resp.headers.get('last-modified') ?? undefined,
    };
  } catch (err) {
    return { tipo: 'erro_rede', erro: err.message };
  } finally {
    fimTimer();
  }
}
