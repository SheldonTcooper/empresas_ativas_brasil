-- Índice para a busca por nome fantasia (GET /api/empresas/busca-nome).
-- NÃO roda sozinho: execute no servidor, em horário calmo (demora e usa vários GB de disco):
--   psql "$DATABASE_URL" -f backend/db/indice_fantasia.sql
-- CONCURRENTLY não trava o site. Depois de recriar a tabela "busca"
-- (otimizar_busca.sql), rode este arquivo de novo.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SET maintenance_work_mem = '1GB';
CREATE INDEX CONCURRENTLY IF NOT EXISTS busca_fantasia_trgm
  ON busca USING gin (nome_fantasia gin_trgm_ops)
  WHERE nome_fantasia IS NOT NULL AND nome_fantasia <> '';
ANALYZE busca;
