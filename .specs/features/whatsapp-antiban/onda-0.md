# Anti-ban WhatsApp — Onda 0 (quick wins)

Branch `fix/antiban-onda-0` · 2026-07-16 · 7 patches isolados, 1 commit por QW (revertíveis independentes). Dev only — **nada deployado em prod**. Contexto maior (Send Governor P1–P4) fica fora de escopo; ver memória `project_whatsapp_antiban_delivery_plan`.

## Contrato respeitado

- **Envio humano 1:1 (composer → whatsapp-api-proxy)**: zero mudanças. Nenhum QW toca esse caminho.
- **Resposta do copilot**: nunca deixa de sair. QW5 é prefer-viva-COM-fallback (nunca `no_active_instance` onde antes saía); QW4 não alimenta o circuit breaker.
- **Módulos compartilhados**: mudanças aditivas (helpers/exports novos); throw/retry/breaker existentes intactos.

## O que mudou por QW

| QW | Commit | Mudança |
|----|--------|---------|
| QW1 | `60bdeddd` | Teto diário por número (`blast_instance_daily_usage`, ADR-0015) estendido a Quick Blast (`run.ts` seam + injeção no edge fn), Mass Send (trim pré-dispatch + 429 `instance_daily_cap_exhausted` + increment pós-enfileiramento) e Blast Plan single-number (create + release: `min(org remaining, headroom do número)` + increment duplo). Fail-closed pelo contrato do `instance-budget.ts`. Novo skip label `overInstanceCap` e erro `instance_daily_cap_exhausted` (aditivo). |
| QW6 | `ce1ffafa` | `_shared/humanize-batch.ts`: variante `humanizeMessage` POR destinatário no `mass-send-create` (pool 5, budget 60s wall-clock, fail-open estrito — falha/timeout/budget mantém original). Variante congelada = payload enfileirado no /sender (pollável por mensagem no Uazapi). Fallback pra `caption` em mídia. |
| QW3 | `ca863b7d` | `_shared/anti-ban-jitter.ts` (3–8s, `maxBatchForBudget`). Jitter ENTRE destinatários (nunca antes do 1º): `process-outbound-dispatches` (BATCH 50→**12** = 240s/20s; tick */5 sem row-lock, run cabe no tick), `process-scheduled-user-messages` (BATCH 20→**10** = 120s/12s; row-lock cobre overlap; lock-miss não dorme), `process-copilot-followups` (BATCH_PER_RULE 20→**10**; jitter cross-rule; skips não dormem), `carteira-bulk-message` (jitter com **budget 90s** — request síncrona do admin; estourou → continua enviando sem espaçamento, nunca perde cliente). Restos ficam pending/scheduled pro próximo tick (semântica já existente). |
| QW2 | `7b5fa2f6` | `clampSenderDelays` no `runUazapiSenderJob` — ponto ÚNICO de saída /sender/advanced (Quick Blast, Blast Plan e Mass Send convergem ali; verificado): `delayMin=max(3000,x)`, `delayMax=max(min,y)`, omitido/lixo → piso. Payload de `uazapi_sender_jobs` grava valores efetivos. UI: inputs `min={3}` + validação `>=3` em QuickBlastDialog e DisparoWizard (pipelines). |
| QW7 | `889dc46c` | Áudio fire-and-forget do `outbound-sender` (setTimeout 8s) vira promise em `EdgeRuntime.waitUntil` (padrão forgot-password) — sobrevive à reciclagem do isolate. Resto idêntico (áudio pós-texto, não bloqueia loop, erro só warn). |
| QW4 | `e34a14d3` | `_shared/reputation-signal.ts` (sem dep Deno top-level): `classifyBanSignal` (463/429/403 OU corpo ~ `/ban\|block\|spam\|rate\|forbidden/i`), contador in-memory por hash FNV-1a do token, console estruturado tag `reputation_ban_signal`, persist best-effort em `runtime_logs` (module `whatsapp`, action `reputation_ban_signal`) via dynamic import guarded. Wire no ramo 4xx do `uazapi-client` antes do throw, em try/catch próprio. **Zero contato com o circuit breaker** — teste prova 3×463 não abrem breaker. |
| QW5 | `e07a7829` | `selectSendableInstance` em `_shared/whatsapp-dispatch.ts`: prefere `session_dead_since IS NULL` + `last_connection_at DESC nullsLast`; vazio → fallback byte-idêntico à query legada. Aplicado no `copilot-batch-processor`. |

## Desvios do plano (com evidência)

