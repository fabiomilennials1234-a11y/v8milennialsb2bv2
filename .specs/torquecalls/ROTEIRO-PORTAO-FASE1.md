# Roteiro do portão — TorqueCalls Fase 1

**Para:** Gabriel (CTO), execução manual
**Data:** 2026-07-30
**Objetivo:** provar ao vivo que o contrato CRM↔VPS fecha, antes de projetar o S11.

Os comandos estão prontos para colar. Onde houver `<...>`, é valor que só você tem.

---

## O que este portão decide

Quatro afirmações que hoje ninguém consegue fazer:

1. Um número real pareia, e o QR aparece na tela.
2. Uma ligação sai daqui e toca no aparelho de destino.
3. O áudio funciona nos dois sentidos.
4. **Os eventos `ringing`, `connected` e `ended` saem do broker.**

A quarta é a que autoriza a Fase 3. As três primeiras já foram vistas no spike de julho; a quarta
nunca. Se ela falhar, o S11 seria construído sobre emissores que não emitem.

E responde duas perguntas que mudam o desenho do S11:
- **O whatsmeow aceita um call-id que não foi ele quem sorteou?** (a medição 3 responde)
- **O volume da VPS sobrevive a `up -d`?** (o passo 0 responde)

---

## Valores desta execução

| O quê | Valor |
|---|---|
| Organização | `6030520a-2ca7-477d-be89-55758e2cd808` (Milennials) |
| Projeto Supabase (prod) | `jsjsmuncfkbsbzqzqhfq` |
| Instância sugerida | `803688bd-0872-4ff4-950b-8d9aa39e0025` — "Gipp teste", conectada |
| Worktree do CRM | `/Users/gabrielaureliogipp/Dev/wt-torquecalls-s11`, branch `feat/torquecalls-contrato-e-s11` |
| Repo Go | `/Users/gabrielaureliogipp/Dev/tc-s5`, branch `fix/torquecalls-contrato` |

**Escolha "Gipp teste"** e não as instâncias de cliente (`nicoladeli`, `Marcão`, `sdr`): o risco de
ban é do CTO, não de cliente — é o que o ADR-0024 combinou.

---

## Passo 0 — Medir o volume da VPS, ANTES de qualquer deploy

Isto responde uma pergunta do S11, e é a única coisa aqui que **não pode ser feita depois**: se a
imagem for recriada primeiro, a evidência some junto.

```bash
# na VPS
cat /opt/torquecalls/docker-compose.yml
docker inspect -f '{{json .Mounts}}' torquecalls | python3 -m json.tool
docker inspect -f 'WORKDIR={{.Config.WorkingDir}}' torquecalls
docker exec torquecalls sh -c 'ls -la $(pwd); ls -la /opt 2>/dev/null'
```

**O que procurar:** existe algum mount cobrindo o diretório onde o `torquecalls.db` aterrissa? O
caminho do `-db` é **relativo**, então ele nasce no `WORKDIR` — que é herdado de uma imagem que não
está no repositório e que ninguém sabe qual é.

- **Se houver mount cobrindo** → a decisão de gravar a chave privada do webhook ao lado do banco
  está de pé.
- **Se NÃO houver** → a chave sumiria no próximo `up -d`, que é rotina (houve dois recreates só em
  30/07). O S11 muda para caminho absoluto dentro de um mount explícito.

Guarde as três saídas. **Não deduza persistência de "o produto funciona"** — a evidência que
circulava era do binário do espelho AstraCalls, que persistia em Postgres, não em SQLite.

---

## Passo 1 — Aplicar as três migrations em produção

**`supabase db push` NÃO serve aqui, e não é cautela: ele aborta.** O ledger e o diretório divergem
nos dois sentidos — 40 linhas para 44 arquivos, com 18 arquivos sem linha e 14 linhas órfãs da
renumeração de 28–30 de julho. O CLI para com
`Remote migration versions not found in local migrations directory.` antes de imprimir lista alguma.

Pegue a connection string em **Supabase → Project Settings → Database → Connection string (URI)**,
e exporte:

```bash
export PGURL='postgresql://postgres:<SENHA>@db.jsjsmuncfkbsbzqzqhfq.supabase.co:5432/postgres'
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
git status --porcelain    # tem que estar vazio
```

**Antes de escrever, uma foto do estado atual** — é o que permite reverter com confiança:

