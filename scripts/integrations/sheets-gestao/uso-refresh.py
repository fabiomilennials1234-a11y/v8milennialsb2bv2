# -*- coding: utf-8 -*-
"""Gera o Relatorio de Uso da planilha GESTAO com dados vivos do Torque prod.

- Le a coluna B (cliente) da aba comercial AO VIVO -> alinhamento por linha, sem offset.
- NAO escreve nada na aba comercial (somente leitura). Todo output vai pra aba propria.
- (Re)cria a aba de detalhe com metricas por cliente + orgs do Torque fora da planilha.

Auth Sheets: token do gcloud (`gcloud auth print-access-token`).
Auth Supabase: token sbp_ lido de .env.development (nunca impresso).
"""
import re, json, subprocess, unicodedata, urllib.request, urllib.parse, datetime

SID = '1gFXmjV8rCpOaAO8IexycK64hvo2JGqirNCnZTs7jeJA'
TAB = 'Cópia de Página1'
DETAIL_TAB = 'Uso — 2026-07-29'
TODAY = '2026-07-29'
PROJECT = 'jsjsmuncfkbsbzqzqhfq'

SBP = re.search(r'sbp_[A-Za-z0-9]+', open('.env.development', encoding='utf-8', errors='ignore').read()).group(0)
GTOK = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True, shell=True).stdout.strip()
assert GTOK, 'gcloud sem token'


def db(sql):
    b = json.dumps({'query': sql}).encode()
    r = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=b, method='POST',
        headers={'Authorization': 'Bearer ' + SBP, 'Content-Type': 'application/json', 'User-Agent': 't/1'})
    return json.loads(urllib.request.urlopen(r).read())


def sheet(method, path, params='', data=None):
    u = f'https://sheets.googleapis.com/v4/spreadsheets/{SID}{path}'
    if params:
        u += '?' + params
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(u, data=body, method=method,
                               headers={'Authorization': 'Bearer ' + GTOK, 'Content-Type': 'application/json'})
    try:
        return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read().decode()[:800])
        raise


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s)).strip()


# ---------- metricas vivas ----------
orgs = db('select id, name, created_at::date criada, subscription_plan plan from organizations')


def by_org(sql):
    return {r['o']: r for r in db(sql)}


leads = by_org("""select organization_id o, count(*) tot,
  count(*) filter (where created_at > now()-interval '30 days') n30,
  count(*) filter (where created_at > now()-interval '7 days') n7,
  max(created_at)::date ult
  from leads where deleted_at is null group by 1""")
wa = by_org("""select organization_id o, count(*) w30,
  count(*) filter (where created_at > now()-interval '7 days') w7,
  count(*) filter (where sent_by_ai) ia30, max(created_at)::date ult
  from whatsapp_messages where created_at > now()-interval '30 days' group by 1""")
hist = by_org("""select organization_id o, count(*) h7,
  count(*) filter (where created_by is not null) manual7, max(created_at)::date ult
  from lead_history where created_at > now()-interval '7 days' group by 1""")
inst = by_org("""select organization_id o, count(*) tot,
  count(*) filter (where lower(status) in ('connected','open')) on_,
  max(last_connection_at)::date ult from whatsapp_instances group by 1""")
wf = by_org("select organization_id o, count(*) tot, count(*) filter (where is_active) on_ from workflows group by 1")
cop = by_org("select organization_id o, count(*) tot, count(*) filter (where is_active) on_ from copilot_agents group by 1")

idx = {}
for o in orgs:
    idx.setdefault(norm(o['name']), o)

ALIAS = {
    'basic 4u': 'basic4u', 'dra isabella': 'dra isabella', 'elvera': 'elvera',
    'london': 'london cosmeticos', 'agape': 'agape zeladoria', 'labarr': 'labarr chocolate',
    'bertin distribuidora': 'bertin', 'natu flores': 'natu flores', 'albieri': 'albieri engenharia',
    'grafica cauta': 'grafica cauta', 'promove consorcios': 'promove consorcios',
    'honey cake': 'honney cake', 'zimmerman': 'zimermann', 'cantini': 'cantini alimentos',
    'hge iluminacao': 'hge iluminacao', 'dna de almas': 'dna de almas', 'cafe jurere': 'cafe jurere',
}
# nomes da planilha que NAO devem casar por substring (evita falso positivo)
NO_FUZZY = {'goletric', 'bolivar'}


