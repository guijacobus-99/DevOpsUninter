import { createServer } from 'node:http';
import { criarApp } from './app.js';
import { criarMemoria } from './memoria.js';
import { registrarIdade } from './metricas.js';

function escrever(nivel, msg, campos) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), nivel, servico: 'api', msg, ...campos }));
}
const log = { info: (m, c) => escrever('info', m, c), warn: (m, c) => escrever('warn', m, c), error: (m, c) => escrever('error', m, c) };

const PORTA = Number(process.env.PORT ?? 3000);
const memoria = criarMemoria({ redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379', log });
registrarIdade(memoria);

const app = criarApp(memoria);
const servidor = createServer((req, res) => {
  app(req, res).catch((err) => log.error('erro não tratado', { url: req.url, erro: err.message }));
});
servidor.keepAliveTimeout = 65_000; // maior que o keepalive do proxy à frente

async function iniciar() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await memoria.iniciar();
      break;
    } catch (err) {
      log.warn('aguardando redis', { tentativa, erro: err.message });
      await new Promise((r) => setTimeout(r, Math.min(1000 * tentativa, 5000)));
    }
  }
  servidor.listen(PORTA, () => log.info('api no ar', { porta: PORTA, abrangencias: memoria.snapshots.size }));
}

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    log.info('encerrando', { sinal });
    servidor.close(async () => {
      await memoria.fechar();
      process.exit(0);
    });
  });
}

iniciar();
