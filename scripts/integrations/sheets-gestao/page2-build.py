# -*- coding: utf-8 -*-
import re, os, json, urllib.request, urllib.parse, unicodedata

SID='1gFXmjV8rCpOaAO8IexycK64hvo2JGqirNCnZTs7jeJA'
TAB='Página2'; GID=717848981
TODAY='2026-06-23'

env=open('.env.development',encoding='utf-8',errors='ignore').read()
SBP=re.search(r'sbp_[A-Za-z0-9]+',env).group(0)
GTOK=os.environ['GTOK']

def db(sql):
    b=json.dumps({'query':sql}).encode()
    r=urllib.request.Request('https://api.supabase.com/v1/projects/jsjsmuncfkbsbzqzqhfq/database/query',
        data=b,method='POST',headers={'Authorization':'Bearer '+SBP,'Content-Type':'application/json','User-Agent':'t/1'})
    return json.loads(urllib.request.urlopen(r).read())

GH={'Authorization':'Bearer '+GTOK,'Content-Type':'application/json'}
def sheet(method,path,params='',data=None):
    u=f'https://sheets.googleapis.com/v4/spreadsheets/{SID}{path}'
    if params:u+='?'+params
    body=json.dumps(data).encode() if data is not None else None
    r=urllib.request.Request(u,data=body,method=method,headers=GH)
    try:
        return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        print('HTTP',e.code,'body:',e.read().decode()[:600]); raise

def norm(s):
    s=unicodedata.normalize('NFD',str(s or '')).encode('ascii','ignore').decode().lower()
    return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',s)).strip()

# ---- canonical client names (orig Página2 order, fixo p/ rerun deterministico) ----
names=['BASIC 4U','DRA ISABELLA','REALSC','BAGEL LICITAÇÕES','ELVERA','COOPEAFAMIJF','ALL MIX',
 'BRASIL ENGRENAGENS','LONDON','ÁGAPE','LABARR','BERTIN DISTRIBUIDORA','ITATEX','MAPILA ALIMENTOS',
 'NATU FLORES','DADUPACK','ALBIERI','SC BEAUTY','JAKHRO ALIMENTOS','GRÁFICA CAUTA','ZAPLUB',
 'BARULHINHO BOM','PROMOVE CONSORCIOS','CERVEJARIA INSANA','SACO ECOMULTI','GLOWHAIR','BENNEDITA PAN',
 'HAPPYNEIS','DISTETICA','SORVFOODS','CASTROPIL','FORTE SISTEMAS','DNA DE ALMAS','HGE ILUMINAÇÃO',
 'TROOVEBR','NATUPLAST','HONEY CAKE','JC ATACADO','MOTOR 100','VILLA BRANCA','AUTOTEK',
 'Chique Distribuidora','VENTIMAIS']
print('clientes:',len(names))

# ---- map names -> org ids ----
orgs=db('select id,name from organizations')
idx={}
for o in orgs: idx.setdefault(norm(o['name']),o['id'])
ALIAS={ 'agape':'agape zeladoria','barulhinho bom':'barulinho bom','promove consorcios':'promove consorcios',
 'saco ecomulti':'sacoecomulti','glowhair':'glowhair ltda','grafica cauta':'grafica cauta','labarr':'labarr chocolate',
 'albieri':'albieri engenharia','hge iluminacao':'hge iluminacao','elvera':'elvera','dadupack':'dadupack',
 'sorvfoods':'sorvfoods','bagel licitacoes':'bagel','bertin distribuidora':'bertin','honey cake':'honney cake',
 'london':'london cosmeticos','mapila alimentos':'mapila alimentos','dra isabella':'dra isabella',
 'basic 4u':'basic4u','jakhro alimentos':'jakhro alimentos','sc beauty':'sc beauty'}
def find(name):
    k=norm(name)
    if k in idx: return idx[k]
    a=ALIAS.get(k)
    if a and a in idx: return idx[a]
    for nk,i in idx.items():
        if k and (k in nk or nk in k): return i
    return None
