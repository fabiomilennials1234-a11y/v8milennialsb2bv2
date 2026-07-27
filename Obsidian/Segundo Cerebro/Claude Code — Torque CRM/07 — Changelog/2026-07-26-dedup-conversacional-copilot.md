# 2026-07-26 — Dedup conversacional (Copilot) no choke de envio

> Área frágil (WhatsApp/Uazapi + Copilot). Macro: `.specs/project/macro-dedup-conversacional-copilot.md` (Cais, OPÇÃO A). Diagnóstico: Lanterna. Crivo roda rubric BLOQUEANTE. #1156.
> **Volta 2** — este doc reflete o desenho após os 2 achados da volta 2 (Crivo). Volta 1 fechou BLOQ-1/BLOQ-2/reset-gap/env-bar/órfãos.

## Volta 2 — 2 achados do Crivo (fechados)

**BLOQUEANTE (segurança cross-tenant) — `fn_reserve_send` exposta a `authenticated`.** A função é SECURITY DEFINER (bypassa RLS) e o corpo não autoriza nada (`p_org_id` vem do parâmetro). O `GRANT ... authenticated` da volta 1 era superfície de ataque pura: um user da org A chamaria `rpc('fn_reserve_send', {p_org_id:<org B>, ...})` 3× → inflaria o `hit_count` de uma chave da org B → **supressão cross-tenant de envio WhatsApp (DoS direcionado)** + escrita cross-tenant. O único caller é a edge (service_role). **Fix:** `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` (system-only). pgTAP afirma `authenticated` negado.

**GAP (idempotência de retry) — nonce por-chamada era código morto.** `dedupNonce = crypto.randomUUID()` gerado por chamada de entrega → retry re-gerava o nonce → idk novo em todo chunk → reply inteira reenviada, e o `barAt=2` do caminho idk nunca disparava (morto). **Fix:** nonce derivado de id ESTÁVEL entre retries: `whatsapp-webhook` → `persisted.message_id` (id da inbound); `outbound-sender` → `dispatchId`; `followup-sender` → `${leadId}:${ruleId}` (template → conteúdo estável por rule, phone-scoped via lead). Retry do chunk i reusa o idk → conflito → `hit=2` → `barAt=2` dispara → **retry idempotente**. Single-chunk segue sem idk (caminho de conteúdo por frequência, inalterado).

## CORREÇÃO do #1252 (append-only — não reescreve história)

O **item 4 do #1252** (changelog `2026-07-26-wa-ratelimit-dedup.md`, PR mergeado `ea14475c`) afirmou que os action-handlers cobriam o vetor conversacional do Bertin. **Estava errado**: action-handlers são o DAG de **workflow** (`source:workflow`), não o webhook do **Copilot**. O reply do Copilot vai por `whatsapp-webhook → sendTextViaInstance(trackSource:'copilot')` e pelo `copilot-v2-worker → governSend(trackSource:'copilot_v2')` — nenhum deduplicava. Consequência medida: **29.811 outgoing em 72h ao largo; `send_dedup_log` = 0 linhas**. O loop bot-to-bot ("12× Oi Filipe") seguia sem proteção. Este PR supersede aquele item 4.

## Desenho final (o que mudou do volta-0 reprovado)

**BLOQUEANTE 1 — copilot-v2 bypassava.** O volta-0 punha o dedup nas 5 closures `send*` do `whatsapp-dispatch.ts`. O `copilot-v2-worker` (cron 1/min, VIVO) chama `governSend` **direto**, sem passar por essas closures → escapava o fix. **Correção:** o gate mora agora **DENTRO de `governSend`** (`send-governor/gate.ts`), no ramo allow, antes do `doSend` e do accounting pós-send. Isso cobre **todos** os 4 callers diretos de `governSend` de uma vez (copilot-v2-worker, dispatch-router, followup-sender, outbound-sender) + os helpers do `whatsapp-dispatch`. Suprimir antes do `incrementAutomationUsage` também mata o over-count que o Crivo apontou (duplicata não conta como uso).

