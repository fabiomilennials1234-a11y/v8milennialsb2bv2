# Send Governor — anti-ban WhatsApp

**Status:** PR-0 (foundation + shadow wiring) implementado. Não aplicado em dev/prod.
**Área frágil:** WhatsApp/Uazapi + multi-tenant + PII. Rigor extra.

## Problema

Números WhatsApp queimados por Meta 463 (restrição temporária → ban permanente se insistir): Elvéra, Bennedita Pan (chip novo morto ~30min pós-disparo frio), Motor100 (lead disparado 7-12×). Causa-raiz: automação de contato frio, sem warm-up, **sem teto por-número, sem disjuntor de reputação**.

Estado pré-governor: o teto 80/dia (`whatsapp_instances.daily_blast_cap`) só cobre **mass send**. Automação (copilot/workflow/pipe/campaign) enviava **sem teto por-número**. 463/429 do Uazapi caíam em bucket 4xx genérico — sem pausa, sem back-off, sem quarentena.

## Solução — choke de decisão único, aditivo, fail-open

`send-governor` = lib de decisão pura + seam `governSend` + captura universal de sinal de ban. **Não** ressuscita o `message-gateway` morto (abstração errada, flag inexistente, 4 call-sites).

### Módulos (`supabase/functions/_shared/send-governor/`)

- `types.ts` — GovernorContext/State/Decision + enums.
- `core.ts` — `evaluateSend(ctx, state)` **PURO** (zero IO, clock-free via `state.nowIso`). Toda a lógica P1-P4 + máquina P3. Espelha `quick-blast/quiet-hours.ts`.
- `io.ts` — `resolveGovernorState` (**FAIL-OPEN**: qualquer erro → estado permissivo → allow), `recordDecision` (runtime_logs), `incrementAutomationUsage`, `recordBanSignal`. Reusa `resolveInstanceCap`/`saoPauloUsageDate` do quick-blast.
- `gate.ts` — `governSend(supabaseAdmin, ctx, doSend)`. Orquestra + fail-open.

### Precedência do core (primeiro match vence)

```
0. mode 'off'                        → allow  (governor_off)
1. category 'manual'                 → allow  (manual_exempt)   [qualquer modo]
2. category 'system'                 → allow  (exempt PR-0)
3. P3 quarentena (automation|mass)   → block  (quarantined)
4. category 'mass'                   → allow  (caps: blast_* existentes)
5. P1/P2 teto por-número (automation)→ defer  (per_number_cap)   [warmupCap se P2 on]
6. P4 cold gate (automation)         → block  (cold_contact)     [se org habilitou]
7. senão                             → allow
```

**SHADOW OVERRIDE:** `mode==='shadow'` → ação efetiva SEMPRE `allow`; o veredito real fica em `decision.wouldBe` + `shadowed=true`. Shadow **nunca** emite block/defer real (invariante testada).

### Algoritmos

- **P1** teto por-número na automação (ledger `automation_instance_daily_usage`, RPC atômica).
- **P2** warm-up ramp por idade do número: `0→20, 1-2→30, 3-6→50, 7+→cap`. `warmupCapForAge` clampa a baseCap; idade desconhecida → baseCap (fail-open, nunca aperta em dado faltante).
- **P3** disjuntor: 463 OU 3º sinal/24h → `quarantined` (24h p/ 463, 1h p/ 429). Quarentena expira no read (recover implícito). Bloqueia automation+mass, nunca manual.
- **P4** cold gate (opt-in, default off): sem inbound prévio (`channel_messages.direction='incoming'`) → block automação. Manual isento.

### Choke nos caminhos (shadow)

Seam único por camada, **sem dupla-governança**:
- Primitivos `whatsapp-dispatch.ts` (5× `send*ViaInstance`) → cobre campaign/pipe/semi/carteira/scheduled/copilot-batch/webhook/action-handlers de uma vez. category `automation`.
- `outbound-sender.ts` (copilot turn), `followup-sender.ts` (follow-up), `copilot-v2-worker` — chamam `provider.sendText` direto → seam próprio, category `automation`.
- `dispatch-router.ts` (mass) → só gate de reputação P3; caps de volume seguem nos ledgers `blast_*`.
- **Manual** (`whatsapp-api-proxy`) — NÃO envolvido em PR-0; isento por design.
- **Captura universal 463/429** no `uazapi-client.ts request()` → `reputation-signal.ts` grava `runtime_logs` (event `reputation_ban_signal`), reusa o errBody já parseado (sem double-consume), throw preservado.

