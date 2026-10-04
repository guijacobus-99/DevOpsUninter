import { createServer } from 'node:http';
import { setTimeout as dormir } from 'node:timers/promises';
import { config } from './config.js';
import { log } from './log.js';
import { buscar } from './fonte.js';
import { criarRepositorio } from './repositorio.js';
import { criarPublicador } from './publicador.js';
import { criarIngestor } from './ingestor.js';
import { criarEleicaoLider } from './lider.js';
import { aplicarMigracoes } from './migracoes.js';
import { lider as metricaLider, registro } from './metricas.js';

const repo = criarRepositorio(config.databaseUrl);
const pub = criarPublicador(config.redisUrl);
const ingestor = criarIngestor({ buscar, repo, pub, config, log });
const eleicao = criarEleicaoLider({
  databaseUrl: config.databaseUrl,
  // Sem o lock não há garantia de ser o único escritor: sai e deixa o orquestrador reiniciar
  // o processo, que volta como candidato.
  aoPerder: (err) => {
    log.error('liderança perdida; encerrando', { erro: err.message });
    process.exit(1);
  },
});

let rodando = true;
let ultimoCicloEm = 0;

const servidor = createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': registro.contentType });
    return res.end(await registro.metrics());
  }
  if (req.url === '/health/live') return res.writeHead(200).end('ok');
  if (req.url === '/health/ready') {
    if (!eleicao.eLider()) return res.writeHead(503).end('em espera');
    const pronto = Date.now() - ultimoCicloEm < config.intervaloMs * 3;
    return res.writeHead(pronto ? 200 : 503).end(pronto ? 'ok' : 'sem ciclo recente');
  }
  res.writeHead(404).end();
});

async function aguardar(nome, fn) {
  for (let tentativa = 1; rodando; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      log.warn(`aguardando ${nome}`, { tentativa, erro: err.message });
      await dormir(Math.min(1000 * tentativa, 5000));
    }
  }
}

async function principal() {
  servidor.listen(config.portaMetricas);
  log.info('ingestor iniciando', { eleicao: config.eleicao, turno: config.turno, fonte: config.fonteNome, intervaloMs: config.intervaloMs });

  await aguardar('postgres', () => repo.ping());
  await aguardar('redis', () => pub.ping());

  metricaLider.set(0);
  let avisouEspera = false;
  while (rodando && !(await aguardar('lock de liderança', () => eleicao.tentar()))) {
    if (!avisouEspera) log.info('em espera: outro ingestor é o líder');
    avisouEspera = true;
    await dormir(config.intervaloMs);
  }
  if (!rodando) return encerrar();
  metricaLider.set(1);
  log.info('liderança assumida');

  await aguardar('migrações', () => aplicarMigracoes(repo.executar, log));
  await aguardar('reidratação', () => ingestor.reidratar());

  while (rodando) {
    const inicio = Date.now();
    await eleicao.confirmar();
    await ingestor.ciclo();
    ultimoCicloEm = Date.now();
    await dormir(Math.max(0, config.intervaloMs - (Date.now() - inicio)));
  }

  await encerrar();
}

async function encerrar() {
  await Promise.allSettled([eleicao.liberar(), repo.fechar(), pub.fechar()]);
  servidor.close();
  log.info('ingestor encerrado');
}

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    log.info('sinal recebido, encerrando após o ciclo atual', { sinal });
    rodando = false;
  });
}

principal().catch((err) => {
  log.error('falha fatal', { erro: err.message, stack: err.stack });
  process.exit(1);
});
