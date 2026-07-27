# 2026-07-26 — Fix rate limit + dedup do WhatsApp (área frágil / vetor de ban)

> Autorizado pelo CTO. Diagnóstico: Lanterna (confirmado em prod via MCP). Confirmado sem colisão vs #1243 (Send Governor). Crivo roda rubric BLOQUEANTE.

## O furo (confirmado em prod)
Dois caminhos de proteção de envio estavam **desligados em silêncio** porque objetos de banco nunca foram aplicados — os CREATE viviam só em `archive/` e o baseline de 22/07 (dump do prod real) congelou a ausência:
1. `send_dedup_log` ausente → `_shared/send-dedup.ts` (fail-open por design) caía sempre no catch → **dedup desligado** (vetor Bertin: 12× "Oi Filipe!" em 30min).
2. `check_whatsapp_rate_limit` ausente → os 3 dispatchers chamavam RPC inexistente, descartavam o `error`, `data` null → `can_send` nunca barrava → **rate-limit fail-open**.

## Decisão de desenho (Lanterna + Pauta, vs #1243)
- **dedup**: gap genuíno e independente do governor (path de workflow/copilot). **Criar a tabela.** Fail-open **mantido** (nunca derrubar envio legítimo) — mas passa a **GRITAR** em `runtime_logs`.
- **rate-limit**: o **Send Governor (#1156)** já é o choke canônico — todo send dos 3 dispatchers passa por `sendTextViaInstance → governSend` (verificado no código). O `check_whatsapp_rate_limit` é contador hora/dia **redundante**. **NÃO revivido** — os call-sites mortos foram **removidos** (reviver = double-throttle sobre o choke único). Confirmado sem colisão vs PR #1243 (toca só 4 arquivos, nenhum dispatcher).

## Arquivos tocados
- `supabase/migrations/20260726120000_send_dedup_log.sql` (+ rollback) — tabela + índices parciais únicos (content-hash e idempotency-key) + RLS org-scoped (`get_my_organization_ids`) + cron de limpeza idempotente. Adaptado do archive: RLS já corrigida (era `auth.org_id()` inexistente), cron guardado p/ replay.
- `supabase/functions/_shared/send-dedup.ts` — no catch fail-open de `reserveSendOrSkip`, `console.warn` → **+ `logRuntime` (status=error, module=outbound, action=dedup_reserve_fail_open)**. Quebra permanente para de ser silêncio.
- `supabase/functions/{campaign-rule,pipe-rule,semi-automatic}-dispatch/index.ts` — removidos os 6 call-sites mortos (`check_whatsapp_rate_limit` ×3 + `increment_whatsapp_rate_limit` ×3). Preservados o fetch de `whatsapp_rate_limit` e o jitter `delay_min/max_ms` (throttle real, no send path).
- `supabase/tests/send_dedup_log_test.sql` (+ run.sh) — pgTAP.

## Testes (pgTAP)
Dedup barra duplicata real (ON CONFLICT DO NOTHING → 0 linhas), conteúdo/source diferente passa, idempotency-key barra replay, isolamento por org, cron registrado, e **NO-REVIVE** (as 2 RPCs velhas continuam ausentes). Validação corre em **branch hospedada** (sem Docker — regra CTO); pedida ao Pauta.

## O que trava / follow-up
- **Deploy manual** das 3 edge functions (drift conhecido: deployar de branch atrasada REVERTE main). Ordem-segura: a migration do `send_dedup_log` vai a prod ANTES do deploy das fns; as remoções são no-op até deployar (RPC já não existia).
- deno check dos 3 dispatchers acusa erros `never` **pré-existentes** (supabase-js × types.ts gerado, statements não tocados) — edge não typecheck em runtime; meu diff é remoção-only.
- Fail-**closed** no rate-limit: direção certa mas baixa urgência (governor cobre o vetor) → fatia de edge separada, não aqui.
