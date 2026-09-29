#!/usr/bin/env bash
set -uo pipefail

DB_URL="${DATABASE_URL:?defina DATABASE_URL}"
RF_BASE="https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/2026-09-14"
WORK_DIR="/tmp/cnpj_estab"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

dl() {
  local url="$1" out="$2"
  [ -f "$out" ] && log "  (ja existe) $out" && return 0
  log "  -> baixando $(basename "$out")"
  wget -q -c "$url" -O "$out" || curl -# -L --retry 3 "$url" -o "$out"
}

psql "$DB_URL" -c "DROP TABLE IF EXISTS estabelecimento_staging; CREATE TABLE estabelecimento_staging (LIKE estabelecimento);"

for i in 0 1 2 3 4 5 6 7 8 9; do
  zip="Estabelecimentos${i}.zip"
  dl "${RF_BASE}/${zip}" "$zip"
  unzip -o -q "$zip" -d "Est${i}_dir"
  for f in "Est${i}_dir"/*; do
    [ -f "$f" ] || continue
    log "Estabelecimentos parte $i: filtrando (python) + importando..."
    psql "$DB_URL" -c "TRUNCATE estabelecimento_staging"
    python3 /var/www/empresas_ativas_brasil/backend/db/filtro_ativos.py < "$f" | \
      psql "$DB_URL" -c "\COPY estabelecimento_staging FROM STDIN WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"', FORCE_NULL (data_situacao_cadastral, data_inicio_atividade, data_situacao_especial))"
    log "Estabelecimentos parte $i: mesclando..."
    psql "$DB_URL" -c "INSERT INTO estabelecimento SELECT * FROM estabelecimento_staging ON CONFLICT (cnpj_basico, cnpj_ordem, cnpj_dv) DO NOTHING"
  done
  rm -rf "Est${i}_dir" "$zip"
  log "Estabelecimentos parte $i concluida"
done

log "ESTABELECIMENTOS COMPLETO!"
psql "$DB_URL" -c "SELECT 'empresa' t, count(*) FROM empresa UNION ALL SELECT 'estabelecimento', count(*) FROM estabelecimento UNION ALL SELECT 'municipio', count(*) FROM municipio UNION ALL SELECT 'cnae', count(*) FROM cnae;"
