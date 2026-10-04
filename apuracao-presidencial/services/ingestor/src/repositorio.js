import pg from 'pg';

export function criarRepositorio(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

  return {
    ping: () => pool.query('SELECT 1'),
    fechar: () => pool.end(),

    // Camada bruta (auditoria): todo snapshot novo, aceito ou não, com o payload original.
    // Idempotente: o mesmo conteúdo (hash) nunca é gravado duas vezes por abrangência.
    async registrarBruto({ abrangencia, hash, geradoEm, status, motivo, payload }) {
      await pool.query(
        `INSERT INTO snapshot_bruto (abrangencia, hash, gerado_em, status, motivo, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (abrangencia, hash) DO NOTHING`,
        [abrangencia, hash, geradoEm, status, motivo, payload],
      );
    },

    // Camada normalizada: um registro por abrangência + instante de geração, com os votos
    // por candidato em tabela própria para análises em SQL.
    async salvarApuracao(m, hash) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const r = await cliente.query(
          `INSERT INTO apuracao (abrangencia, gerado_em, hash, secoes_total, secoes_totalizadas,
             pct_secoes, eleitorado, comparecimento, abstencoes, votos_validos, votos_brancos,
             votos_nulos, modelo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (abrangencia, gerado_em) DO NOTHING
           RETURNING id`,
          [m.abrangencia, m.geradoEm, hash, m.secoes.total, m.secoes.totalizadas, m.secoes.pct,
            m.eleitorado.total, m.comparecimento.total, m.abstencoes.total, m.votos.validos,
            m.votos.brancos, m.votos.nulos, m],
        );
        if (r.rowCount === 1) {
          const c = m.candidatos;
          await cliente.query(
            `INSERT INTO apuracao_candidato (apuracao_id, numero, nome, partido, votos, pct)
             SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::bigint[], $6::numeric[])`,
            [r.rows[0].id, c.map((x) => x.numero), c.map((x) => x.nome), c.map((x) => x.partido),
              c.map((x) => x.votos), c.map((x) => x.pct)],
          );
        }
        await cliente.query('COMMIT');
      } catch (err) {
        await cliente.query('ROLLBACK');
        throw err;
      } finally {
        cliente.release();
      }
    },

    // Último snapshot aceito de cada abrangência — usado para reidratar o Redis no boot.
    async ultimasApuracoes() {
      const r = await pool.query(
        `SELECT DISTINCT ON (abrangencia) abrangencia, hash, modelo
           FROM apuracao
          ORDER BY abrangencia, gerado_em DESC`,
      );
      return r.rows;
    },
  };
}
