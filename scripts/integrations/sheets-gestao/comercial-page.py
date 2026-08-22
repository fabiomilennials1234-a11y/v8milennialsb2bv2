# -*- coding: utf-8 -*-
"""Cria a aba COMERCIAL da planilha GESTAO.

Design: duplicata fiel de 'Cópia de Página1' (larguras, bordas, cores, formatos herdados).
Conteudo: so comercial — valor, gestor, funil, item, ticket. Zero dado de uso (coluna Q sai).
Linhas de churn (nome apagado na coluna B pelo CTO) sao removidas.
Ao final, bloco com as orgs ativas no Torque que nao tem cadastro comercial.
"""
import json, subprocess, urllib.request, urllib.parse

SID = '1gFXmjV8rCpOaAO8IexycK64hvo2JGqirNCnZTs7jeJA'
SRC_TAB = 'Cópia de Página1'
SRC_GID = 528887683
NEW_TAB = 'Comercial — 2026-07-29'
FIRST_CLIENT_ROW = 3          # 1-based
LAST_CLIENT_ROW = 49          # 1-based, na aba de origem
REPORT_COL_IDX = 16           # coluna Q (0-based)

# orgs ativas em prod sem linha comercial na planilha (medidas na sessao de 2026-07-29)
SEM_CADASTRO = ['Alamaster', 'VitrineVET', 'Goletric Pinheiros', 'Goletric Perdizes',
                'Maycão', 'Improving', 'Three Therapy']
LABEL = '— SEM CADASTRO COMERCIAL · orgs ativas no Torque fora da planilha · preencher valor e gestor —'

GTOK = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True, shell=True).stdout.strip()
assert GTOK, 'gcloud sem token'


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


def batch(reqs):
    return sheet('POST', ':batchUpdate', data={'requests': reqs})


# ---------- 1. churn = linhas de cliente sem nome na coluna B ----------
rng = urllib.parse.quote(f"'{SRC_TAB}'!A1:B{LAST_CLIENT_ROW}", safe="!'")
vals = sheet('GET', f'/values/{rng}', 'majorDimension=ROWS').get('values', [])
churn = []
for i in range(FIRST_CLIENT_ROW - 1, LAST_CLIENT_ROW):
    row = vals[i] if i < len(vals) else []
    if not (row[1] if len(row) > 1 else '').strip():
        churn.append(i + 1)
print('linhas de churn (nome apagado):', churn)
n_clientes = (LAST_CLIENT_ROW - FIRST_CLIENT_ROW + 1) - len(churn)

# ---------- 2. duplica a aba ----------
meta = sheet('GET', '', 'fields=sheets.properties(sheetId,title,index)')
old = next((s['properties'] for s in meta['sheets'] if s['properties']['title'] == NEW_TAB), None)
if old:
    batch([{'deleteSheet': {'sheetId': old['sheetId']}}])
    print('aba anterior removida (rebuild limpo)')
gid = batch([{'duplicateSheet': {'sourceSheetId': SRC_GID, 'insertSheetIndex': 2,
                                 'newSheetName': NEW_TAB}}])['replies'][0]['duplicateSheet']['properties']['sheetId']
print('aba criada gid', gid)

# ---------- 3. remove churn + coluna de uso ----------
reqs = [{'deleteDimension': {'range': {'sheetId': gid, 'dimension': 'ROWS',
                                       'startIndex': r - 1, 'endIndex': r}}}
        for r in sorted(churn, reverse=True)]
reqs.append({'deleteDimension': {'range': {'sheetId': gid, 'dimension': 'COLUMNS',
                                           'startIndex': REPORT_COL_IDX, 'endIndex': REPORT_COL_IDX + 1}}})
batch(reqs)

last_client = FIRST_CLIENT_ROW + n_clientes - 1          # 42
print('clientes ativos:', n_clientes, '-> linhas', FIRST_CLIENT_ROW, 'a', last_client)

# ---------- 4. bloco das orgs sem cadastro ----------
n_block = 2 + len(SEM_CADASTRO)                          # linha vazia + rotulo + orgs
batch([{'insertDimension': {'range': {'sheetId': gid, 'dimension': 'ROWS',
                                      'startIndex': last_client, 'endIndex': last_client + n_block},
                            'inheritFromBefore': True}}])
blank_row = last_client + 1                              # 43
label_row = last_client + 2                              # 44
first_new = last_client + 3                              # 45
last_new = first_new + len(SEM_CADASTRO) - 1             # 51
ticket_row = last_new + 2                                # 53
mrr_row = last_new + 3                                   # 54

sheet('PUT', f'/values/{urllib.parse.quote(NEW_TAB + f"!B{blank_row}:B{last_new}", safe="!")}',
      'valueInputOption=RAW',
      {'range': NEW_TAB + f'!B{blank_row}:B{last_new}', 'majorDimension': 'ROWS',
       'values': [[''], [LABEL]] + [[n] for n in SEM_CADASTRO]})

# ---------- 5. ticket medio / MRR cobrindo clientes + orgs novas ----------
span = f'C{FIRST_CLIENT_ROW}:C{last_new}'
sheet('PUT', f'/values/{urllib.parse.quote(NEW_TAB + f"!C{ticket_row}:C{mrr_row}", safe="!")}',
      'valueInputOption=USER_ENTERED',
      {'range': NEW_TAB + f'!C{ticket_row}:C{mrr_row}', 'majorDimension': 'ROWS',
       'values': [[f'=IFERROR(SUM({span})/COUNTIF({span};">0");0)'], [f'=SUM({span})']]})

# ---------- 6. repoe a legenda TICKET MIN. ----------
# a mini-tabela N/O ficava sobre linhas de churn: COPILOT|1497 saía junto na exclusao.
sheet('PUT', f'/values/{urllib.parse.quote(NEW_TAB + "!N6:O6", safe="!")}', 'valueInputOption=RAW',
      {'range': NEW_TAB + '!N6:O6', 'majorDimension': 'ROWS', 'values': [['COPILOT', 1497]]})

# ---------- 7. acabamento do bloco ----------
GREY = {'red': 0.898, 'green': 0.910, 'blue': 0.922}
batch([
    {'mergeCells': {'range': {'sheetId': gid, 'startRowIndex': label_row - 1, 'endRowIndex': label_row,
                              'startColumnIndex': 1, 'endColumnIndex': 12}, 'mergeType': 'MERGE_ALL'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': label_row - 1, 'endRowIndex': label_row,
                              'startColumnIndex': 1, 'endColumnIndex': 12},
                    'cell': {'userEnteredFormat': {'backgroundColor': GREY, 'horizontalAlignment': 'CENTER',
                                                   'textFormat': {'bold': True, 'italic': True}}},
                    'fields': 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)'}},
    {'repeatCell': {'range': {'sheetId': gid, 'startRowIndex': first_new - 1, 'endRowIndex': last_new,
                              'startColumnIndex': 1, 'endColumnIndex': 2},
                    'cell': {'userEnteredFormat': {'textFormat': {'italic': True}}},
                    'fields': 'userEnteredFormat.textFormat'}},
])

back = sheet('GET', f'/values/{urllib.parse.quote(NEW_TAB + f"!B{ticket_row}:C{mrr_row}", safe="!")}').get('values', [])
print('bloco novo: linhas', first_new, 'a', last_new, '·', len(SEM_CADASTRO), 'orgs')
print('rodape:', back)
