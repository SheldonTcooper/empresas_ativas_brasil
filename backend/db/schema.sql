-- ═══════════════════════════════════════════════════════════════════════════
-- Schema: Receita Federal / Brasil.io — dados de CNPJs
-- Executar como superuser ou dono do banco: psql -U postgres cnpj_rf < schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Extensões úteis
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Tabelas de referência ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pais (
  codigo   CHAR(3)      PRIMARY KEY,
  descricao VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS municipio (
  codigo    INTEGER      PRIMARY KEY,
  descricao VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS natureza_juridica (
  codigo    CHAR(4)      PRIMARY KEY,
  descricao VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS qualificacao (
  codigo    CHAR(2)      PRIMARY KEY,
  descricao VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS cnae (
  codigo    CHAR(7)      PRIMARY KEY,
  descricao VARCHAR(300)
);

CREATE TABLE IF NOT EXISTS motivo (
  codigo    CHAR(2)      PRIMARY KEY,
  descricao VARCHAR(200)
);

-- ── Dados da Empresa (cnpj_basico) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS empresa (
  cnpj_basico               CHAR(8)        PRIMARY KEY,
  razao_social              VARCHAR(150),
  natureza_juridica         CHAR(4),
  qualificacao_responsavel  CHAR(2),
  capital_social            NUMERIC(18,2),
  porte_empresa             CHAR(2),        -- 00=Não informado 01=ME 03=EPP 05=Demais (MEI vem de simples.opcao_mei)
  ente_federativo           VARCHAR(50)
);

-- ── Estabelecimento (cnpj completo = basico+ordem+dv) ──────────────────────

CREATE TABLE IF NOT EXISTS estabelecimento (
  cnpj_basico               CHAR(8)        NOT NULL,
  cnpj_ordem                CHAR(4)        NOT NULL,
  cnpj_dv                   CHAR(2)        NOT NULL,
  identificador_matriz_filial CHAR(1),      -- 1=MATRIZ 2=FILIAL
  nome_fantasia             VARCHAR(150),
  situacao_cadastral        CHAR(2),        -- 02=ATIVA
  data_situacao_cadastral   DATE,
  motivo_situacao_cadastral CHAR(2),
  nome_cidade_exterior      VARCHAR(55),
  cod_pais                  CHAR(3),
  data_inicio_atividade     DATE,
  cnae_fiscal               CHAR(7),
  cnae_fiscal_secundaria    TEXT,
  tipo_logradouro           VARCHAR(20),
  logradouro                VARCHAR(60),
  numero                    VARCHAR(6),
  complemento               VARCHAR(156),
  bairro                    VARCHAR(50),
  cep                       CHAR(8),
  uf                        CHAR(2),
  municipio                 INTEGER,
  ddd1                      CHAR(4),
  telefone1                 CHAR(9),
  ddd2                      CHAR(4),
  telefone2                 CHAR(9),
  ddd_fax                   CHAR(4),
  fax                       CHAR(9),
  correio_eletronico        VARCHAR(115),
  situacao_especial         VARCHAR(23),
  data_situacao_especial    DATE,
  PRIMARY KEY (cnpj_basico, cnpj_ordem, cnpj_dv)
);

-- ── Simples Nacional / MEI ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simples (
  cnpj_basico          CHAR(8) PRIMARY KEY,
  opcao_pelo_simples   CHAR(1),  -- S/N
  data_opcao_simples   DATE,
  data_exclusao_simples DATE,
  opcao_mei            CHAR(1),  -- S/N
  data_opcao_mei       DATE,
  data_exclusao_mei    DATE
);

-- ── Sócios ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS socio (
  cnpj_basico              CHAR(8),
  identificador_socio      CHAR(1),  -- 1=PJ 2=PF 3=Estrangeiro
  nome_socio               VARCHAR(150),
  cpf_cnpj_socio           VARCHAR(14),
  qualificacao_socio       CHAR(2),
  data_entrada_sociedade   DATE,
  pais                     CHAR(3),
  representante_legal      CHAR(11),
  nome_representante       VARCHAR(60),
  qualificacao_representante CHAR(2),
  faixa_etaria             CHAR(1)
);

-- ── LGPD: pedidos de remoção e CNPJs ocultados ─────────────────────────────
-- Não são apagadas pela importação (o import só faz TRUNCATE das tabelas da Receita).

CREATE TABLE IF NOT EXISTS pedido_remocao (
  id          SERIAL       PRIMARY KEY,
  cnpj        CHAR(14)     NOT NULL,
  nome        VARCHAR(150) NOT NULL,
  email       VARCHAR(150) NOT NULL,
  motivo      TEXT,
  ip          VARCHAR(45),
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status      VARCHAR(20)  NOT NULL DEFAULT 'pendente'   -- pendente | aprovado | recusado
);

-- CNPJ nesta tabela some de todas as buscas, contagens e exportações
CREATE TABLE IF NOT EXISTS cnpj_oculto (
  cnpj        CHAR(14)     PRIMARY KEY,
  pedido_id   INTEGER      REFERENCES pedido_remocao(id),
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Enriquecimento por IA (site e perfis públicos encontrados na web) ──────
-- Uma linha por CNPJ completo; não é apagada pela importação.
CREATE TABLE IF NOT EXISTS enriquecimento (
  cnpj        CHAR(14)     PRIMARY KEY,
  site        TEXT,
  instagram   TEXT,
  facebook    TEXT,
  linkedin    TEXT,
  confianca   VARCHAR(5),               -- alta | media | baixa
  resumo      TEXT,
  fontes      JSONB,                    -- URLs que a busca visitou
  descartados JSONB,                    -- links sugeridos que não apareceram na busca
  modelo      VARCHAR(60),
  status      VARCHAR(10)  NOT NULL,    -- ok | nada
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ÍNDICES — críticos para performance das queries
-- ═══════════════════════════════════════════════════════════════════════════

-- O painel consulta a tabela "busca" (db/otimizar_busca.sql), que tem os próprios
-- índices. As tabelas da Receita ficam só com a chave primária: a consulta por
-- CNPJ usa o PK, e menos índices deixam a importação mensal bem mais rápida.

-- Sócios por CNPJ
CREATE INDEX IF NOT EXISTS idx_socio_basico
  ON socio (cnpj_basico);

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEW conveniente para queries frequentes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_empresa_ativa AS
SELECT
  e.cnpj_basico || est.cnpj_ordem || est.cnpj_dv AS cnpj_completo,
  e.cnpj_basico, est.cnpj_ordem, est.cnpj_dv,
  e.razao_social,
  est.nome_fantasia,
  est.identificador_matriz_filial,
  est.data_inicio_atividade,
  e.porte_empresa,
  est.cnae_fiscal,
  c.descricao AS cnae_descricao,
  est.tipo_logradouro, est.logradouro, est.numero, est.complemento,
  est.bairro, est.cep, est.uf,
  est.municipio AS municipio_ibge,
  m.descricao   AS municipio_nome,
  est.ddd1, est.telefone1,
  est.ddd2, est.telefone2,
  est.correio_eletronico,
  s.opcao_pelo_simples,
  s.opcao_mei
FROM estabelecimento est
JOIN empresa e   ON e.cnpj_basico  = est.cnpj_basico
LEFT JOIN municipio m ON m.codigo  = est.municipio
LEFT JOIN cnae c      ON c.codigo  = est.cnae_fiscal
LEFT JOIN simples s   ON s.cnpj_basico = est.cnpj_basico
WHERE est.situacao_cadastral = '02';
