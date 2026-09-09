import json, re
from collections import defaultdict

checks = json.load(open('/tmp/checks.json'))
funcs  = json.load(open('/tmp/funcs.json'))

# ── 1. vocabulário permitido por (tabela, coluna) ────────────────────────
vocab = {}
for c in checks:
    d = c['def']
    # (col = ANY (ARRAY['a'::text, 'b'::text]))
    m = re.search(r'\(?\(?"?([a-z_]+)"?\s*=\s*ANY\s*\(\s*\(?ARRAY\[(.*?)\]', d, re.S | re.I)
    if not m:
        continue
    col = m.group(1)
    vals = set(re.findall(r"'([^']*)'", m.group(2)))
    if vals:
        vocab.setdefault((c['tabela'], col), set()).update(vals)

print(f"vocabulários extraídos: {len(vocab)}\n")

def partes(txt):
    """Divide por vírgula no nível 0 de parênteses."""
    out, dep, cur = [], 0, ''
    for ch in txt:
        if ch == '(': dep += 1
        elif ch == ')': dep -= 1
        if ch == ',' and dep == 0:
            out.append(cur.strip()); cur = ''
        else:
            cur += ch
    if cur.strip(): out.append(cur.strip())
    return out

achados = defaultdict(set)

for f in funcs:
    body, nome = f['def'], f['proname']

    # ── INSERT INTO tabela (cols) VALUES (vals) ──────────────────────────
    for m in re.finditer(
        r'INSERT\s+INTO\s+(?:public\.)?"?([a-z_]+)"?\s*\(([^;]*?)\)\s*VALUES\s*\((.*?)\)\s*(?:ON\s+CONFLICT|RETURNING|;)',
        body, re.S | re.I):
        tab, cols_raw, vals_raw = m.group(1), m.group(2), m.group(3)
        cols = [c.strip().strip('"') for c in partes(cols_raw)]
        vals = partes(vals_raw)
        if len(cols) != len(vals):
            continue
        for col, val in zip(cols, vals):
            permitido = vocab.get((tab, col))
            if not permitido:
                continue
            lit = re.fullmatch(r"'([^']*)'(?:::[a-z ]+)?", val.strip())
            if lit and lit.group(1) not in permitido:
                achados[(tab, col)].add((nome, lit.group(1), 'INSERT'))

    # ── SET col = 'literal' ──────────────────────────────────────────────
    for m in re.finditer(r'UPDATE\s+(?:public\.)?"?([a-z_]+)"?\s+SET\s+(.{0,600}?)(?:WHERE|RETURNING|;)',
                         body, re.S | re.I):
        tab, sets = m.group(1), m.group(2)
        for sm in re.finditer(r'"?([a-z_]+)"?\s*=\s*\'([^\']*)\'', sets):
            col, val = sm.group(1), sm.group(2)
            permitido = vocab.get((tab, col))
            if permitido and val not in permitido:
                achados[(tab, col)].add((nome, val, 'UPDATE'))

if not achados:
    print("nenhum literal fora do vocabulário encontrado nas funções SQL")
else:
    print(f"🔴 {sum(len(v) for v in achados.values())} escrita(s) com valor fora do CHECK:\n")
    for (tab, col), itens in sorted(achados.items()):
        print(f"{tab}.{col}   permitido: {sorted(vocab[(tab,col)])}")
        for nome, val, tipo in sorted(itens):
            print(f"    ✗ '{val}'  ({tipo} em {nome})")
        print()
