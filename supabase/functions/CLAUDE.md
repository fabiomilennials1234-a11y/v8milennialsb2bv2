# `supabase/functions/` — Edge Functions

96 funções edge Deno servindo o Torque CRM. Slice 15 da modularização: **doc-only** — agrupa funções por bounded context (BC) sem rename físico.

## Por que doc-only

Supabase CLI exige `supabase/functions/<name>/index.ts` plano — subpastas viram rename. Renome em massa quebraria:

- Webhooks externos registrados (Meta, Uazapi, TinyERP, Asaas, SZChat, ERP, Trello/n8n) — URL hardcoded por nome
- `pg_cron` jobs (10+) chamando via pg_net — URLs hardcoded
- `pg_net` triggers em migrations — paths hardcoded
- Frontend `supabase.functions.invoke('<name>')` em 100+ call sites
- Internal function-to-function calls
- API keys públicas (`meeting-webhook` via Bearer)

Rename full = janela de deploy coordenado + reregistro multi-provider + risco prod alto. **Adiado pós-modularização.** Doc serve de mapa enquanto físico permanece flat.

## Status modularização edge

🟡 **Doc-only** — funções permanecem em `supabase/functions/<name>/`. Agrupamento abaixo é **lógico**, não físico. Subagent que tocar uma função deve respeitar o BC dono ao decidir paths de `_shared/<bc>/`.

Rename físico = projeto separado (ver "Rename futuro" abaixo).

## Mapa por BC (96 funções)

### identity (9) — auth, org, team, permissions, master

| Função | Trigger | Auth |
|--------|---------|------|
| `admin-reset-user-password` | UI master | JWT admin |
| `assign-user-to-org` | UI master | JWT admin |
| `attach-to-org-by-pending-invite` | UI signup | JWT user |
| `create-org-user` | UI master / signup | JWT/admin |
| `get-member-permissions` | UI | JWT |
| `list-organizations` | UI master | JWT master |
| `list-unassigned-users` | UI master | JWT master |
| `remove-org-member` | UI admin | JWT admin |
| `save-member-permissions` | UI admin | JWT admin |

### leads (7) — lead ingest, score, timeline

| Função | Trigger | Auth |
|--------|---------|------|
| `calculate-lead-score` | UI / pg_net | x-cron-secret / JWT |
| `cadastro-externo-push` | webhook externo | shared secret |
| `get-lead-timeline` | UI | JWT |
| `import-leads` | UI bulk | apikey + org_id internal |
| `lead-webhook` | n8n / externos | apikey |
| `partner-webhook` | partner integrations | apikey |
| `webhook-new-lead` | externo | apikey |

### pipelines (4) — pipe distribution, confirmação

| Função | Trigger | Auth |
|--------|---------|------|
| `get-daily-priorities` | UI dashboard | JWT |
| `pipe-rule-dispatch` | pg_cron + pg_net | x-cron-secret |
| `process-pipe-distribution` | pg_net trigger | x-cron-secret |
| `webhook-confirmacao` | externo | apikey |

### communication (18) — chat, WhatsApp, Meta, SZChat

| Função | Trigger | Auth |
|--------|---------|------|
| `blast-plan-create` | UI | JWT (no role gate, ADR-0003) |
| `blast-plan-release` | pg_cron diário | x-cron-secret |
| `history-sync-worker` | pg_cron | x-cron-secret |
| `mass-send-control` | UI admin | JWT admin/master |
| `mass-send-create` | UI admin | JWT admin/master |
| `mass-send-status` | UI / pg_cron | JWT / x-cron-secret |
| `meta-conversation-profile` | UI | JWT |
| `meta-webhook` | Meta inbound | HMAC SHA256 |
| `process-scheduled-user-messages` | pg_cron | x-cron-secret |
| `send-meta-message` | UI | JWT |
| `stream-media` | `<audio>` / fetch | token in URL |
| `summarize-conversation` | UI / agent | JWT internal |
| `sz-chat-send` | internal | service_role |
| `sz-chat-webhook` | SZChat inbound | x-webhook-secret |
| `whatsapp-api-proxy` | UI / internal | JWT + tenant + rate limit |
| `whatsapp-dlq-replay` | pg_cron 5min | x-cron-secret |
| `whatsapp-health-monitor` | pg_cron 5min | x-cron-secret |
| `whatsapp-media-retry` | pg_cron 2min | x-cron-secret |
| `whatsapp-rebind-webhook` | pg_cron / admin | x-cron-secret / service_role |
| `whatsapp-session-watchdog` | pg_cron 10min | x-cron-secret |
| `whatsapp-webhook` | Uazapi inbound 🔴 | secret in path |