## Garantias anti-quebra (o medo do CTO)

- **Fail-open** — bug/timeout no governor → envio passa. `resolveGovernorState` time-boxed 1200ms; DB pendurado nunca segura envio.
- **`doSend` exatamente 1×**, FORA do try/catch → throw do provider propaga inalterado, impossível double-send.
- **Telemetria DEPOIS do envio** (nunca na frente da entrega).
- **Deploy-order-safe** — código antes OU depois da migration = seguro. Pré-migration: `organizations` sem colunas → PostgREST `{data:null}` → `mode='off'` → inerte. RPCs inexistentes só chamadas quando `mode!=='off'`.
- **Default OFF** por org. Rollback = 1 UPDATE (`send_governor_mode='off'`).
- **Manual nunca bloqueia.**

## Schema (migration `20270722000000_send_governor_foundation.sql`)

- `whatsapp_instance_reputation` — máquina de estado por número (healthy/warming/quarantined).
- `automation_instance_daily_usage` — ledger por-número/dia (espelha `blast_instance_daily_usage`).
- `organizations.send_governor_mode|_warmup_enabled|_cold_gate_enabled` (default off/false/false).
- RPCs SECURITY DEFINER + `search_path=''` + REVOKE FROM PUBLIC + GRANT service_role: `increment_automation_daily_usage`, `record_ban_signal`, `set_instance_reputation`.
- RLS via `get_my_organization_ids()` + `is_master_user()`; writes deny-all cliente.

## Segurança

- Multi-tenant: `organization_id` sempre do job/auth, nunca do body.
- PII: `recipient_hash` em runtime_logs = HMAC-SHA256(env `SEND_GOVERNOR_HASH_SALT`, telefone) truncado 16 hex. Sem salt → loga `null` (nunca pseudônimo reversível). Corrigido de FNV-1a 32-bit (reversível) na revisão.
- REVOKE FROM PUBLIC (não anon — no-op conhecido). `has_function_privilege` a verificar pós-apply.

## Fronteiras de escopo (PR-0)

- **Feed da tabela de reputação DORMANTE.** `record_ban_signal` só dispara quando `UazapiClientConfig.instanceId` está threaded — undefined em todos construction sites hoje. Em PR-0 só o `runtime_logs` event captura sinais; a tabela `whatsapp_instance_reputation` não é populada. Threading do instanceId = **PR-1 (P3)**, junto com o enforcement.
- **Ledger conta por-chunk** (smart-split): N chunks = N incrementos. Semântica defensável (cada chunk = 1 msg WhatsApp real), mas o cap "por-número" trip mais cedo que a intuição. Calibrar antes de enforce.
- **Cold gate** (`resolveIsColdContact`) valida só "sem inbound prévio"; a metade "sem tag opt-in" não foi implementada (schema sem convenção). Revisar antes de habilitar P4.

## Rollout (cada fase: dev → shadow Milennials → enforce Milennials → frota)

`Shadow (todas) → P3 disjuntor → P2 warm-up → P1 hard-cap automação → P4 cold gate`

- **PR-0** (este): substrato + core + shadow wiring. Deploy dev → observar `runtime_logs event=governor_decision`.
- PR-1: P3 enforce + threading instanceId (feed reputação).
- PR-2: P2 warm-up. PR-3: P1 hard-cap. PR-4: P4 cold gate (opt-in). PR-5: UI observabilidade.

**Org piloto:** Milennials `6030520a-2ca7-477d-be89-55758e2cd808`.

## Verificação

- `npx vitest run tests/unit/send-governor-core.test.ts tests/unit/send-governor-gate.test.ts` → 47/47.
- `deno check supabase/functions/_shared/send-governor/*.ts` → limpo.
- Deploy dev + `send_governor_mode='shadow'` na piloto → automação real → conferir `governor_decision` em runtime_logs, zero envio bloqueado.
- Rollback: `UPDATE organizations SET send_governor_mode='off'`.
