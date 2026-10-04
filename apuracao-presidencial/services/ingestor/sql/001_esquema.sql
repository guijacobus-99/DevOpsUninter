-- Esquema do banco. Aplicado pelo ingestor líder no boot (ver src/migracoes.js), então
-- precisa ser idempotente: pode rodar várias vezes sem efeito colateral.

-- Camada bruta (auditoria): cada snapshot novo recebido da fonte, aceito ou não, com o
-- payload original. Permite reconstituir exatamente o que o TSE publicou e quando.
CREATE TABLE IF NOT EXISTS snapshot_bruto (
    id           bigserial    PRIMARY KEY,
    abrangencia  char(2)      NOT NULL,
    hash         char(64)     NOT NULL,                  -- sha256 do corpo recebido
    gerado_em    timestamptz,                            -- data/hora de geração no TSE (nula se ilegível)
    recebido_em  timestamptz  NOT NULL DEFAULT now(),
    status       text         NOT NULL CHECK (status IN ('aceito', 'rejeitado', 'desatualizado')),
    motivo       text,                                   -- regras violadas / alertas
    payload      jsonb        NOT NULL,
    UNIQUE (abrangencia, hash)                           -- idempotência: reprocessar não duplica
);
CREATE INDEX IF NOT EXISTS snapshot_bruto_problemas_idx ON snapshot_bruto (recebido_em) WHERE status <> 'aceito';

-- Camada normalizada: um registro por snapshot aceito.
CREATE TABLE IF NOT EXISTS apuracao (
    id                  bigserial     PRIMARY KEY,
    abrangencia         char(2)       NOT NULL,
    gerado_em           timestamptz   NOT NULL,
    recebido_em         timestamptz   NOT NULL DEFAULT now(),
    hash                char(64)      NOT NULL,
    secoes_total        integer       NOT NULL,
    secoes_totalizadas  integer       NOT NULL,
    pct_secoes          numeric(5,2)  NOT NULL,
    eleitorado          bigint        NOT NULL,
    comparecimento      bigint        NOT NULL,
    abstencoes          bigint        NOT NULL,
    votos_validos       bigint        NOT NULL,
    votos_brancos       bigint        NOT NULL,
    votos_nulos         bigint        NOT NULL,
    modelo              jsonb         NOT NULL,          -- JSON público, usado para reidratar o Redis
    UNIQUE (abrangencia, gerado_em),
    CHECK (secoes_totalizadas <= secoes_total)
);

CREATE TABLE IF NOT EXISTS apuracao_candidato (
    apuracao_id  bigint        NOT NULL REFERENCES apuracao (id) ON DELETE CASCADE,
    numero       smallint      NOT NULL,
    nome         text          NOT NULL,
    partido      text          NOT NULL,
    votos        bigint        NOT NULL,
    pct          numeric(5,2)  NOT NULL,
    PRIMARY KEY (apuracao_id, numero)
);

-- Último snapshot aceito de cada abrangência.
CREATE OR REPLACE VIEW vw_ultima_apuracao AS
SELECT DISTINCT ON (abrangencia) *
  FROM apuracao
 ORDER BY abrangencia, gerado_em DESC;

-- Atraso entre a geração no TSE e a chegada ao nosso banco (insumo para o SLO de frescor).
CREATE OR REPLACE VIEW vw_atraso_ingestao AS
SELECT abrangencia, gerado_em, recebido_em, recebido_em - gerado_em AS atraso
  FROM apuracao;

-- Evolução dos votos de cada candidato ao longo da apuração.
CREATE OR REPLACE VIEW vw_evolucao_candidato AS
SELECT a.abrangencia, a.gerado_em, a.pct_secoes, c.numero, c.nome, c.votos, c.pct
  FROM apuracao a
  JOIN apuracao_candidato c ON c.apuracao_id = a.id;