```bash
psql "$PGURL" -c "
select version, name from supabase_migrations.schema_migrations
 where version like '202707300000%' order by version;"
```

Esperado: **nenhuma linha** (as três são novas).

Aplicar, uma por vez, em transação e parando no primeiro erro:

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
for m in 20270730000006_voip_call_id_provenance \
         20270730000007_voip_sweep_stuck_calls \
         20270730000008_voip_reserve_inbound_requires_tc_call_id; do
  echo "=== aplicando $m ==="
  psql "$PGURL" -v ON_ERROR_STOP=1 --single-transaction -f "supabase/migrations/$m.sql" || break
done
```

Registrar no ledger — sem isso, o próximo `db push` acha que faltam:

```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -c "
insert into supabase_migrations.schema_migrations(version, name) values
  ('20270730000006','voip_call_id_provenance'),
  ('20270730000007','voip_sweep_stuck_calls'),
  ('20270730000008','voip_reserve_inbound_requires_tc_call_id')
on conflict (version) do nothing;"
```

**Conferir que a função certa ficou viva, e que os disjuntores sobreviveram:**

```bash
psql "$PGURL" -c "
select
  substring(pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure)
            from 'c_max_org_live[^;]*;')                                as disjuntor,
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure)
    like '%tc_call_id IS NOT NULL%'                                     as tem_predicado_inbound,
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure)
    like '%v_tc_call_id := upper(replace(gen_random_uuid()%'            as tem_cunhagem,
  (select count(*) from cron.job where jobname='voip-sweep-stuck-calls') as varredor;"
```

**Esperado, os quatro:** `c_max_org_live constant integer := 100;` · `t` · `t` · `1`.

> Se o disjuntor voltar `2`, **pare**: a migration reverteu a sua decisão de "sem teto de volume".
> O rollback é `supabase/migrations/rollback/20270730000008_...sql`.

---

## Passo 2 — Deploy das edge functions

Deploy empacota o `_shared/` **da árvore de trabalho**. Deployar de um checkout atrasado reverte em
produção o que está na `main` — já aconteceu neste repositório.

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
git log --oneline -1          # tem que ser o commit da onda de correção
supabase functions deploy torquecalls-signal  --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy torquecalls-control --project-ref jsjsmuncfkbsbzqzqhfq
```

---

## Passo 3 — Frontend e VPS

**Frontend:** redeploy manual no EasyPanel. Sem ele a tela de pareamento não existe para você.
Confirme que a imagem puxada é a `:latest` publicada depois do merge.

**VPS:** build da branch `fix/torquecalls-contrato` e subida da imagem nova.

```bash
docker logs --tail 20 torquecalls    # tem que aparecer "HTTP server listening"
```

**Registre por escrito qual é o processo de build da imagem.** Ele não está no repositório, e essa
ausência é o risco que o Passo 0 mede.

---

## Passo 4 — MEDIÇÃO 1: o número pareia

Integrações → TorqueCalls → **"Ativar voz"** na instância "Gipp teste".

**Esperado: o QR aparece.** É o defeito da claim `pair_sid` saindo de produção — antes desta frente,
o token era recusado como malformado e o QR nunca chegava.

```bash
psql "$PGURL" -c "
select tc_session_id, status, jid, name, created_at, updated_at
  from public.voip_sessions order by created_at;"
```

Esperado: **uma linha**, `status` em `pending` ou `pairing`.

> Ela **não** vai para `open` sozinha. Isso é o S11 e é correto que ainda não aconteça.

Anote o `tc_session_id` — os próximos passos usam:

```bash
export SID='<o tc_session_id da linha>'
```

---

## Passo 5 — As duas escritas manuais

Ambas são muletas de teste, não atalhos de produto. **Registre as duas.**

### 5a — Promover a sessão

```bash
psql "$PGURL" -c "
update public.voip_sessions
   set status = 'open', updated_at = now()
 where tc_session_id = '$SID';"
```

É exatamente a promoção que o S11 vai automatizar com prova criptográfica — e que você recusou fazer
a partir da palavra do navegador, porque é o vetor que a S5 matou.

### 5b — Criar o consentimento de voz

Sem isto a ligação é recusada com `consent_missing` **antes** de qualquer token ser assinado.
Produção tem **zero** linhas desse tipo de consentimento, e não há caminho de produto para criar uma:
`fn_voip_consent_record` é `service_role`-only e não tem um único chamador; o hook do front grava
`source: 'manual'`, que o gate exclui de propósito.

