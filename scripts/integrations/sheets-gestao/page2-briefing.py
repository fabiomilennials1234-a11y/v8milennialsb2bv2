# -*- coding: utf-8 -*-
import re, os, json, urllib.request, urllib.parse, unicodedata
SID='1gFXmjV8rCpOaAO8IexycK64hvo2JGqirNCnZTs7jeJA'; TAB='Página2'; GID=717848981
GTOK=os.environ['GTOK']
GH={'Authorization':'Bearer '+GTOK,'Content-Type':'application/json'}
def sheet(method,path,params='',data=None):
    u=f'https://sheets.googleapis.com/v4/spreadsheets/{SID}{path}'
    if params:u+='?'+params
    body=json.dumps(data).encode() if data is not None else None
    r=urllib.request.Request(u,data=body,method=method,headers=GH)
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: print('HTTP',e.code,e.read().decode()[:500]); raise
def norm(s):
    s=unicodedata.normalize('NFD',str(s or '')).encode('ascii','ignore').decode().lower()
    return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',s)).strip()

names=['BASIC 4U','DRA ISABELLA','REALSC','BAGEL LICITAÇÕES','ELVERA','COOPEAFAMIJF','ALL MIX',
 'BRASIL ENGRENAGENS','LONDON','ÁGAPE','LABARR','BERTIN DISTRIBUIDORA','ITATEX','MAPILA ALIMENTOS',
 'NATU FLORES','DADUPACK','ALBIERI','SC BEAUTY','JAKHRO ALIMENTOS','GRÁFICA CAUTA','ZAPLUB',
 'BARULHINHO BOM','PROMOVE CONSORCIOS','CERVEJARIA INSANA','SACO ECOMULTI','GLOWHAIR','BENNEDITA PAN',
 'HAPPYNEIS','DISTETICA','SORVFOODS','CASTROPIL','FORTE SISTEMAS','DNA DE ALMAS','HGE ILUMINAÇÃO',
 'TROOVEBR','NATUPLAST','HONEY CAKE','JC ATACADO','MOTOR 100','VILLA BRANCA','AUTOTEK',
 'Chique Distribuidora','VENTIMAIS']
# gestor por org (do .gs)
gs=open('_gestao_pagina2_escrever.gs',encoding='utf-8').read()
b=gs[gs.index('const DADOS'):gs.index('function norm_')]
GEST={}
for k,g,s,q in re.findall(r"'([^']+)':\s*\[\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\s*\]",b,re.DOTALL):
    GEST[norm(k)]=g
gest_of=[GEST.get(norm(n),'(SEM GESTOR)') for n in names]