**BLOQUEANTE 2 — chunking mutilava.** Copilot fragmenta o reply em N chunks; dedup por conteúdo barraria chunks legítimos distintos. **Correção:** `idempotencyKey` por **mensagem lógica (nonce por-chamada) + índice de chunk**. Só em multi-chunk (`chunks.length > 1`): chunks distintos da mesma reply têm idk distinto → cada um insere → envia. Single-chunk fica **sem** idk → cai no caminho de conteúdo (pega o loop). Wired em `whatsapp-webhook`, `followup-sender`, `outbound-sender`.

**REFINO — limiar por FREQUÊNCIA, não binário nem por tamanho.** O reserve binário do #1252 barra a 2ª idêntica; no path conversacional isso é falso-positivo dominante. Dado de prod (14d): **520 rajadas de exatamente 2** (ack legítimo "Ok"/"Certo") vs **3 loops de 12+**. Piso de tamanho NÃO fecha (1 loop é "Oi Filipe!" = 10 chars). Discriminador certo = **contagem**:
- `copilot` / `copilot_v2`: **bar-at-3** (permite 2, barra da 3ª). Env-tunável `SEND_DEDUP_COPILOT_BAR_AT`.
- `workflow`/`mass_send`/`manual`/`followup`: **bar-at-2** (= comportamento #1252).
- idk presente (chunk): **bar-at-2** sobre o próprio idk (só replay literal do MESMO idk deduplica).

**FURO — balde fixo → reset-por-gap.** Contador acumulado viraria supressão permanente se o purge atrasasse. `fn_reserve_send` reseta `hit_count` a 1 quando a linha anterior já expirou (gap > janela) → "N idênticas com gap < janela", auto-cura o atraso do cron.

**copilot_v2 no vocabulário.** `SendSource` e a CHECK de `source` ganham `copilot_v2` (worker vivo).

## Mudanças

### DB (`supabase/migrations/20260726130000_send_dedup_hit_count.sql`, aditiva, rollback pareado)
- `send_dedup_log.hit_count integer NOT NULL DEFAULT 1` (1º send responde `hit_count=1`).
- CHECK de `source` recriada incluindo `copilot_v2`.
- **`fn_reserve_send(org, phone, hash, source, idk, ttl) → integer`** (SECURITY DEFINER, `search_path=public`): UPSERT atômico `ON CONFLICT DO UPDATE` sobre os índices únicos parciais do #1252 (mantidos, **não** dropados — a atomicidade race-free que o #1252 acertou). Devolve `hit_count` com reset-por-gap. Caminho idk usa o índice idk-partial; caminho de conteúdo usa o content-partial. ACL: `REVOKE PUBLIC,anon` + `GRANT service_role, authenticated`.

### Código
- **Gate no choke** (`_shared/send-governor/gate.ts`): dedup dentro de `governSend`, ramo allow, pré-`doSend`. Duplicata ⇒ retorna `SkippedSend{reason:'dedup_conversational', action:'block'}` sem chamar `doSend`. `logUnknownDedupSource` loga 1× por `trackSource` fora do vocabulário. Fail-open total (belt-and-braces `try/catch`).
- **`GovernorContext`** (`_shared/send-governor/types.ts`): `+content` (hasheado, nunca logado cru) e `+idempotencyKey`. Reason `dedup_conversational` no enum.
- **`_shared/send-dedup.ts`**: `SendSource +copilot_v2`; `DEFAULT_WINDOWS_SECONDS` copilot/copilot_v2/workflow=300, mass=86400, followup=3600, manual=10; `dedupBarAt` (copilot 3 env-tunável, demais 2); `deriveSendSource` mapeia os **7 trackSource órfãos** da Lanterna (copilot-class → copilot/copilot_v2; `carteira_bulk`/`dispatch-router-mass`/`portfolio_alert`/desconhecido → **null**, pula, loga); `conversationalDedupEnabled` (kill-switch + allowlist); `tryReserveSend` reescrito via `rpc('fn_reserve_send')` → decide por `hit_count >= barAt`.
- **Callers wired com `content` (+ idk multi-chunk)**: `whatsapp-dispatch.ts` (5 send* + `sendTextViaInstance`), `copilot-v2-worker` (`content:text`), `followup-sender` (`content:chunks[i]` + idk), `outbound-sender` (idem), `whatsapp-webhook:772` (idk por parte).

### Flags (blast-radius de 93 orgs seguro)
- `SEND_DEDUP_CONVERSATIONAL_ENABLED` (default **OFF** = byte-a-byte de hoje; o gate vira no-op).
- `SEND_DEDUP_CONVERSATIONAL_ORGS` (csv; vazio = todas; preenchido = canário Milennials/Bertin).
- `SEND_DEDUP_COPILOT_BAR_AT` (limiar copilot, default 3).

## Observabilidade
- skip → `logRuntime('dedup_skip', {source, phone_hash, ttl, chunk})` (telefone **hasheado**, nunca cru).
- source fora do vocabulário → `dedup_source_unknown` (1× por valor).
- fail-open de infra → `dedup_reserve_fail_open` (do #1252). Motivo: o bug ficou silencioso meses (0 linhas, ninguém viu).

## Testes
- `tests/unit/send-dedup.test.ts` (reescrito, RPC-based) + `tests/unit/whatsapp-dispatch-conversational-dedup.test.ts` (reescrito p/ `governSend`): **40 asserts** verdes — `deriveSendSource` (7 órfãos + nulls), `dedupBarAt` (env), `conversationalDedupEnabled` (kill-switch/allowlist), contagem 1→2→3, idk bar-at-2, skip→não-envia, fail-open, phone hasheado no log, source desconhecido loga 1×.
- `supabase/tests/send_dedup_log_test.sql` (+bloco HITCOUNT): `fn_reserve_send` contagem, reset-por-gap, idk-por-chunk não mutila, `copilot_v2` aceito, ACL anon-negado. **Exercício real contra DB = condição de merge** (Bancada dirige na branch efêmera de prod; Docker fora por decisão CTO).

## Prova por construção (blast-radius)
Chave recipient-scoped `(org_id, phone, content_hash, source)`. Falso-positivo só = texto idêntico + mesmo phone + mesma janela + **atingiu o limiar do source** = o loop. Mass "Bom dia" a 500 phones = 500 chaves → zero dedup indevido. 2 acks "Ok" legítimos (copilot) passam (bar-at-3). Fail-open cobre erro de infra.

## Segurança (pro Crivo — rubric bloqueante)
- Falso-positivo (perda de msg): mitigado por recipient-scoped + limiar-por-contagem + window + kill-switch + canário.
- `fn_reserve_send` SECURITY DEFINER com `search_path=public` fixo, ACL sem PUBLIC/anon; escrita só via service_role (edge) / authenticated (gateado por RLS da tabela).
- Multi-tenancy: `org_id` na chave; RLS da `send_dedup_log` (do #1252) provada como `authenticated` no pgTAP.
- Fail-open genuíno em toda borda (sem content, source null, flag off, infra down) → nunca dropa envio.

## Follow-ups
- Cap de taxa **por-conversa** (loop parafraseado, LLM varia texto → hash nunca repete) = domínio do Send Governor por TAXA, fatia futura. Dedup por conteúdo é TETO, não matador de loop — documentado, não vendido como tal.
- Deploy: OFF → flip ON canário (Milennials/Bertin) → observar `send_dedup_log` ganhar `source=copilot`/`copilot_v2` → geral. **Botão do humano. Não deployei.**
- Mass bulk-API `/sender/*` e `carteira_bulk` fora do escopo (dedup por destinatário, não content-hash — fatia própria da Lanterna).
