# MACRO — dedup no path conversacional (Copilot) do WhatsApp

> Arquiteto (Cais) · área frágil (WhatsApp/Uazapi + Copilot) · aterrado em origin/main + diag da Lanterna.
> NÃO implementação. Contrato pro Forja. Crivo roda rubric BLOQUEANTE. Prod = botão do CTO.

## Contexto

`reserveSendOrSkip` (único escritor de `send_dedup_log`) está fiado **só no path de WORKFLOW** (action-handlers, `source:workflow`). A resposta do **Copilot** vai por `whatsapp-webhook/index.ts:~800 → sendTextViaInstance(trackSource:copilot)`, e `sendTextViaInstance` (`_shared/whatsapp-dispatch.ts`) **não tem dedup** — só `governSend`. 29.811 outgoing em 72h passaram ao largo; `send_dedup_log`=0 linhas e consistente. O vetor Bertin (loop bot-to-bot, "12× Oi Filipe") — motivo da tabela existir — segue **sem proteção em prod**. O #1252 item 4 afirmou que os action-handlers cobriam o vetor conversacional: **errado** (action-handlers = DAG de workflow, não o webhook do copilot).

## Decisão arquitetural — **OPÇÃO A**

`reserveSendOrSkip` **dentro de `_shared/whatsapp-dispatch.ts`**, no mesmo choke onde `governSend` já mora — cobre copilot + dispatchers + workflow numa passada. Coerente com a decisão ratificada "Send Governor = choke único".

**Por que A, e por que o blast-radius de 93 orgs é aceitável — prova por construção:** o unique index é `(org_id, phone, content_hash, source)` (recipient-scoped). Falso-positivo (mensagem legítima bloqueada) só ocorre em **conteúdo idêntico, mesmo destinatário, mesma janela** — que é exatamente o loop. Mass_send "Bom dia!" a 500 phones = 500 chaves distintas → **zero dedup indevido**. Some-se o fail-open em erro de infra → A **não** pode "derrubar todo envio": o único modo de dano é repetição-exata-mesmo-phone, que é o alvo.