1. **QW5 / whatsapp-webhook NÃO alterado.** A premissa do plano (`.in("status",["open","connected"]).limit(1)` no loop de resposta) não existe no código: o webhook pina em `persisted.instance_id` — a instância que RECEBEU o inbound (linhas ~760-764), sem seleção org-wide. Isso é o comportamento correto (responde pelo mesmo número que o lead escreveu); trocar por seleção org-wide poderia responder de OUTRO número. A única seleção zumbi-prone era a do batch-processor, corrigida.
2. **QW3 / process-followup-automations fora.** Não envia WhatsApp — só INSERT de rows em `follow_ups` (tarefas internas). Jitter seria inócuo. O follow-up worker que ENVIA é `process-copilot-followups` (coberto).
3. **QW3 / carteira-bulk-message com budget.** É human-triggered síncrono (UI admin, JWT, resposta HTTP com resultados), não cron. Jitter puro em lote grande estouraria a request → clientes sem envio e sem resultado. Budget de 90s: protege lotes típicos por inteiro; lotes grandes degradam o espaçamento, nunca o envio.
4. **QW2 / frontend já conforme.** Campanhas wizard já abria com anti-ban ON default ([5000,30000], #907). Só alinhado o piso de 3s nos inputs dos outros dois diálogos (defaults 5s/30s já conformes).

## Segurança (multi-tenancy / envio)

- `org_id` continua vindo do auth/JWT em todos os caminhos tocados; nenhum passou a ler org do body.
- `selectSendableInstance` escopa por `organization_id` (testado); tenant-check do mass-send-create (instance.organization_id === orgId) intacto e ANTES do trim/humanize.
- QW4: token NUNCA logado — só hash FNV-1a one-way; chave de payload é `instance_key` (o redactor do logger apagaria qualquer chave contendo "token").
- Nenhum header novo de saída no client (incidente CORS trace-headers não se repete). Wrappers `withErrorBoundary`/`withSecurityHeaders`/CORS/OPTIONS intactos em todas as funções tocadas.
- Sem migration nova — QW1 reusa tabela/RPC existentes (`blast_instance_daily_usage`, `increment_instance_daily_usage`, service_role-only).

## Verificação

- Testes unit novos: 48 (`quick-blast-instance-cap` 8, `blast-plan-single-number-cap` 5, `humanize-batch` 6, `anti-ban-jitter` 6, `dispatch-router-delay-clamp` 6, `reputation-signal` 19 incl. prova breaker-intocado, `whatsapp-dispatch-select-sendable` 6) — todos verdes.
- `deno check`: 60 erros pré-existentes em origin/main, assinaturas IDÊNTICAS na branch (repo roda `--no-check` por design); módulos novos = 0 erros.
- `uazapi-client.test.ts`/`uazapi-provider.test.ts`: 10 falhas pré-existentes em HEAD (testes stale de retry) — verificado idêntico sem os commits desta branch.
- Build/lint/test:unit completos + QA manual do chat: ver relatório da sessão.

## Review adversarial (18 agentes: 5 lentes + verificação por finding)

13 findings → 9 confirmados (7 únicos) → **todos corrigidos** em 4 fix-commits; 4 refutados.

| Fix | Commit | Achado |
|-----|--------|--------|
| QW5 | `3ff73d25` | Query preferida provider-blind elegeria meta_cloud deterministicamente (sempre "viva" + last_connection_at fresco) → copilot mudo via MetaWindowClosedError. Provider filter na preferida; fallback continua byte-idêntico ao legado. |
| QW1 | `855d069f` | (1) Plano single-number criado com número no teto estrandava TODOS os recipients (move incondicional pro lot 1 com lots_released=0 → release lia lot 0 vazio → completed; reproduzido por execução); (2) `remaining` do quick blast agora = min(org, número) → wizard oferece "Agendar em lotes" quando o número é o gargalo; (3) ledger per-número particiona pelo dia do ENVIO (`scheduled_for`), não da criação — senão o chip dobrava o cap no dia real. |
| QW3 | `d515209c` | (1) Lock do scheduled-user-messages não era CAS (PostgREST sucesso com 0 rows) — jitter esticando o batch > tick de 1min = double-send em overlap; agora `.select('id')` + checagem; (2) guarda de wall-clock nos 2 workers (240s/120s) — pior caso real por dispatch (mensagem longa) não é limitado pela estimativa; run para no budget, resto fica pro próximo tick. |
| QW6 | `15abaaad` | Item de mídia varia a CAPTION (campo renderizado) — text morto carimbado pelo mass-send era o que estava sendo reescrito. |

Refutados (falso-positivo, com razão): trim silencioso do mass-send ×2 (useCreateMassSend não tem call-site vivo — página deletada no #904), check-then-act do ledger (design pré-existente documentado do ledger, janela mínima, increment atômico), PII no console do humanizer (log pré-existente do módulo, não desta branch).

## Follow-ups (fora da Onda 0)

- Wizard exibir `overInstanceCap`/`trimmed_count` (UI hoje ignora as chaves novas — comportamento seguro).
- Agregação/alerta sobre `reputation_ban_signal` em runtime_logs (P3 disjuntor de reputação).
- Testes stale de uazapi-client (retry pré-SC-Beauty) precisam de faxina — não tocados aqui.
