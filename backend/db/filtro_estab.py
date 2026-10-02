# Filtra o CSV de Estabelecimentos da Receita respeitando o quoting e limpa datas inválidas.
#
# SITUACOES (env) define quais situações cadastrais entram, separadas por vírgula:
#   01=NULA 02=ATIVA 03=SUSPENSA 04=INAPTA 08=BAIXADA
# Padrão: só ativas (02). Ex.: SITUACOES=02,04 importa ativas e inaptas.
import csv, sys, io, os

SITUACOES = {s.strip().zfill(2) for s in os.environ.get("SITUACOES", "02").split(",") if s.strip()}

inp = io.TextIOWrapper(sys.stdin.buffer, encoding="latin-1", newline="")
out = io.TextIOWrapper(sys.stdout.buffer, encoding="latin-1", newline="")
reader = csv.reader(inp, delimiter=";", quotechar='"')
writer = csv.writer(out, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\n")
DATE_COLS = [6, 10, 29]  # data_situacao_cadastral, data_inicio_atividade, data_situacao_especial
for row in reader:
    if len(row) > 5 and row[5].strip().zfill(2) in SITUACOES:
        for idx in DATE_COLS:
            if idx < len(row):
                v = row[idx]
                if v and not (v.isdigit() and len(v) == 8):
                    row[idx] = ""
        writer.writerow(row)
out.flush()