nmap={n:find(n) for n in names}
ids=[v for v in nmap.values() if v]
inlist="'"+"','".join(ids)+"'"
print('mapeadas:',len([v for v in nmap.values() if v]),'/',len(names),' sem id:',[n for n,v in nmap.items() if not v])

# ---- metrics ----
def rowsby(sql,key='o'):
    d={}
    for r in db(sql): d[r[key]]=r
    return d
leads=rowsby(f"select organization_id o,count(*) t,count(*) filter(where created_at>now()-interval '30 days') n30,count(*) filter(where created_at>now()-interval '7 days') n7 from leads where organization_id in ({inlist}) group by 1")
ia=rowsby(f"select c.organization_id o,count(*) c from conversation_messages m join conversations c on c.id=m.conversation_id where m.role='assistant' and m.created_at>now()-interval '30 days' and c.organization_id in ({inlist}) group by 1")
wa=rowsby(f"select organization_id o,count(*) filter(where timestamp>now()-interval '30 days') w30,max(timestamp) last from whatsapp_messages where organization_id in ({inlist}) group by 1")
inst=rowsby(f"select organization_id o,count(*) tot,count(*) filter(where status='connected' and session_dead_since is null) on_ from whatsapp_instances where organization_id in ({inlist}) group by 1")
cop=rowsby(f"select organization_id o,bool_or(is_active) act,count(*) tot from copilot_agents where organization_id in ({inlist}) group by 1")
wf=rowsby(f"select organization_id o,count(*) tot,count(*) filter(where is_active) on_ from workflows where organization_id in ({inlist}) group by 1")
fun={}
for r in db(f"select organization_id o,stage_key s,count(*) filter(where closed_at is null) op,count(*) filter(where closed_at is null and stage_changed_at<now()-interval '7 days') st from pipeline_entries where organization_id in ({inlist}) group by 1,2 having count(*) filter(where closed_at is null)>0"):
    fun.setdefault(r['o'],[]).append((r['s'],r['op'],r['st']))

# ---- questionamentos from .gs ----
gs=open('_gestao_pagina2_escrever.gs',encoding='utf-8').read()
body=gs[gs.index('const DADOS'):gs.index('function norm_')]
QD={}
for k,g,s,qq in re.findall(r"'([^']+)':\s*\[\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\s*\]",body,re.DOTALL):
    QD[norm(k)]=(g,qq)

def fdate(ts):
    return (ts or '')[:10]

