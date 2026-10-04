import Redis from 'ioredis';

export const CANAL_ATUALIZACAO = 'resultado:atualizado';

export function criarPublicador(redisUrl) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  redis.on('error', () => {}); // falhas aparecem nas chamadas; evita log duplicado do ioredis

  return {
    ping: () => redis.ping(),
    fechar: () => redis.quit(),

    // Grava o snapshot e avisa as APIs na mesma transação.
    async publicar(modelo) {
      const resultados = await redis
        .multi()
        .set(`resultado:${modelo.abrangencia}`, JSON.stringify(modelo))
        .publish(CANAL_ATUALIZACAO, modelo.abrangencia)
        .exec();
      const erro = resultados?.find(([e]) => e)?.[0];
      if (erro) throw erro;
    },
  };
}
