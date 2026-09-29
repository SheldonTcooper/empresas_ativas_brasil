import csv, sys, io
inp = io.TextIOWrapper(sys.stdin.buffer, encoding="latin-1", newline="")
out = io.TextIOWrapper(sys.stdout.buffer, encoding="latin-1", newline="")
reader = csv.reader(inp, delimiter=";", quotechar='"')
writer = csv.writer(out, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\n")
DATE_COLS = [6, 10, 29]  # data_situacao_cadastral, data_inicio_atividade, data_situacao_especial
for row in reader:
    if len(row) > 5 and row[5] == "02":
        for idx in DATE_COLS:
            if idx < len(row):
                v = row[idx]
                if v and not (v.isdigit() and len(v) == 8):
                    row[idx] = ""
        writer.writerow(row)
out.flush()
