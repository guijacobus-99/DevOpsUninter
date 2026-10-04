import { ABRANGENCIAS } from './abrangencias.js';
import { duracao, registro, requisicoes } from './metricas.js';

// TTL curto na borda + stale-*: a CDN absorve o pico, coalesce as requisições na origem
// e continua servindo o último dado se a origem cair.
const CACHE_RESULTADO = 'public, max-age=5, stale-while-revalidate=30, stale-if-error=600';

const ROTA_ABRANGENCIA = /^\/api\/v1\/resultados\/([a-z]{2})$/i;

export function criarApp(memoria) {
  function enviar(req, res, status, corpo, headers = {}) {
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : corpo);
  }

  function enviarJson(req, res, item) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CACHE_RESULTADO,
      'Access-Control-Allow-Origin': '*', // dado público: permite que outros sites consumam
      ETag: item.etag,
    };
    if (req.headers['if-none-match'] === item.etag) {
      enviar(req, res, 304, undefined, headers);
      return '304';
    }
    enviar(req, res, 200, item.corpo, headers);
    return '200';
  }

  const semDados = (req, res) => {
    enviar(req, res, 503, JSON.stringify({ erro: 'resultado ainda não disponível' }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '5',
    });
    return '503';
  };

  async function rotear(req, res, caminho) {
    if (caminho === '/health/live') {
      enviar(req, res, 200, 'ok', { 'Cache-Control': 'no-store' });
      return '200';
    }
    if (caminho === '/health/ready') {
      const pronto = memoria.pronto();
      enviar(req, res, pronto ? 200 : 503, pronto ? 'ok' : 'sem dados', { 'Cache-Control': 'no-store' });
      return pronto ? '200' : '503';
    }
    if (caminho === '/metrics') {
      enviar(req, res, 200, await registro.metrics(), { 'Content-Type': registro.contentType });
      return '200';
    }
    if (caminho === '/api/v1/resultados') {
      const resumo = memoria.resumo();
      return resumo ? enviarJson(req, res, resumo) : semDados(req, res);
    }
    const m = ROTA_ABRANGENCIA.exec(caminho);
    if (m) {
      const abr = m[1].toUpperCase();
      if (!ABRANGENCIAS.includes(abr)) {
        enviar(req, res, 404, JSON.stringify({ erro: 'abrangência inválida' }), {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        });
        return '404';
      }
      const item = memoria.obter(abr);
      return item ? enviarJson(req, res, item) : semDados(req, res);
    }
    enviar(req, res, 404, 'not found');
    return '404';
  }

  // Rótulo de rota com cardinalidade fixa (nunca o caminho cru) para não explodir as métricas.
  function nomeDaRota(caminho) {
    if (caminho === '/api/v1/resultados') return '/api/v1/resultados';
    if (ROTA_ABRANGENCIA.test(caminho)) return '/api/v1/resultados/:abr';
    if (['/health/live', '/health/ready', '/metrics'].includes(caminho)) return caminho;
    return 'outra';
  }

  return async function handler(req, res) {
    const caminho = new URL(req.url, 'http://localhost').pathname;
    const rota = nomeDaRota(caminho);
    const fimTimer = duracao.startTimer({ rota });
    let status = '500';
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        enviar(req, res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
        status = '405';
      } else {
        status = await rotear(req, res, caminho);
      }
    } catch (err) {
      if (!res.headersSent) enviar(req, res, 500, 'erro interno');
      throw err;
    } finally {
      requisicoes.inc({ rota, status });
      fimTimer();
    }
  };
}
