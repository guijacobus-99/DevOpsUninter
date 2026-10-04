// Eleição de líder com advisory lock do Postgres: vários ingestores podem rodar, mas só quem
// segura o lock coleta e publica; os demais ficam em espera. O lock pertence à sessão, então
// se o líder morrer (ou perder a conexão) o Postgres o libera e um ingestor em espera assume.
//
// Uma sobreposição breve entre dois líderes não corrompe nada: as gravações são idempotentes
// e a regra "nunca voltar no tempo" ordena as publicações.
import pg from 'pg';

const SQL_LOCK = "SELECT pg_try_advisory_lock(hashtext('apuracao-ingestor')) AS obtido";

export function criarEleicaoLider({ databaseUrl, aoPerder }) {
  let cliente = null;
  let lider = false;

  async function conectar() {
    const novo = new pg.Client({ connectionString: databaseUrl, statement_timeout: 3000, keepAlive: true });
    novo.on('error', (err) => {
      const eraLider = lider;
      lider = false;
      cliente = null;
      if (eraLider) aoPerder(err);
    });
    await novo.connect(); // se falhar, `cliente` continua nulo e a próxima tentativa reconecta
    cliente = novo;
  }

  return {
    eLider: () => lider,

    // Tenta obter o lock; retorna true se este processo é (ou continua) o líder.
    async tentar() {
      if (!cliente) await conectar();
      const r = await cliente.query(SQL_LOCK);
      lider = r.rows[0].obtido;
      return lider;
    },

    // Chamado a cada ciclo pelo líder: se a sessão do lock caiu sem evento de erro
    // (ex.: partição de rede), a consulta falha e a liderança é abandonada.
    async confirmar() {
      try {
        await cliente.query('SELECT 1');
      } catch (err) {
        lider = false;
        aoPerder(err);
      }
    },

    async liberar() {
      lider = false;
      if (cliente) await cliente.end().catch(() => {});
      cliente = null;
    },
  };
}