🔴 **Áreas frágeis** comm: `whatsapp-webhook`, `whatsapp-api-proxy`, `agent-message` (copilot BC mas hop por comm).

### copilot (18) — agents IA, RAG, geração de contexto

| Função | Trigger | Auth |
|--------|---------|------|
| `agent-message` | comm hop / pg_net 🔴 | x-cron-secret / internal |
| `analyze-copilot-prompt` | UI | JWT |
| `copilot-batch-processor` | pg_net trigger | x-cron-secret |
| `evaluate-agent-conversation` | pg_cron | x-cron-secret |
| `generate-agent-examples` | UI | JWT |
| `generate-business-context` | UI | JWT |
| `generate-custom-instructions` | UI | JWT |
| `generate-faq-embeddings` | UI / pg_cron | x-cron-secret / JWT |
| `generate-faqs` | UI | JWT |
| `oraculo-comercial` | UI | apikey + internal |
| `outbound-trigger` | pg_net | x-cron-secret |
| `process-agent-document` | upload | JWT |
| `process-ai-actions` | pg_cron | x-cron-secret |
| `process-copilot-followups` | pg_cron | x-cron-secret |
| `reembed-all` | admin script | service_role |
| `semi-automatic-dispatch` | UI / pg_cron | JWT / x-cron-secret |
| `suggest-retention-action` | UI | JWT |
| `test-copilot-chat` | UI dev | JWT |

🔴 **Área frágil**: `agent-message` (turn principal copilot).

### workflows (4) — DAG executor

| Função | Trigger | Auth |
|--------|---------|------|
| `get-automation-jobs` | UI | JWT |
| `process-workflow-executions` | pg_cron + pg_net | x-cron-secret |
| `test-workflow-system` | UI dev | JWT |
| `webhook-orchestrator` | pg_net / externo | apikey |

### campaigns (1) — campanhas + mass send rules

| Função | Trigger | Auth |
|--------|---------|------|
| `campaign-rule-dispatch` | pg_cron | x-cron-secret |

Mass send (`mass-send-*`) listadas em communication — UI invoca via JWT, despacha via WhatsApp proxy. Decisão futura: mover pra campaigns ou manter comm.

### carteira (11) — portfolio + upsell + TinyERP

| Função | Trigger | Auth |
|--------|---------|------|
| `calculate-portfolio-health` | pg_cron | x-cron-secret |
| `carteira-bulk-message` | UI admin | JWT |
| `erp-order-webhook` | ERP externo | x-webhook-secret |
| `tinyerp-connect` | UI | JWT |
| `tinyerp-disconnect` | UI | JWT |
| `tinyerp-fetch-nfe` | webhook + frontend | service_role |
| `tinyerp-proxy` | UI | JWT internal |
| `tinyerp-push-order` | trigger interno | JWT internal |
| `tinyerp-push-upsell-order` | trigger interno | JWT internal |
| `tinyerp-sync-products` | UI / pg_cron | JWT / x-cron-secret |
| `tinyerp-webhook` | TinyERP externo | apikey |

### engagement (3) — follow-ups, calendário, meetings

| Função | Trigger | Auth |
|--------|---------|------|
| `meeting-webhook` | API pública | Bearer (`tq_live_xxxx`) |
| `process-followup-automations` | pg_cron | x-cron-secret |
| `webhook-calcom` | Cal.com externo | apikey |

### analytics (1) — meta ads metrics