def find(name):
    k = norm(name)
    if k in idx:
        return idx[k]
    a = ALIAS.get(k)
    if a and a in idx:
        return idx[a]
    if k in NO_FUZZY:
        return idx.get(k)
    for nk, o in idx.items():
        if k and (k in nk or nk in k):
            return o
    return None


def m(d, oid, key, default=0):
    return int((d.get(oid) or {}).get(key) or default)


def classify(oid):
    """(status, resumo, metricas dict)"""
    tot = m(leads, oid, 'tot'); n30 = m(leads, oid, 'n30'); n7 = m(leads, oid, 'n7')
    w30 = m(wa, oid, 'w30'); w7 = m(wa, oid, 'w7'); ia30 = m(wa, oid, 'ia30')
    h7 = m(hist, oid, 'h7'); man7 = m(hist, oid, 'manual7')
    itot = m(inst, oid, 'tot'); ion = m(inst, oid, 'on_')
    ftot = m(wf, oid, 'tot'); fon = m(wf, oid, 'on_')
    ctot = m(cop, oid, 'tot'); con = m(cop, oid, 'on_')
    ult_lead = (leads.get(oid) or {}).get('ult') or ''
    ult_wa = (wa.get(oid) or {}).get('ult') or ''
    ult = max([x for x in (ult_lead, ult_wa, (hist.get(oid) or {}).get('ult') or '') if x] or [''])

    # limiares minimos: 1 msg ou 1 evento solto nao e "uso", e verde falso engana o comercial
    crm7 = (n7 > 0) or (h7 >= 5)
    wa7 = w7 >= 10
    cop_txt = f'{con}/{ctot} on' if ctot else '—'
    det = (f'leads {n30}/30d · {n7}/7d · WA {w30}/30d · {w7}/7d · IA {ia30}/30d · '
           f'inst {ion}/{itot} on · copilot {cop_txt} · wf {fon}/{ftot} on · atividade 7d {h7} ({man7} manual)')

    if tot == 0 and w30 == 0 and ftot == 0:
        st = '⚫ ZERO USO'; res = 'Org vazia — nunca implementada.'
    elif tot == 0 and w30 == 0:
        st = '⚫ ZERO USO'; res = f'Org vazia: 0 leads, 0 msgs. {ftot} workflows criados, {fon} ligados.'
    elif not crm7 and not wa7:
        st = '🔴 PAROU'; res = f'Sem nenhuma atividade nos últimos 7d. Última: {ult or "s/ registro"}.'
    elif crm7 and not wa7:
        gap = 'sem instância WhatsApp' if itot == 0 else ('instância desconectada' if ion == 0 else f'WA mudo desde {ult_wa or "?"}')
        st = '🟡 PARCIAL'; res = f'CRM ativo, canal WhatsApp parado ({gap}).'
    elif wa7 and not crm7:
        st = '🟡 PARCIAL'; res = 'WhatsApp ativo, CRM parado (0 leads novos e 0 movimentação em 7d).'
    else:
        flags = []
        if ftot and fon == 0:
            flags.append('0 workflows ligados')
        if ctot and con == 0:
            flags.append('copilot desligado')
        if ion == 0 and itot:
            flags.append('instância desconectada')
        st = '🟢 ATIVO'; res = 'CRM + WhatsApp em uso.' + (' Atenção: ' + ', '.join(flags) + '.' if flags else '')
    return st, res, det


# ---------- coluna B ao vivo ----------
rng = urllib.parse.quote(f"'{TAB}'!A1:R62", safe="!'")
cur = sheet('GET', f'/values/{rng}', 'majorDimension=ROWS').get('values', [])
NROWS = 49  # ultima linha de cliente na aba comercial

detail_rows, mapped, sem_nome = [], set(), []
for i in range(2, NROWS):
    row = cur[i] if i < len(cur) else []
    name = (row[1] if len(row) > 1 else '').strip()
    linha = i + 1  # numero da linha na aba comercial
    if not name:
        sem_nome.append(linha)
        detail_rows.append([f'(linha {linha} sem nome)', '—', '⚠️ NÃO MAPEÁVEL', '', '', '', '', '', '', '', '', '', '',
                            'Coluna B vazia na aba comercial — preencher o cliente para medir.', ''])
        continue
    o = find(name)
    if not o:
        detail_rows.append([name, '—', '❌ SEM ORG', '', '', '', '', '', '', '', '', '', '',
                            'Cliente na planilha sem org em prod. Ação: provisionar (ou corrigir o nome).', ''])
        continue
    mapped.add(o['id'])
    oid = o['id']
    st, res, det = classify(oid)
    detail_rows.append([
        name, o['name'], st,
        m(leads, oid, 'tot'), m(leads, oid, 'n30'), m(leads, oid, 'n7'),
        m(wa, oid, 'w30'), m(wa, oid, 'w7'), m(wa, oid, 'ia30'),
        f"{m(inst, oid, 'on_')}/{m(inst, oid, 'tot')}",
        f"{m(cop, oid, 'on_')}/{m(cop, oid, 'tot')}",
        f"{m(wf, oid, 'on_')}/{m(wf, oid, 'tot')}",
        m(hist, oid, 'h7'), res, det,
    ])

