#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# import-fast.sh — Importação enxuta da Receita Federal
#
# Baixa APENAS o necessário para o sistema funcionar:
#   • Municípios + CNAEs (referência, pequenos)
#   • Empresas     (razão social, porte — 10 partes)
#   • Estabelecimentos ATIVOS apenas (CNAE, telefone, endereço — 10 partes)
#
# Sócios e Simples Nacional são pulados — não são usados pelo app.
#
# USO:
#   export DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/cnpj_rf"
#   bash backend/db/import-fast.sh
#
# Espaço necessário: ~12 GB temporário, ~6 GB no banco
# Tempo estimado:    15–30 min dependendo da velocidade da VPS
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

DB_URL="${DATABASE_URL:?Defina DATABASE_URL antes de rodar o script}"
RF_BASE="https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/2026-09-14"
WORK_DIR="${WORK_DIR:-/tmp/cnpj_fast}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Schema ──────────────────────────────────────────────────────────
log "Criando schema..."
psql "$DB_URL" -f "$SCRIPT_DIR/schema.sql"

# ── Função: download com retry ───────────────────────────────────────
dl() {
  local url="$1" out="$2"
  [ -f "$out" ] && log "  (já existe) $out" && return 0
  log "  ↓ $(basename "$out")"
  wget -q --show-progress -c "$url" -O "$out" 2>&1 || \
    curl -# -L --retry 3 "$url" -o "$out"
}

# ── Função: importar CSV para tabela ────────────────────────────────
import_csv() {
  local file="$1" table="$2"
  log "  → Importando $(basename "$file") → $table"
  psql "$DB_URL" -c "\COPY $table FROM '$file' WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"')"
}

# ── Municípios ───────────────────────────────────────────────────────
log "Municípios e CNAEs..."
psql "$DB_URL" -c "TRUNCATE municipio, cnae"

for arq in Municipios Cnaes; do
  dl "${RF_BASE}/${arq}.zip" "${arq}.zip"
  unzip -o -q "${arq}.zip" -d "${arq}_dir"
  for f in "${arq}_dir"/*; do
    [ -f "$f" ] && import_csv "$f" "$(echo "$arq" | tr '[:upper:]' '[:lower:]' | sed 's/municipios/municipio/;s/cnaes/cnae/')"
  done
  rm -rf "${arq}_dir"
done

# ── Empresas (10 partes) ─────────────────────────────────────────────
log "Empresas (10 partes)..."
psql "$DB_URL" -c "TRUNCATE empresa CASCADE"

for i in $(seq 0 9); do
  zip="Empresas${i}.zip"
  dl "${RF_BASE}/${zip}" "$zip"
  unzip -o -q "$zip" -d "Emp${i}_dir"
  for f in "Emp${i}_dir"/*; do
    if [ -f "$f" ]; then
      log "  -> Importando $(basename "$f") -> empresa (convertendo virgula decimal)"
      awk -F';' 'BEGIN{OFS=";"} {gsub(",", ".", $5); print}' "$f" | \
        psql "$DB_URL" -c "\COPY empresa FROM STDIN WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"')"
    fi
  done
  rm -rf "Emp${i}_dir" "$zip"
  log "  ✓ Empresas parte $i"
done

# ── Estabelecimentos ATIVOS (campo 6 = situacao_cadastral = '02') ────
log "Estabelecimentos ativos (10 partes — filtrando só ativas)..."
psql "$DB_URL" -c "TRUNCATE estabelecimento"

for i in $(seq 0 9); do
  zip="Estabelecimentos${i}.zip"
  dl "${RF_BASE}/${zip}" "$zip"
  unzip -o -q "$zip" -d "Est${i}_dir"

  for f in "Est${i}_dir"/*; do
    [ -f "$f" ] || continue
    log "  → Filtrando ativos de $(basename "$f")..."
    # Coluna 6 (índice 5) = situacao_cadastral; '02' = Ativa
    awk -F';' '$6=="02"' "$f" | \
      psql "$DB_URL" -c "\COPY estabelecimento FROM STDIN WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"')"
  done

  rm -rf "Est${i}_dir" "$zip"
  log "  ✓ Estabelecimentos parte $i"
done

# ── Índices e estatísticas ────────────────────────────────────────────
log "Atualizando estatísticas do banco..."
psql "$DB_URL" -c "ANALYZE estabelecimento; ANALYZE empresa;"

log ""
log "✅ Importação concluída!"
psql "$DB_URL" -c "
SELECT
  (SELECT COUNT(*)  FROM empresa)         AS total_empresas,
  (SELECT COUNT(*)  FROM estabelecimento) AS estabelecimentos_ativos,
  (SELECT COUNT(*)  FROM municipio)       AS municipios,
  (SELECT COUNT(*)  FROM cnae)            AS cnaes;
"