**B rejeitada:** `reserveSendOrSkip` só antes do send no webhook deixa dispatchers/proxy/mídia/mass descobertos — é **o mesmo tipo de fix parcial que criou ESTE bug** (#1252 tapou dispatchers, esqueceu o webhook). Fix pontual no choke errado.

## Onde vive

- `supabase/functions/_shared/whatsapp-dispatch.ts` — dedup dentro de `sendTextViaInstance` (linha 299) **e das funções-irmãs de send** (mídia etc., linhas ~349/397/456/514 — todas que hoje envolvem `governSend`). Sequência: `governSend` (rate/reputação) → se não skipped → `reserveSendOrSkip` (conteúdo) → se não duplicata → `doSend`.
- `supabase/functions/_shared/send-dedup.ts` — ajuste do window copilot (ver Q3); nada estrutural.
- `whatsapp-webhook/index.ts:~800` — **nenhuma mudança** (o dedup passa a viver no dispatch que ele já chama).
- Kill-switch: env `SEND_DEDUP_CONVERSATIONAL_ENABLED` (default OFF no deploy, flip ON após validar).

## Contratos (boundary)

- `sendTextViaInstance(..., opts:{trackSource?:string,...})` — mapear `trackSource`→`SendSource` via helper novo `deriveSendSource(trackSource)`: conhecidos (`copilot|workflow|manual|mass_send|followup`) → enum; **desconhecido/undefined → PULA dedup** (fail-open, não classifica errado, loga 1×). Hash do texto via `hashContent` já existente. Chamada só para sends com texto não-vazio (regra já em `reserveSendOrSkip`).
- Retorno preservado de `sendTextViaInstance`: se `reserveSendOrSkip` devolve `duplicate:true` → **não chama `doSend`**, retorna resultado "skipped" no mesmo shape que o skip do governor (`isSkippedSend`), pra telemetria/ledger não quebrarem.
- Kill-switch: se `SEND_DEDUP_CONVERSATIONAL_ENABLED` != 'true' → dedup no-op (comportamento de hoje). Governor intocado.

## Escopo

**ENTRA:** dedup em `whatsapp-dispatch.ts` (todas as send* fns), `deriveSendSource`, window copilot corrigido, kill-switch env, observabilidade dos 2 ramos (skip + fail-open), unit tests, correção do changelog/#1252.
**NÃO ENTRA:** cap de taxa por-conversa (fix estrutural de loop lento — fatia futura); mass bulk-API path da Uazapi `/sender/*` se não passar por `sendTextViaInstance` (recipient-scoped, aceitável); mudança de schema (tabela já existe via #1252).

## Q2 — fail-open sem virar bypass silencioso

`reserveSendOrSkip` já é fail-open (throw → envia). O #1252 já emite `logRuntime('dedup_reserve_fail_open')` no catch. **Exigência:** os DOIS ramos observáveis — fail-open **e** skip (`logRuntime('dedup_skip', {source, org, phone_hash, ttl})`). Motivo: o bug original foi silencioso (0 linhas por meses, ninguém viu). Um dashboard/alerta sobre `dedup_reserve_fail_open` sustentado = "a tabela quebrou de novo, dedup desligado". `dedup_skip==0 pra sempre` = mesmo cheiro do 0-rows. Observabilidade é a defesa contra a reincidência da causa-raiz.

## Q3 — TTL do path conversacional

**60s (default copilot atual) é INSUFICIENTE.** Evidência Bertin: "12× em 30min" = ~150s de espaçamento > 60s → o loop lento **escaparia**. Decisão: **window copilot = 300s** (cobre 150s com 2× de margem; ainda mata o loop rápido de 3000/9h ≈ 11s). Risco assumido: bloquear um reply idêntico legítimo ao mesmo lead em ≤5min — raro e de baixo dano (perde 1 duplicata) vs. queima de chip (existencial). O fix estrutural do loop lento é cap de taxa por-conversa — fatia à parte, registrada, não desta.

## Q4 — rollback + validação sem ambiente

- **Rollback:** a mudança é CÓDIGO (edge functions), não schema (tabela já em prod via #1252). Rollback = kill-switch OFF (instantâneo, sem redeploy) OU redeploy da versão anterior. Reversível em segundos.
- **Validação antes de prod** (sem branch env — [[dev-retired-branch-policy]]): (1) unit vitest determinístico do `deriveSendSource` + fail-open + skip + window (sem DB); (2) pgTAP da tabela já verde (13/13, #1252); (3) stack local `supabase functions serve` exercitando send-duplo → 2º skipped. **Prova em prod com rollback armado** (fallback do ADR): deploy com kill-switch OFF → flip ON → observar via MCP `send_dedup_log` ganhar linhas `source=copilot` em minutos = fix vivo; se seguir 0 → não fiou → OFF. **Canário:** flip ON primeiro só p/ Milennials/Bertin (allowlist no kill-switch), observar falso-positivo, depois geral. O kill-switch é o que torna o blast-radius de A operacionalmente seguro.

## Q5 — correção do changelog/#1252

#1252 já está mergeado (main `ea14475c`) — **não reescrever história**. O novo PR: (a) changelog append-only com entrada de correção citando que o item 4 do #1252 estava errado (action-handlers = DAG, não copilot); (b) documentar o gap real (webhook nunca deduplicou, 29.811 bypass, 0 linhas consistente); (c) o corpo do novo PR supersede explicitamente o item 4. Regra do vault: correção por nova entrada, nunca deleção.

## Critérios de aceite

1. Após flip ON, um 2º chunk/reply idêntico ao mesmo phone dentro de 300s é **skipped** (não chega ao provider); 1º passa.
2. `send_dedup_log` ganha linhas `source=copilot` em prod (prova de fiação).
3. Destinatários distintos com texto idêntico (mass/broadcast) **nunca** se dedupam entre si.
4. Erro de infra no dedup → send passa (fail-open) **e** emite `dedup_reserve_fail_open`.
5. `trackSource` desconhecido → send passa sem dedup, logado.
6. Kill-switch OFF = comportamento byte-a-byte de hoje. Governor intocado.
7. Unit verde; pgTAP 13/13 mantido.

## Áreas frágeis

WhatsApp/Uazapi (choke de envio de 93 orgs) + Copilot. Multi-tenant: dedup key já tem `org_id`. **Revisor: rubric de segurança BLOQUEANTE** — foco em: falso-positivo (perda de mensagem de cliente), fail-open genuíno (nunca dropar por hiccup da tabela), kill-switch realmente neutro em OFF, `deriveSendSource` sem classificar errado.

## Riscos

| Risco | Mitigação |
|---|---|
| A derruba envio de 93 orgs | Key recipient-scoped (falso-positivo só = loop) + fail-open + **kill-switch** + canário |
| Window 300s bloqueia reply legítimo idêntico | Raro, baixo dano; anti-ban é existencial; cap-por-conversa é o fix estrutural futuro |
| Reincidência silenciosa (tabela quebra de novo) | Observabilidade dos 2 ramos + alerta em fail-open sustentado |
| `trackSource` livre mal-mapeado | Desconhecido → pula dedup (fail-open), não mis-classifica |
| mass bulk-API fora do dispatch | Fora de escopo; recipient-scoped torna inócuo |

## ADENDO VOLTA 1 — Crivo REPROVOU; redesign ratificado (2026-07-26)

O modelo original (content-hash + janela plana + reserva BINÁRIA "2º = duplicata", dedup nas closures dos 5 helpers) é **inadequado no path conversacional**. Crivo REPROVA nos 3, confirmados por mim (arquivo:linha):

**B1 — chunking mutila (webhook:772-802).** Reply do copilot é quebrada em chunks; 2 chunks idênticos (`✅`/`Sim.`/linha repetida) → mesmo hash → 2º vira DEDUP_SKIP → mensagem chega MUTILADA em silêncio. Raiz de schema: os 2 índices são XOR (`content-partial WHERE idk IS NULL` vs `idk-partial WHERE idk IS NOT NULL`) — impossível ter "chunks da mesma reply não colidem entre si" E "loop colide entre turnos" por linha. idk por-reply mata a detecção de loop.

**Refino de janela — piso de tamanho NÃO fecha.** O loop do Bertin ("Oi Filipe!") = 10 chars. Piso que isenta ack curto isentaria o próprio loop. Não há N que separe "Oi Filipe!"(10) de ack legítimo. O discriminador é **FREQUÊNCIA, não tamanho**.

**B2 — placement errado.** `copilot-v2-worker:173` (VIVO, cron 1/min) chama `governSend` DIRETO com `provider.sendText`, **sem passar pelos helpers** → v2 bypassa o fix inteiro. `copilot_v2` nem está no vocab. O choke REAL que TODOS cruzam é o próprio `governSend`, não os helpers.

### CORREÇÃO 1 (Q3, CONTESTADO→RESOLVIDO): modelo por TAXA, não binário
Troca reserva-binária por **contador com cap K** (default **3**, env-tunável). **Refinamento meu sobre a proposta do Forja: NÃO dropar o índice único — repurposá-lo.** Mantém `(org,phone,content_hash,source)` único, ADD `hit_count int`, **UPSERT atômico** incrementa (race-free, preserva a atomicidade que o #1252 acertou):
```
INSERT (...,hit_count=1) ON CONFLICT (content key) DO UPDATE SET
  hit_count = CASE WHEN expires_at < now() THEN 1 ELSE hit_count+1 END,
  reserved_at/expires_at = reset quando expirado
RETURNING hit_count  →  SUPRIME quando hit_count > K
```
Fecha B1 (2 chunks idênticos: count 1,2 ≤ K → passam), fecha refino (ack "Ok" 2× passa; "Oi Filipe" 12× suprime do 3º), separa por frequência. Migration (ADD hit_count + reescrever reserve p/ upsert-cap) + rollback + pgTAP — **área frágil DB, Crivo de novo**. **Dedup é BACKSTOP** — o loop-kill primário é a reputação do #1243 + cap de taxa por-conversa (fatia futura). Não vender dedup como o matador do loop.

### CORREÇÃO 2 (Q1, CONTESTADO→RESOLVIDO): dedup DENTRO de governSend, não nos helpers
B2 = **opção (a): mover o gate de dedup pra DENTRO de `governSend`** (gate.ts, o choke ÚNICO real). Cobre v2 + todo futuro caller-direto "de graça". (b) rerotear v2 pelo helper é o fix-parcial que gerou ESTE bug — recusado. Contrato: estender `GovernorContext` com `content?: string` (governSend hasheia; ausente → pula dedup, fail-open). Suppressão retorna o sentinel `isSkippedSend` **ANTES de doSend E antes de incrementAutomationUsage** (fecha o over-count do gate.ts:283-290 de graça). Todos os callers passam `content` no ctx (5 helpers + v2-worker); ADD `copilot_v2` ao SendSource. Kill-switch `SEND_DEDUP_CONVERSATIONAL_ENABLED` segue gateando. **Coordenar com Marcelo — construir SOBRE o #1243 já mergeado** (o try/catch de recordBanSignal já está lá; o dedup entra como gate pré-send).

Isto era o erro do MEU macro: "dedup no dispatch onde governSend mora" → pus nas closures dos helpers; o choke real é o próprio governSend. Corrigido.

## CONTEXT PACKET — CP-v2

**Alvo (paths provados):**
- `_shared/whatsapp-dispatch.ts:299` `sendTextViaInstance` (+ irmãs ~349/397/456/514) — inserir `reserveSendOrSkip` após `governSend`, antes de `doSend`.
- `_shared/send-dedup.ts:15` `SendSource` union; `:22` `DEFAULT_WINDOWS_SECONDS` (copilot 60→**300**); `:166` `reserveSendOrSkip` (fail-open já ok); `:75` `tryReserveSend` INSERT ON CONFLICT.
- `whatsapp-webhook/index.ts:~800` caller `trackSource:"copilot"` — **não mexer**.
- unique key `send_dedup_log (org_id, phone, content_hash, source)` (migration #1252 linha 53-54).

**Área frágil:** envio WhatsApp de 93 orgs; Copilot; multi-tenant (org_id na key).

**Descartado (arquitetural):** Opção B (webhook-only) — deixa dispatchers/mídia/proxy descobertos, é o fix-parcial que gerou o bug. Coluna/enum novo — desnecessário, a key existente já é recipient-scoped. Window 60s — insuficiente p/ loop de 150s.

**Descartado (herdado da Lanterna, NÃO re-investigar):** drift de deploy; "só grava duplicata" (INSERT do 1º já grava); TTL/purga como causa (mass 1-dia e 0 linhas).

**Aberto (fora desta fatia):** cap de taxa por-conversa (loop lento estrutural); mass bulk-API `/sender/*` dedup.

**Áreas frágeis a validar (Crivo):** falso-positivo, fail-open genuíno, kill-switch neutro em OFF, `deriveSendSource`.
