#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# import.sh — Importa dados da Receita Federal para PostgreSQL
#
# USO:  bash import.sh
# PRÉ-REQUISITOS: psql, unzip, wget/curl
#
# Tempo estimado: 30-90 min dependendo da VPS
# Espaço em disco necessário: ~50GB (downloads + banco)
# ═══════════════════════════════════════════════════════════════════════════

set -e

# ── Configuração ────────────────────────────────────────────────────────────
DB_URL="${DATABASE_URL:-postgresql://empresas:SENHA@localhost:5432/cnpj_rf}"
RF_BASE="https://dadosabertos.rfb.gov.br/CNPJ"
WORK_DIR="${WORK_DIR:-/tmp/cnpj_import}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "🗄  Banco: $DB_URL"
echo "📁  Diretório de trabalho: $WORK_DIR"
echo ""

# ── Função de importação CSV → PostgreSQL ───────────────────────────────────
import_csv() {
  local file="$1"
  local table="$2"
  local sep="${3:-;}"
  echo "  → Importando $file em $table..."
  psql "$DB_URL" -c "\COPY $table FROM '$file' WITH (FORMAT CSV, DELIMITER '$sep', ENCODING 'LATIN1', HEADER FALSE, QUOTE '\"')"
}

# ── Schema ──────────────────────────────────────────────────────────────────
echo "📐 Criando schema..."
psql "$DB_URL" -f "$SCRIPT_DIR/schema.sql"

# ── Tabelas de referência (pequenas, rápido) ────────────────────────────────
echo ""
echo "📦 Baixando tabelas de referência..."

for arquivo in Municipios Cnaes Naturezas Qualificacoes Paises Motivos; do
  zip="${arquivo}.zip"
  echo "  ↓ $zip"
  wget -q --show-progress "${RF_BASE}/${zip}" -O "$zip" || curl -# -L "${RF_BASE}/${zip}" -o "$zip"
  unzip -o -q "$zip" -d "${arquivo}_dir"
done

# Mapeia arquivo → tabela
declare -A REF_MAP=(
  ["Municipios_dir"]="municipio"
  ["Cnaes_dir"]="cnae"
  ["Naturezas_dir"]="natureza_juridica"
  ["Qualificacoes_dir"]="qualificacao"
  ["Paises_dir"]="pais"
  ["Motivos_dir"]="motivo"
)

for dir in "${!REF_MAP[@]}"; do
  table="${REF_MAP[$dir]}"
  psql "$DB_URL" -c "TRUNCATE $table"
  for f in ${dir}/*.csv ${dir}/*.CSV; do
    [ -f "$f" ] && import_csv "$f" "$table"
  done
done

# ── Simples Nacional ────────────────────────────────────────────────────────
echo ""
echo "📦 Baixando Simples Nacional..."
wget -q --show-progress "${RF_BASE}/Simples.zip" -O Simples.zip || \
  curl -# -L "${RF_BASE}/Simples.zip" -o Simples.zip
unzip -o -q Simples.zip -d Simples_dir
psql "$DB_URL" -c "TRUNCATE simples"
for f in Simples_dir/*.csv Simples_dir/*.CSV; do
  [ -f "$f" ] && import_csv "$f" "simples"
done

# ── Empresas (10 partes) ────────────────────────────────────────────────────
echo ""
echo "📦 Baixando Empresas (10 partes)..."
psql "$DB_URL" -c "TRUNCATE empresa CASCADE"
for i in $(seq 0 9); do
  zip="Empresas${i}.zip"
  echo "  ↓ $zip"
  wget -q --show-progress "${RF_BASE}/${zip}" -O "$zip" || \
    curl -# -L "${RF_BASE}/${zip}" -o "$zip"
  unzip -o -q "$zip" -d "Empresas${i}_dir"
  for f in "Empresas${i}_dir"/*.csv "Empresas${i}_dir"/*.CSV; do
    [ -f "$f" ] && import_csv "$f" "empresa"
  done
  rm -rf "Empresas${i}_dir" "$zip"
  echo "  ✓ Parte $i concluída"
done

# ── Estabelecimentos (10 partes, maior dataset) ─────────────────────────────
echo ""
echo "📦 Baixando Estabelecimentos (10 partes — maior dataset)..."
psql "$DB_URL" -c "TRUNCATE estabelecimento"
for i in $(seq 0 9); do
  zip="Estabelecimentos${i}.zip"
  echo "  ↓ $zip"
  wget -q --show-progress "${RF_BASE}/${zip}" -O "$zip" || \
    curl -# -L "${RF_BASE}/${zip}" -o "$zip"
  unzip -o -q "$zip" -d "Est${i}_dir"
  for f in "Est${i}_dir"/*.csv "Est${i}_dir"/*.CSV; do
    [ -f "$f" ] && import_csv "$f" "estabelecimento"
  done
  rm -rf "Est${i}_dir" "$zip"
  echo "  ✓ Parte $i concluída"
done

# ── Sócios (10 partes) ──────────────────────────────────────────────────────
echo ""
echo "📦 Baixando Sócios..."
psql "$DB_URL" -c "TRUNCATE socio"
for i in $(seq 0 9); do
  zip="Socios${i}.zip"
  echo "  ↓ $zip"
  wget -q --show-progress "${RF_BASE}/${zip}" -O "$zip" || \
    curl -# -L "${RF_BASE}/${zip}" -o "$zip"
  unzip -o -q "$zip" -d "Socios${i}_dir"
  for f in "Socios${i}_dir"/*.csv "Socios${i}_dir"/*.CSV; do
    [ -f "$f" ] && import_csv "$f" "socio"
  done
  rm -rf "Socios${i}_dir" "$zip"
done

# ── Criando índices ─────────────────────────────────────────────────────────
echo ""
echo "🔍 Criando índices (pode demorar 5-15 min)..."
psql "$DB_URL" -c "ANALYZE estabelecimento; ANALYZE empresa;"

echo ""
echo "✅ Importação concluída!"
echo ""

# Estatísticas
psql "$DB_URL" -c "
SELECT
  (SELECT COUNT(*) FROM empresa)          AS total_empresas,
  (SELECT COUNT(*) FROM estabelecimento)  AS total_estabelecimentos,
  (SELECT COUNT(*) FROM estabelecimento WHERE situacao_cadastral='02') AS ativas,
  (SELECT COUNT(*) FROM municipio)        AS municipios,
  (SELECT COUNT(*) FROM cnae)             AS cnaes;
"