# ---------- orgs fora da planilha ----------
SKIP = {'qa test org', 'integration test org', 'organizacao principal'}
INTERNAS = {'milennials'}
fora = []
for o in orgs:
    if o['id'] in mapped or norm(o['name']) in SKIP:
        continue
    oid = o['id']
    st, res, det = classify(oid)
    k = norm(o['name'])
    if k in INTERNAS:
        st, res = '⚪ INTERNA', 'Org da própria Milennials — não é receita.'
    elif k.startswith('teste') or 'testevideo' in k:
        st, res = '⚪ TESTE', 'Org de teste com tráfego real — confirmar se é cliente disfarçado.'
    score = m(leads, oid, 'n30') + m(wa, oid, 'w30') + m(hist, oid, 'h7')
    fora.append((score, [
        '(fora da planilha)', o['name'], st,
        m(leads, oid, 'tot'), m(leads, oid, 'n30'), m(leads, oid, 'n7'),
        m(wa, oid, 'w30'), m(wa, oid, 'w7'), m(wa, oid, 'ia30'),
        f"{m(inst, oid, 'on_')}/{m(inst, oid, 'tot')}",
        f"{m(cop, oid, 'on_')}/{m(cop, oid, 'tot')}",
        f"{m(wf, oid, 'on_')}/{m(wf, oid, 'tot')}",
        m(hist, oid, 'h7'), res, det,
    ]))
fora.sort(key=lambda x: -x[0])

# ---------- aba de detalhe ----------
meta = sheet('GET', '', 'fields=sheets.properties')
gid = next((s['properties']['sheetId'] for s in meta['sheets'] if s['properties']['title'] == DETAIL_TAB), None)
if gid is None:
    gid = sheet('POST', ':batchUpdate', data={'requests': [
        {'addSheet': {'properties': {'title': DETAIL_TAB, 'gridProperties': {'rowCount': 200, 'columnCount': 14}}}}
    ]})['replies'][0]['addSheet']['properties']['sheetId']
else:
    sheet('POST', ':batchUpdate', data={'requests': [
        {'updateCells': {'range': {'sheetId': gid}, 'fields': 'userEnteredValue'}}]})

HEAD = ['Cliente (planilha)', 'Org no Torque', 'Status', 'Leads total', 'Leads 30d', 'Leads 7d',
        'WA msgs 30d', 'WA msgs 7d', 'Msgs IA 30d', 'Inst. on/tot', 'Copilot on/tot', 'WF on/tot',
        'Movim. 7d', 'Leitura', 'Evidência (medida)']
NC = len(HEAD)
TITLE = [f'TORQUE — uso medido em {TODAY} · fonte: prod ({PROJECT}) · 🟢 CRM+WhatsApp nos 7d · '
         f'🟡 só um canal · 🔴 usou no mês, parou na semana · ⚫ org vazia']
SEP = ['— ORGS NO TORQUE FORA DA PLANILHA (ordenadas por atividade) —'] + [''] * (NC - 1)
vals = [TITLE, HEAD] + detail_rows + [[''] * NC, SEP] + [r for _, r in fora]
sheet('PUT', f'/values/{urllib.parse.quote(DETAIL_TAB + "!A1", safe="!")}', 'valueInputOption=RAW',
      {'range': DETAIL_TAB + '!A1', 'majorDimension': 'ROWS', 'values': vals})

# ---------- formatacao da aba de detalhe ----------
def gc(h):
    return {'red': int(h[0:2], 16) / 255, 'green': int(h[2:4], 16) / 255, 'blue': int(h[4:6], 16) / 255}