Escolha o lead de teste — sugestão, um dos recentes da Milennials:

| Lead | Telefone | id |
|---|---|---|
| Rodolfo | 11973456404 | `2e54dfe7-9119-49ef-8f0d-390ccbd0e0c5` |
| Alexandre Pomarico | 11991259239 | `cd366fc2-3ca0-4dff-850a-9d0cf06a2147` |

**Melhor ainda: use um número seu**, num lead criado para isso — a ligação vai tocar de verdade.

```bash
export LEAD='<lead_id>'
export FONE='<telefone só dígitos, com DDD>'

psql "$PGURL" -c "
select public.fn_voip_consent_record(
  '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,  -- organização
  '$LEAD'::uuid,                                  -- lead
  true,                                           -- concedido
  'api',                                          -- origem: 'manual' é recusado de propósito
  '$FONE',                                        -- telefone de contato
  null, null, '{\"motivo\":\"portao fase 1\"}'::jsonb
);"
```

Conferir que ele passa no gate:

```bash
psql "$PGURL" -c "
select id, consent_type, granted, source, revoked_at
  from public.consent_records
 where lead_id = '$LEAD' and consent_type = 'voice_call_whatsapp';"
```

Esperado: uma linha, `granted = t`, `source = api`, `revoked_at` nulo.

---

## Passo 6 — Abrir o stream de eventos, ANTES de discar

**Não dá para observar isso pelo navegador.** O hook `useVoicePairing` aborta o SSE assim que chega
`paired: true` — ou seja, exatamente quando a Medição 1 dá certo — e o botão "Ativar voz" some
depois que a instância tem sessão, então não há como reabrir pela tela.

Pegue seu JWT no navegador (DevTools → Application → Local Storage → a chave do Supabase → campo
`access_token`):

```bash
export JWT='<seu access_token>'

# 1) pedir o token de stream — SEM pair:true
RESP=$(curl -s -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/torquecalls-signal \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"action\":\"streamToken\",\"tc_session_id\":\"$SID\"}")
echo "$RESP"

export STREAM_TOKEN=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
export VPS_URL=$(echo "$RESP"      | python3 -c 'import sys,json;print(json.load(sys.stdin)["vps_url"])')
echo "VPS: $VPS_URL"
```

Abra o stream **numa aba de terminal separada, e deixe rodando**:

```bash
curl -N -H "Authorization: Bearer $STREAM_TOKEN" -H "Accept: text/event-stream" \
  "$VPS_URL/api/events" | tee /tmp/sse-portao.txt
```

O token vive 60 s, mas o servidor não revalida depois de conectado — o stream sobrevive à ligação
inteira.

---

## Passo 7 — MEDIÇÕES 2 e 3: a ligação sai, toca, e o áudio funciona

Com o `curl` rodando, abra o chat do lead de teste e clique em ligar.

**Medição 2:** o telefone de destino toca.
**Medição 3:** áudio nos dois sentidos.

> **A Medição 3 é a que responde a pergunta do S11.** Se a ligação completa, o whatsmeow aceitou um
> call-id que não foi ele quem sorteou — e a escolha de desenho está confirmada. Se falhar
> *especificamente aqui*, com o token passando e a chamada não estabelecendo, a alternativa do §1.2
> do spec volta à mesa.

### Triagem, em ordem de probabilidade

| Sintoma | Causa | Não é |
|---|---|---|
| `consent_missing` | o passo 5b não foi feito, ou nasceu com `source` errado | defeito das tarefas 3, 6 ou 7 |
| `session_not_open` | o passo 5a não foi feito | — |
| `operator_busy` | você já tem uma ligação viva presa | veja o passo 9 |
| `voice_calls_disabled` | a instância está com a chave desligada | veja abaixo |
| 401 `cid fora do formato` | a migration `...0006` ou o deploy não chegaram | — |
| 404 `no such call` | o `callIDFor` ainda está desencontrado | — |

Se der `voice_calls_disabled`:

```bash
psql "$PGURL" -c "
select id, instance_name, voice_calls_enabled, daily_call_cap
  from public.whatsapp_instances
 where organization_id = '6030520a-2ca7-477d-be89-55758e2cd808';"
```

O `createSession` liga essa chave sozinho; se estiver falsa, a sessão foi criada por outro caminho.