def classify(n,oid):
    g=QD.get(norm(n),('',''))[0]
    quest=QD.get(norm(n),('',''))[1]
    if not oid:
        return [n,g,'❌ NÃO PROVISIONADO','','','','','','','','','','','','','Sem org no Torque. Cliente na planilha mas nunca criado.','Provisionar org',quest]
    L=leads.get(oid,{}); tot=int(L.get('t',0)); n30=int(L.get('n30',0)); n7=int(L.get('n7',0))
    iam=int(ia.get(oid,{}).get('c',0))
    W=wa.get(oid,{}); w30=int(W.get('w30',0)); last=fdate(W.get('last'))
    I=inst.get(oid,{}); itot=int(I.get('tot',0)); ion=int(I.get('on_',0))
    C=cop.get(oid,{}); cact=C.get('act'); ctot=int(C.get('tot',0))
    F=wf.get(oid,{}); ftot=int(F.get('tot',0)); fon=int(F.get('on_',0))
    fl=sorted(fun.get(oid,[]),key=lambda x:-x[1]); fopen=sum(x[1] for x in fl); fstuck=sum(x[2] for x in fl)
    gtop=sorted(fl,key=lambda x:-x[2])
    garg=(f"{gtop[0][0]} ({gtop[0][2]}p)" if gtop and gtop[0][2]>0 else (fl[0][0] if fl else ''))
    cops = 'ativo' if cact else ('inativo' if ctot>0 else '—')
    insts= f"{ion}/{itot}" if itot else '—'
    wfs  = f"{fon}/{ftot}" if ftot else ''
    # status ladder
    if tot==0 and w30==0 and iam==0:
        st='⭕ NÃO USO'; sit=f'Org vazia: 0 leads, 0 atividade.' + (f' {ftot} workflows criados nunca ligados.' if ftot else ''); ac=''
    elif tot>0 and n30<=1 and w30==0:
        st='⭕ NÃO USO'; sit=f'Dormente: {tot} leads históricos, sem WhatsApp ativo (últ. {last or "s/ registro"}).'; ac='Reativar ou arquivar'
    elif itot>0 and ion==0:
        st='⚠️ MAU USO'; sit=f'WhatsApp DESCONECTADO ({itot} inst, 0 on), mudo desde {last}. {n30} leads/30d entrando.'; ac='Reconectar WA'
    elif itot==0 and ctot>0 and iam==0:
        st='⛔ GAP CRÍTICO'; sit=f'Copilot configurado mas WhatsApp não conectado (0 msgs). {n30} leads/30d sem atendimento.'; ac='Provisionar instância WA'
    elif itot==0 and iam==0:
        st='⚠️ MAU USO'; sit=f'{n30} leads/30d e funil ativo, mas SEM canal WhatsApp e SEM IA — CRM manual.'; ac='Confirmar tier / provisionar WA'
    elif cops=='inativo' and w30>0:
        st='⚠️ MAU USO'; sit=f'Copilot DESLIGADO apesar de {n30} leads/30d e {w30//1000}k+ msgs WA/30d. Atendido na mão.'; ac='Reativar copilot'
    elif cops=='ativo' and w30>0:
        st='✅ BOM'; sit=f'Copilot ativo ({iam} msgs IA/30d), WA conectado, {n30} leads/30d, funil ativo. Saudável.'; ac=''
    elif w30>0:
        st='✅ BOM (leve)'; sit=f'WA conectado ({w30} msgs/30d), {n30} leads/30d, {fon} workflows ativos, funil mexendo.'; ac=''
    else:
        st='⚠️ FRACO'; sit=f'Base mínima ({tot} leads), pouca automação.'; ac='Alimentar leads + automações'
    return [n,g,st,tot,n30,n7,iam,w30,last,insts,cops,wfs,fopen,fstuck,garg,sit,ac,quest]

data=[classify(n,nmap[n]) for n in names]

HEAD=['Cliente','Gestor','Status','Leads','Novos 30d','Novos 7d','Msgs IA 30d','WhatsApp 30d','Últ. WA',
      'Inst. on/tot','Copilot','WF on/tot','Funil aberto','Parados >7d','Gargalo (etapa)','Situação','Ação','Questionamento p/ gestor']
TITLE=[f'GESTÃO — Saúde por Organização   ·   atualizado {TODAY}   ·   fonte: Torque prod']

# ---- write (overwrite in place, user-authorized) ----
vals=[TITLE]+[HEAD]+data
sheet('PUT',f'/values/{urllib.parse.quote(TAB+"!A1",safe="!")}','valueInputOption=RAW',
      {'range':TAB+'!A1','majorDimension':'ROWS','values':vals})
nrow=len(vals)
print('escrito linhas:',nrow,'cols:18')

