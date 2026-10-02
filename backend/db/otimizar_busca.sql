-- ═══════════════════════════════════════════════════════════════════════════
-- Tabela "busca": o que o painel consulta, já pronto, sem JOIN.
--
-- Junta estabelecimento (só ativos) + empresa (razão social, porte) + simples
-- (Simples/MEI) e grava fisicamente ordenada por município e CNAE, com índices
-- na ordem exata da tela (município|UF + CNAE + nome). Assim cada página é uma
-- leitura direta de índice, mesmo com 100 mil empresas no resultado.
--
-- Rodar depois de toda importação (import-fast.sh e import-simples.sh já chamam):
--   psql "$DATABASE_URL" -f backend/db/otimizar_busca.sql
-- Monta "busca_nova" e troca de uma vez no fim: o site não fica fora do ar.
-- Tempo: ~20–40 min. Espaço: ~15 GB enquanto as duas versões coexistem.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\timing on
SET maintenance_work_mem = '1GB';
SET work_mem = '256MB';

DROP TABLE IF EXISTS busca_nova;

CREATE TABLE busca_nova AS
SELECT
  est.cnpj_basico, est.cnpj_ordem, est.cnpj_dv,
  est.identificador_matriz_filial, est.nome_fantasia, est.data_inicio_atividade,
  est.cnae_fiscal, est.cnae_fiscal_secundaria,
  est.tipo_logradouro, est.logradouro, est.numero, est.complemento, est.bairro, est.cep,
  est.uf, est.municipio,
  est.ddd1, est.telefone1, est.ddd2, est.telefone2, est.correio_eletronico,
  e.razao_social, e.porte_empresa,
  s.opcao_pelo_simples, s.opcao_mei,
  -- "01.363.328 FULANO" (MEI com CNPJ no nome) ordena pelo nome, não pelo número
  coalesce(regexp_replace(e.razao_social, '^[0-9]{2}[.][0-9]{3}[.][0-9]{3} *', ''), '')::text AS nome_ordem
FROM estabelecimento est
LEFT JOIN empresa e ON e.cnpj_basico = est.cnpj_basico
LEFT JOIN simples s ON s.cnpj_basico = est.cnpj_basico
WHERE est.situacao_cadastral = '02'
ORDER BY est.municipio, est.cnae_fiscal;  -- vizinhos no disco = leitura sequencial

ALTER TABLE busca_nova ADD CONSTRAINT busca_nova_pkey PRIMARY KEY (cnpj_basico, cnpj_ordem, cnpj_dv);
-- Lista, contagem e CNAEs por município / por estado (INCLUDE cnpj_dv: contagem só pelo índice)
CREATE INDEX busca_nova_mun_cnae_nome ON busca_nova (municipio, cnae_fiscal, nome_ordem, cnpj_basico, cnpj_ordem) INCLUDE (cnpj_dv);
CREATE INDEX busca_nova_uf_cnae_nome  ON busca_nova (uf, cnae_fiscal, nome_ordem, cnpj_basico, cnpj_ordem) INCLUDE (cnpj_dv);
-- Municípios de cada estado
CREATE INDEX busca_nova_uf_mun        ON busca_nova (uf, municipio);
-- "Abertas nos últimos N dias" e aberturas do mês no mapa
CREATE INDEX busca_nova_abertura      ON busca_nova (data_inicio_atividade);
-- CNAE secundário — a API usa exatamente esta expressão
CREATE INDEX busca_nova_cnae_sec      ON busca_nova USING gin ((string_to_array(cnae_fiscal_secundaria, ',')));

VACUUM ANALYZE busca_nova;

BEGIN;
DROP TABLE IF EXISTS busca;
ALTER TABLE busca_nova RENAME TO busca;
ALTER INDEX busca_nova_pkey          RENAME TO busca_pkey;
ALTER INDEX busca_nova_mun_cnae_nome RENAME TO busca_mun_cnae_nome;
ALTER INDEX busca_nova_uf_cnae_nome  RENAME TO busca_uf_cnae_nome;
ALTER INDEX busca_nova_uf_mun        RENAME TO busca_uf_mun;
ALTER INDEX busca_nova_abertura      RENAME TO busca_abertura;
ALTER INDEX busca_nova_cnae_sec      RENAME TO busca_cnae_sec;
COMMIT;

SELECT COUNT(*) AS empresas_ativas_na_busca, pg_size_pretty(pg_total_relation_size('busca')) AS tamanho FROM busca;