| Função | Trigger | Auth |
|--------|---------|------|
| `meta-ads-insights` | UI / pg_cron | JWT / x-cron-secret |

### billing (declarado-only, 3) — checkout + Asaas

Funções declaradas em `config.toml` mas SEM código local — deployadas direto na prod, ou removidas. Reconciliar em projeto separado.

| Função | Estado |
|--------|--------|
| `asaas-webhook` | config.toml only |
| `checkout-create-payment` | config.toml only |
| `checkout-provision-org` | config.toml only |

### marketing (1) — lead forms

| Função | Trigger | Auth |
|--------|---------|------|
| `list-lead-forms` | UI | JWT |

### integrations (8) — providers (Google Calendar, ElevenLabs, Meta OAuth)

| Função | Trigger | Auth |
|--------|---------|------|
| `elevenlabs-proxy` | UI | JWT admin |
| `google-calendar-callback` | OAuth redirect | JWT internal |
| `google-calendar-connect` | UI | JWT |
| `google-calendar-disconnect` | UI | JWT |
| `google-calendar-events` | UI | JWT |
| `google-calendar-sharing` | UI | JWT |
| `google-calendar-webhook` | Google push | internal |
| `meta-oauth-callback` | OAuth redirect | code + state |
| `refresh-meta-tokens` | pg_cron | x-cron-secret |

### platform (10) — observability, dead letter, infra

| Função | Trigger | Auth |
|--------|---------|------|
| `check-api-health` | UI dashboard | JWT |
| `cron-health-check` | pg_cron 5min | x-cron-secret |
| `onboarding-advance` | UI / pg_net | JWT / internal |
| `process-outbound-dispatches` | pg_cron | x-cron-secret |
| `process-webhook-deliveries` | pg_cron | x-cron-secret |
| `reprocess-job` | UI admin | JWT admin |
| `retry-dead-letter-jobs` | pg_cron | x-cron-secret |
| `webhook-send-test` | UI dev (deletar candidato) | JWT |
| `webhook-validate-url` | UI workflow | JWT |

## Para subagent que tocar uma função

1. Identifique o BC dono na tabela acima
2. Compartilhe via `supabase/functions/_shared/<bc>/<modulo>.ts` quando código for usado por 2+ funções do mesmo BC
3. `_shared/core/` reservado a cors, response, error-boundary, supabase-admin, security-headers, edge-framework, logger (slice 16 separa)
4. Atualize esta tabela se mover função entre BCs ou adicionar nova

## Discrepâncias config.toml × disco

3 funções declaradas em `config.toml` sem código local:
- `asaas-webhook` (linha 184)
- `checkout-create-payment` (linha 175)
- `checkout-provision-org` (linha 179)

Hipóteses: deploy-only (código existe no projeto Supabase remoto sem versionamento local) ou config legacy não-limpada. Auditar antes de slice 17.

## Rename futuro

Quando: pós-modularização frontend completa (slices 16-20 done) + janela de manutenção alocada.

Como (rascunho):
1. Cada função renomeada = path BC-prefixado (`identity-create-org-user` etc.) ou pasta BC + função (impossível com Supabase CLI hoje — exigiria refactor do CLI).
2. Dual-name window: deploy nova função, registrar webhooks/cron na nova, manter antiga 30 dias, deletar.
3. Coordenação multi-provider: reregistrar webhooks Meta, Uazapi, TinyERP, Asaas, SZChat, ERP, Cal.com.
4. Migrations atualizam pg_cron + pg_net URLs.
5. Frontend redeploy com novos `.invoke()` names.

Não escopo desta slice. Documentar quando virar projeto.

## Refs

- Sub-CLAUDE.md críticos:
  - `supabase/functions/agent-message/CLAUDE.md`
  - `supabase/functions/whatsapp-webhook/CLAUDE.md`
  - `supabase/functions/_shared/CLAUDE.md`
- SPEC modularização: `.specs/features/modularizacao/SPEC.md` slice 15
- Padrão edge function: ver `CLAUDE.md` raiz (Deno.serve + withErrorBoundary + withSecurityHeaders + getCorsHeaders + OPTIONS early return)