# ---- formatting ----
def gcolor(h): return {'red':int(h[0:2],16)/255,'green':int(h[2:4],16)/255,'blue':int(h[4:6],16)/255}
DARK=gcolor('0E1116'); HEADBG=gcolor('1B2330'); GOLD=gcolor('F5C518'); WHITE=gcolor('FFFFFF')
ZEBRA=gcolor('F3F6FA'); GREEN=gcolor('D6F5DF'); AMBER=gcolor('FCEFC7'); RED=gcolor('F9D7D7'); GREY=gcolor('E6E8EB')
NC=18
reqs=[]
# freeze title+header + col A
reqs.append({'updateSheetProperties':{'properties':{'sheetId':GID,'gridProperties':{'frozenRowCount':2,'frozenColumnCount':0}},'fields':'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'}})
# merge title
reqs.append({'mergeCells':{'range':{'sheetId':GID,'startRowIndex':0,'endRowIndex':1,'startColumnIndex':0,'endColumnIndex':NC},'mergeType':'MERGE_ALL'}})
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':0,'endRowIndex':1},'cell':{'userEnteredFormat':{'backgroundColor':DARK,'horizontalAlignment':'LEFT','verticalAlignment':'MIDDLE','padding':{'left':12},'textFormat':{'foregroundColor':GOLD,'bold':True,'fontSize':13}}},'fields':'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,padding,textFormat)'}})
# header row2
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':1,'endRowIndex':2},'cell':{'userEnteredFormat':{'backgroundColor':HEADBG,'horizontalAlignment':'CENTER','verticalAlignment':'MIDDLE','wrapStrategy':'WRAP','textFormat':{'foregroundColor':WHITE,'bold':True,'fontSize':10}}},'fields':'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'}})
# row heights
reqs.append({'updateDimensionProperties':{'range':{'sheetId':GID,'dimension':'ROWS','startIndex':0,'endIndex':1},'properties':{'pixelSize':38},'fields':'pixelSize'}})
reqs.append({'updateDimensionProperties':{'range':{'sheetId':GID,'dimension':'ROWS','startIndex':1,'endIndex':2},'properties':{'pixelSize':34},'fields':'pixelSize'}})
# data area base format: vertical top, wrap on text cols
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':2,'endRowIndex':nrow},'cell':{'userEnteredFormat':{'verticalAlignment':'TOP','textFormat':{'fontSize':10}}},'fields':'userEnteredFormat(verticalAlignment,textFormat)'}})
# numeric cols center (D..N = idx 3..13)
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':2,'endRowIndex':nrow,'startColumnIndex':3,'endColumnIndex':14},'cell':{'userEnteredFormat':{'horizontalAlignment':'CENTER'}},'fields':'userEnteredFormat.horizontalAlignment'}})
# wrap on Situação/Ação/Questionamento (P,Q,R = idx 15,16,17)
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':2,'endRowIndex':nrow,'startColumnIndex':15,'endColumnIndex':18},'cell':{'userEnteredFormat':{'wrapStrategy':'WRAP'}},'fields':'userEnteredFormat.wrapStrategy'}})
# client bold (A)
reqs.append({'repeatCell':{'range':{'sheetId':GID,'startRowIndex':2,'endRowIndex':nrow,'startColumnIndex':0,'endColumnIndex':1},'cell':{'userEnteredFormat':{'textFormat':{'bold':True,'fontSize':10}}},'fields':'userEnteredFormat.textFormat'}})
# banding
reqs.append({'addBanding':{'bandedRange':{'range':{'sheetId':GID,'startRowIndex':2,'endRowIndex':nrow,'startColumnIndex':0,'endColumnIndex':NC},'rowProperties':{'firstBandColor':WHITE,'secondBandColor':ZEBRA}}}})
# col widths
W={0:150,1:90,2:130,3:62,4:78,5:70,6:90,7:100,8:90,9:84,10:78,11:78,12:88,13:84,14:150,15:340,16:170,17:380}
for c,px in W.items():
    reqs.append({'updateDimensionProperties':{'range':{'sheetId':GID,'dimension':'COLUMNS','startIndex':c,'endIndex':c+1},'properties':{'pixelSize':px},'fields':'pixelSize'}})
# conditional formatting on Status col C (idx2)
def cf(text,bg):
    return {'addConditionalFormatRule':{'rule':{'ranges':[{'sheetId':GID,'startRowIndex':2,'endRowIndex':nrow,'startColumnIndex':2,'endColumnIndex':3}],'booleanRule':{'condition':{'type':'TEXT_CONTAINS','values':[{'userEnteredValue':text}]},'format':{'backgroundColor':bg,'textFormat':{'bold':True}}}},'index':0}}
for t,c in [('✅',GREEN),('⚠️',AMBER),('⛔',RED),('🔴',RED),('⭕',GREY),('❌',GREY)]:
    reqs.append(cf(t,c))

sheet('POST',':batchUpdate',data={'requests':reqs})
print('formatado. OK')
print('status sample:')
for d in data[:6]: print(' ',d[0],'|',d[2],'|',d[3],'leads |',d[15][:40])