DARK, HEADBG, GOLD, WHITE = gc('0E1116'), gc('1B2330'), gc('F5C518'), gc('FFFFFF')
ZEBRA, GREEN, AMBER, RED, GREY = gc('F3F6FA'), gc('D6F5DF'), gc('FCEFC7'), gc('F9D7D7'), gc('E6E8EB')
n = len(vals)
reqs = [
    {'updateSheetProperties': {'properties': {'sheetId': gid, 'gridProperties': {'frozenRowCount': 2}},
                               'fields': 'gridProperties.frozenRowCount'}},
    {'mergeCells': {'range': {'sheetId': gid, 'startRowIndex': 0, 'endRowIndex': 1,
                              'startColumnIndex': 0, 'endColumnIndex': NC}, 'mergeType': 'MERGE_ALL'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': 0, 'endRowIndex': 1},
                    'cell': {'userEnteredFormat': {'backgroundColor': DARK, 'verticalAlignment': 'MIDDLE',
                                                   'padding': {'left': 12},
                                                   'textFormat': {'foregroundColor': GOLD, 'bold': True, 'fontSize': 13}}},
                    'fields': 'userEnteredFormat(backgroundColor,verticalAlignment,padding,textFormat)'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': 1, 'endRowIndex': 2},
                    'cell': {'userEnteredFormat': {'backgroundColor': HEADBG, 'horizontalAlignment': 'CENTER',
                                                   'verticalAlignment': 'MIDDLE', 'wrapStrategy': 'WRAP',
                                                   'textFormat': {'foregroundColor': WHITE, 'bold': True, 'fontSize': 10}}},
                    'fields': 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'}},
    {'updateDimensionProperties': {'range': {'sheetId': gid, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1},
                                   'properties': {'pixelSize': 38}, 'fields': 'pixelSize'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': 2, 'endRowIndex': n},
                    'cell': {'userEnteredFormat': {'verticalAlignment': 'TOP', 'textFormat': {'fontSize': 10}}},
                    'fields': 'userEnteredFormat(verticalAlignment,textFormat)'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': 2, 'endRowIndex': n,
                              'startColumnIndex': 3, 'endColumnIndex': 13},
                    'cell': {'userEnteredFormat': {'horizontalAlignment': 'CENTER'}},
                    'fields': 'userEnteredFormat.horizontalAlignment'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': 2, 'endRowIndex': n,
                              'startColumnIndex': 13, 'endColumnIndex': NC},
                    'cell': {'userEnteredFormat': {'wrapStrategy': 'WRAP'}},
                    'fields': 'userEnteredFormat.wrapStrategy'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': 2, 'endRowIndex': n,
                              'startColumnIndex': 0, 'endColumnIndex': 2},
                    'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 10}}},
                    'fields': 'userEnteredFormat.textFormat'}},
]
for c, px in {0: 170, 1: 170, 2: 130, 3: 80, 4: 80, 5: 72, 6: 92, 7: 88, 8: 88, 9: 88, 10: 96, 11: 84,
              12: 84, 13: 330, 14: 460}.items():
    reqs.append({'updateDimensionProperties': {'range': {'sheetId': gid, 'dimension': 'COLUMNS',
                                                         'startIndex': c, 'endIndex': c + 1},
                                               'properties': {'pixelSize': px}, 'fields': 'pixelSize'}})
for t, bg in [('🟢', GREEN), ('🟡', AMBER), ('🔴', RED), ('⚫', GREY), ('❌', GREY), ('⚠️', AMBER), ('⚪', GREY)]:
    reqs.append({'addConditionalFormatRule': {'rule': {
        'ranges': [{'sheetId': gid, 'startRowIndex': 2, 'endRowIndex': n, 'startColumnIndex': 2, 'endColumnIndex': 3}],
        'booleanRule': {'condition': {'type': 'TEXT_CONTAINS', 'values': [{'userEnteredValue': t}]},
                        'format': {'backgroundColor': bg, 'textFormat': {'bold': True}}}}, 'index': 0}})
sheet('POST', ':batchUpdate', data={'requests': reqs})
print(f'aba "{DETAIL_TAB}" escrita:', n, 'linhas · clientes', len(detail_rows), '· fora da planilha', len(fora))
print('aba comercial NAO tocada (somente leitura da coluna B)')
if sem_nome:
    print('linhas sem nome na coluna B:', sem_nome)
tally = {}
for r in detail_rows + [x for _, x in fora]:
    tally[r[2]] = tally.get(r[2], 0) + 1
for k, v in sorted(tally.items(), key=lambda x: -x[1]):
    print(f'  {k}: {v}')