---

## Passo 8 — MEDIÇÃO 4: os três eventos saem do broker

**É a medição que autoriza a Fase 3.**

Depois de encerrar a ligação, olhe o arquivo do stream:

```bash
grep -o '"type":"[a-z-]*"' /tmp/sse-portao.txt | sort | uniq -c
echo "--- eventos de chamada, na ordem ---"
grep -E 'call-status|call-ended' /tmp/sse-portao.txt
```

**Esperado, nesta ordem:** `call-status` com `ringing` → `call-status` com `connected` →
`call-ended`.

> Se `connected` ou `call-ended` não aparecerem, a correção do `OrgID` não chegou em produção — é
> exatamente o defeito que a Tarefa 4 fechou, e o S11 não pode ser construído sobre emissores que
> não emitem.

E o ledger:

```bash
psql "$PGURL" -c "
select id, tc_call_id, status, direction, peer_phone, end_reason,
       authorized_at, ringing_at, connected_at, ended_at
  from public.voip_calls order by created_at desc limit 5;"
```

Esperado: `tc_call_id` **preenchido**, com 32 caracteres de `[0-9A-F]`.

O `status` vai estar em `ringing` — ou em `ended` com `end_reason = 'no_terminal_event'` se o
varredor já tiver passado. **As duas coisas são esperadas:** promover para `connected`/`ended` com a
causa real é o S11. O varredor existe justamente para o operador não travar enquanto isso.

---

## Passo 9 — Se você travar no meio

`idx_voip_calls_one_live_per_operator` permite uma ligação viva por operador. O varredor recolhe
`ringing` depois de 2 minutos — mas se você quiser destravar na hora, entre uma tentativa e outra:

```bash
psql "$PGURL" -c "
update public.voip_calls
   set status='ended', end_reason='portao_manual', ended_at=now(), updated_at=now()
 where organization_id='6030520a-2ca7-477d-be89-55758e2cd808'
   and status in ('authorized','ringing','connected');"
```

`end_reason='portao_manual'` deixa isso distinguível na auditoria depois.

---

## Passo 10 — Registrar

Escreva em `.specs/torquecalls/MEDICOES-PORTAO-FASE1.md` e commite. **O plano da Fase 3 é escrito a
partir deste arquivo, não de dedução.**

Precisa constar:

1. `WORKDIR` e `Mounts` do container — **decide onde a chave privada do webhook vai morar**.
2. O áudio funcionou? ⇒ confirma (ou derruba) a escolha do `cid`.
3. Quais dos três eventos apareceram — anexe `/tmp/sse-portao.txt`.
4. Que a sessão foi promovida à mão, e qual.
5. Que um consentimento de voz foi criado à mão, para qual lead, com qual origem.
6. Que as migrations foram por `psql` e o ledger recebeu as três linhas à mão.
7. Qual é o processo de build da imagem da VPS.

---

## Se precisar desfazer tudo

```bash
# 1. rollback das migrations, na ordem inversa
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
for m in 20270730000008_voip_reserve_inbound_requires_tc_call_id \
         20270730000007_voip_sweep_stuck_calls \
         20270730000006_voip_call_id_provenance; do
  psql "$PGURL" -v ON_ERROR_STOP=1 --single-transaction -f "supabase/migrations/rollback/$m.sql" || break
done

# 2. tirar as linhas do ledger
psql "$PGURL" -c "
delete from supabase_migrations.schema_migrations
 where version in ('20270730000006','20270730000007','20270730000008');"

# 3. apagar a sessão de teste (leva o histórico de chamadas junto, por CASCADE)
psql "$PGURL" -c "delete from public.voip_sessions where tc_session_id = '$SID';"

# 4. revogar o consentimento de teste
psql "$PGURL" -c "
update public.consent_records set revoked_at = now()
 where lead_id = '$LEAD' and consent_type = 'voice_call_whatsapp';"
```

O frontend e as edge functions voltam pelo deploy da versão anterior.

---

## O que este portão NÃO testa, e é de propósito

- **Chamada de entrada.** Não há interface para ela, e recusar entrada só passou a funcionar nesta
  frente (o achado C2). O caminho de verdade nasce com o S11.
- **A promoção automática da sessão.** É o S11 inteiro.
- **A ordem e a durabilidade dos eventos.** Precisa do outbox, que é a Fase 3.
