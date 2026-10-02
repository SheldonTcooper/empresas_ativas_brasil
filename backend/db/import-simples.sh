#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# import-simples.sh — Importa só a tabela do Simples Nacional (MEI)
#
# Não mexe nas empresas/estabelecimentos já importados. Use quando a base
# já está carregada e só falta identificar os MEI (porte "MEI" no painel).
#
# USO:
#   export DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/cnpj_rf"
#   bash backend/db/import-simples.sh
#
# Espaço: ~1 GB temporário. Tempo: 5–15 min.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

DB_URL="${DATABASE_URL:?Defina DATABASE_URL antes de rodar o script}"
RF_BASE="${RF_BASE:-https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/2026-09-14}"
WORK_DIR="${WORK_DIR:-/tmp/cnpj_simples}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

log "Garantindo schema (tabelas e índices novos)..."
psql "$DB_URL" -f "$SCRIPT_DIR/schema.sql"

if [ ! -f Simples.zip ]; then
  log "Baixando Simples.zip..."
  wget -q -c "${RF_BASE}/Simples.zip" -O Simples.zip || curl -# -L --retry 3 "${RF_BASE}/Simples.zip" -o Simples.zip
fi
rm -rf Simples_dir
unzip -o -q Simples.zip -d Simples_dir

# Carrega numa tabela auxiliar e troca de uma vez: o painel não fica sem MEI durante a carga
psql "$DB_URL" -c "DROP TABLE IF EXISTS simples_novo; CREATE TABLE simples_novo (LIKE simples INCLUDING ALL);"
for f in Simples_dir/*; do
  [ -f "$f" ] || continue
  log "  → Importando $(basename "$f")"
  # Datas "00000000" viram vazio (a partir da 2ª coluna; a 1ª é o CNPJ básico)
  awk -F';' 'BEGIN{OFS=";"} {for(i=2;i<=NF;i++) if($i=="\"00000000\"") $i="\"\""; print}' "$f" | \
    psql "$DB_URL" -c "\COPY simples_novo FROM STDIN WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"', FORCE_NULL (data_opcao_simples, data_exclusao_simples, data_opcao_mei, data_exclusao_mei))"
done

# A view v_empresa_ativa depende de simples: sai junto e o schema.sql recria
psql "$DB_URL" -c "BEGIN; DROP VIEW IF EXISTS v_empresa_ativa; DROP TABLE simples; ALTER TABLE simples_novo RENAME TO simples; COMMIT;"
psql "$DB_URL" -f "$SCRIPT_DIR/schema.sql"
psql "$DB_URL" -c "ANALYZE simples;"
rm -rf Simples_dir Simples.zip

log "✅ Simples importado."
psql "$DB_URL" -c "SELECT COUNT(*) AS cnpjs_no_simples, COUNT(*) FILTER (WHERE opcao_mei = 'S') AS mei FROM simples;"
