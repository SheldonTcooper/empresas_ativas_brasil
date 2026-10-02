#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# import-fast.sh — Importação enxuta da Receita Federal
#
# Baixa APENAS o necessário para o sistema funcionar:
#   • Municípios + CNAEs (referência, pequenos)
#   • Empresas     (razão social, porte — 10 partes)
#   • Estabelecimentos ATIVOS apenas (CNAE, telefone, endereço — 10 partes)
#   • Simples Nacional (identifica MEI)
#
# Sócios são pulados — não são usados pelo app.
#
# USO:
#   export DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/cnpj_rf"
#   bash backend/db/import-fast.sh
#
# Espaço necessário: ~12 GB temporário, ~7 GB no banco (+ índices)
# Tempo estimado:    20–40 min dependendo da velocidade da VPS
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

# ── Tabelas de referência ────────────────────────────────────────────
log "Municípios e CNAEs..."
psql "$DB_URL" -c "TRUNCATE municipio, cnae"

for arq in Municipios Cnaes; do
  dl "${RF_BASE}/${arq}.zip" "${arq}.zip"
  unzip -o -q "${arq}.zip" -d "${arq}_dir"
  for f in "${arq}_dir"/*; do
    [ -f "$f" ] && import_csv "$f" "$(echo "$arq" | tr '[:upper:]' '[:lower:]' | sed 's/s$//')"
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

# ── Estabelecimentos ATIVOS (situacao_cadastral = '02') ──────────────
# O filtro em Python respeita as aspas do CSV da Receita (awk compararia "02" com aspas)
export SITUACOES="02"
log "Estabelecimentos ativos (10 partes)..."
psql "$DB_URL" -c "TRUNCATE estabelecimento"

for i in $(seq 0 9); do
  zip="Estabelecimentos${i}.zip"
  dl "${RF_BASE}/${zip}" "$zip"
  unzip -o -q "$zip" -d "Est${i}_dir"

  for f in "Est${i}_dir"/*; do
    [ -f "$f" ] || continue
    log "  → Importando $(basename "$f")..."
    python3 "$SCRIPT_DIR/filtro_estab.py" < "$f" | \
      psql "$DB_URL" -c "\COPY estabelecimento FROM STDIN WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"', FORCE_NULL (data_situacao_cadastral, data_inicio_atividade, data_situacao_especial))"
  done

  rm -rf "Est${i}_dir" "$zip"
  log "  ✓ Estabelecimentos parte $i"
done

# ── Simples Nacional (opcao_mei identifica MEI) ──────────────────────
log "Simples Nacional..."
psql "$DB_URL" -c "TRUNCATE simples"
dl "${RF_BASE}/Simples.zip" "Simples.zip"
unzip -o -q "Simples.zip" -d "Simples_dir"
for f in "Simples_dir"/*; do
  [ -f "$f" ] || continue
  log "  → Importando $(basename "$f") → simples"
  # Datas "00000000" viram vazio (a partir da 2ª coluna; a 1ª é o CNPJ básico)
  awk -F';' 'BEGIN{OFS=";"} {for(i=2;i<=NF;i++) if($i=="\"00000000\"") $i="\"\""; print}' "$f" | \
    psql "$DB_URL" -c "\COPY simples FROM STDIN WITH (FORMAT CSV, DELIMITER ';', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"', FORCE_NULL (data_opcao_simples, data_exclusao_simples, data_opcao_mei, data_exclusao_mei))"
done
rm -rf "Simples_dir" "Simples.zip"

# ── Índices e estatísticas ────────────────────────────────────────────
log "Atualizando estatísticas do banco..."
psql "$DB_URL" -c "ANALYZE estabelecimento; ANALYZE empresa; ANALYZE simples;"

log ""
log "✅ Importação concluída!"
psql "$DB_URL" -c "
SELECT
  (SELECT COUNT(*)  FROM empresa)         AS total_empresas,
  (SELECT COUNT(*)  FROM estabelecimento) AS estabelecimentos_ativos,
  (SELECT COUNT(*)  FROM simples WHERE opcao_mei = 'S') AS mei,
  (SELECT COUNT(*)  FROM municipio)       AS municipios,
  (SELECT COUNT(*)  FROM cnae)            AS cnaes;
"