BRIEF={
'AUGUSTO':"AUGUSTO — 3 clientes (2 grandes + 1 dormente).\n\n🔴 AVISOS:\n• Basic4u: copilot DESLIGADO — 160 leads que já responderam parados, 428 desqualificados acumulando.\n• RealSC: 1.721 leads represados em 'novo', nunca abordados.\n\n✅ PRÓXIMOS PASSOS:\n1. Religar copilot Basic4u HOJE + plano pros 160 que responderam.\n2. Destravar topo do funil RealSC (automação de abordagem cobre só parte?).\n3. Dra. Isabella dormente: reativar ou arquivar.",
'FABIO':"FABIO — 1 cliente (Bagel).\n\n🔴 AVISO:\n• WhatsApp mudo desde 02/06; 113 leads em 'abordado' parados; 173 leads/30d entrando sem atendimento.\n\n✅ PRÓXIMOS PASSOS:\n1. Confirmar se a instância caiu ou a operação parou.\n2. Religar atendimento e recuperar o backlog de abordados.",
'GUGA':"GUGA — 13 clientes (maior carteira).\n\n🔴 AVISOS:\n• Mapila: WhatsApp caído desde 16/06 (198 'novo' + 213 'abordado' parados).\n• Coopeafamijf: 713 'novo' represados, SEM canal WA/IA (CRM manual).\n• Ágape: 234 'abordado' parados sem WhatsApp.\n• Labarr: copilot OFF com 12k msgs WA/30d na mão.\n• Bertin: 236 'em_andamento' estagnados.\n\n✅ PRÓXIMOS PASSOS:\n1. Reconectar WA da Mapila.\n2. Confirmar tier (CRM x Automação) de Coopeafamijf e Ágape; provisionar WA se contratado.\n3. Religar copilot Labarr.\n4. Limpar/avançar 'em_andamento' do Bertin.\n5. Ativar ou arquivar as vazias (Natu Flores, Dadupack, Albieri); validar nome real da Elvera.",
'GUI':"GUI — 4 clientes.\n\n🔴 AVISOS:\n• Jakhro: WhatsApp NUNCA conectado — 167 leads/30d sem atendimento (GAP crítico).\n• Gráfica Cauta: 206 'novo' parados, nunca abordados.\n• SC Beauty: cadência travou em follow_up_3 (67 parados).\n\n✅ PRÓXIMOS PASSOS:\n1. Provisionar instância WA do Jakhro (urgente).\n2. Puxar os 206 novos da Gráfica Cauta.\n3. Destravar workflow de follow da SC Beauty.\n4. Zaplub dormente (625 históricos): reativar base ou arquivar.",
'KAUA':"KAUÃ — 10 clientes (maioria saudável).\n\n🔴 AVISOS:\n• Bennedita Pan: WhatsApp caído desde 22/06 (314 'abordado' parados).\n• Saco Ecomulti: 329 'novo' represados (maior entrada travada do grupo).\n• Barulhinho Bom: 23 propostas enviadas paradas (dinheiro na mesa).\n\n✅ PRÓXIMOS PASSOS:\n1. Reconectar WA da Bennedita.\n2. Destravar entrada do Saco Ecomulti (copilot ativo não puxa 'novo').\n3. Follow de propostas (Barulhinho, Happyneis).\n4. Ativar ou arquivar Glowhair e Sorvfoods (vazias).",
'TCHE':"TCHE — 4 clientes.\n\n🔴 AVISOS:\n• Dna de Almas: 165 leads novos + 16 workflows rodando, mas SEM WhatsApp e SEM IA — funil enche e ninguém atende.\n• Forte Sistemas: base mínima (10 leads), campanha pausada.\n\n✅ PRÓXIMOS PASSOS:\n1. Provisionar canal WA da Dna de Almas.\n2. Alimentar leads + ligar automações do Forte.\n3. HGE Iluminação vazia: ativar ou arquivar.\n4. TrooveBR saudável: conferir os 4 agendados parados.",
'(SEM GESTOR)':"SEM GESTOR — 8 clientes SEM DONO.\n\n🔴 AVISOS:\n• Natuplast: copilot ativo mas WA não conectado — 139 leads/30d sem atendimento.\n• Motor 100: trial com 401 leads, 100% parados em 'novo'.\n• Chique Distribuidora: 530 leads acumulados sem ninguém responsável.\n• Villa Branca e Autotek: na planilha mas SEM org no Torque.\n\n✅ PRÓXIMOS PASSOS:\n1. ATRIBUIR GESTOR a Natuplast, Motor 100 e Chique (já têm volume).\n2. Decidir provisão de Villa Branca e Autotek.\n3. Ativar ou arquivar as vazias (Honey Cake, JC Atacado, Ventimais).",
}

# grupos contiguos
groups=[]; i=0
while i<len(names):
    j=i
    while j+1<len(names) and gest_of[j+1]==gest_of[i]: j+=1
    groups.append((gest_of[i],i,j)); i=j+1
print('grupos:',[(g,a,b) for g,a,b in groups])

# coluna S (idx18). header em S2. briefing no topo de cada grupo.
col=[['Briefing do Gestor']]+[['']]*len(names)   # row2 header, depois 43 data rows
for g,a,b in groups:
    col[1+a]=[BRIEF.get(g,'')]
sheet('PUT',f'/values/{urllib.parse.quote(TAB+"!S2",safe="!")}','valueInputOption=RAW',
      {'range':TAB+'!S2','majorDimension':'ROWS','values':col})

# format
def gc(h): return {'red':int(h[0:2],16)/255,'green':int(h[2:4],16)/255,'blue':int(h[4:6],16)/255}
reqs=[]
# title merge estende p/ S (col 0..19)
reqs.append({'unmergeCells':{'range':{'sheetId':GID,'startRowIndex':0,'endRowIndex':1,'startColumnIndex':0,'endColumnIndex':19}}})
reqs.append({'mergeCells':{'range':{'sheetId':GID,'startRowIndex':0,'endRowIndex':1,'startColumnIndex':0,'endColumnIndex':19},'mergeType':'MERGE_ALL'}})
# width S
reqs.append({'updateDimensionProperties':{'range':{'sheetId':GID,'dimension':'COLUMNS','startIndex':18,'endIndex':19},'properties':{'pixelSize':380},'fields':'pixelSize'}})
# briefing cells: wrap, top, fundo claro, fonte 9
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':2,'endRowIndex':1+len(names),'startColumnIndex':18,'endColumnIndex':19},'cell':{'userEnteredFormat':{'wrapStrategy':'WRAP','verticalAlignment':'TOP','backgroundColor':gc('FAFBFD'),'textFormat':{'fontSize':9},'padding':{'top':6,'left':8,'right':8}}},'fields':'userEnteredFormat(wrapStrategy,verticalAlignment,backgroundColor,textFormat,padding)'}})
# merge vertical por grupo
for g,a,bb in groups:
    reqs.append({'mergeCells':{'range':{'sheetId':GID,'startRowIndex':2+a,'endRowIndex':2+bb+1,'startColumnIndex':18,'endColumnIndex':19},'mergeType':'MERGE_ALL'}})
sheet('POST',':batchUpdate',data={'requests':reqs})
print('OK coluna S briefing escrita + merges:',len(groups))
