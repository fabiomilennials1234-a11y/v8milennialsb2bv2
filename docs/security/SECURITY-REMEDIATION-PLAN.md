# Security Remediation Plan — Torque CRM

**Data da auditoria:** 2026-05-15
**Status:** Sistema sob ataque ativo
**Autor:** Auditoria automatizada (Claude Code)
**Total de findings:** 44 (14 criticos, 18 altos, 12 medios)

---

## Wave 0 — EMERGENCIA (mesmo dia)

> Vetores de ataque exploraveis agora, sem autenticacao ou com bypass trivial.
> Objetivo: fechar as portas abertas em horas.

### W0-1: Migration emergencial — RLS policies sem `TO service_role`

- **Severidade:** CRITICO
- **Impacto:** Qualquer usuario autenticado le/escreve/deleta dados de TODAS as orgs
- **Tabelas afetadas:**
  - `conversations` — `20260126000000_add_agent_capabilities_and_conversations.sql:149`
  - `conversation_messages` — `20260126000000_add_agent_capabilities_and_conversations.sql:174`
  - `agent_decision_logs` — `20260126000000_add_agent_capabilities_and_conversations.sql:195`
  - `conversation_summaries` — `20260127100001_create_conversation_summaries.sql:67`
  - `webhook_dead_letters` — `20260909000002_webhook_dead_letters.sql:34`
  - `outbound_dispatch_log` — `20260426000002_outbound_dispatch_log_guarantee.sql:74`
  - `system_alerts` — `20260426010000_onda2_visibility_schema.sql:40`
  - `audit_log` — `20260426010000_onda2_visibility_schema.sql:96`
  - `workflow_executions` — `20260802000000_workflow_executor_infrastructure.sql:390`
  - `workflow_execution_steps` — `20260802000000_workflow_executor_infrastructure.sql:403`
- **Fix:** Nova migration que DROP cada policy e recria com `TO service_role`
- **Verificacao:** Tentar SELECT/INSERT com user autenticado de org diferente — deve retornar 0 rows

### W0-2: Adicionar autenticacao nas edge functions expostas

- **Severidade:** CRITICO
- **Impacto:** Qualquer pessoa na internet acessa dados sem login
- **Funcoes afetadas:**
  - `calculate-lead-score/index.ts` — adicionar `x-cron-secret` (se cron-only) ou `requireAuth()` + org filter
  - `summarize-conversation/index.ts` — adicionar `requireAuth()` + verificar caller pertence a org do lead
  - `stream-media/index.ts` — adicionar JWT auth + verificar caller pertence a org da midia
  - `test-gemini-rag/` — DELETAR funcao inteira (funcao de teste, nao deveria existir em prod)
- **Verificacao:** Requests sem auth devem retornar 401

### W0-3: Fixar autenticacao quebrada do `oraculo-comercial`

- **Severidade:** CRITICO
- **Arquivo:** `supabase/functions/oraculo-comercial/index.ts:695-714`
- **Problema:** Auth fake — le `body._authHeader` mas nunca valida JWT. `organization_id` vem do body
- **Fix:** Substituir pseudo-auth por `requireAuth()`. Extrair org_id do JWT, nao do body
- **Verificacao:** Request com org_id de outra org deve retornar 403

### W0-4: Remover `default-api-key` fallback do webhook-orchestrator

- **Severidade:** CRITICO
- **Arquivo:** `supabase/functions/webhook-orchestrator/index.ts:44`
- **Fix:** Remover `|| "default-api-key"`. Fail closed se env nao setada
- **Verificacao:** Request com "default-api-key" deve retornar 401

### W0-5: Fixar `generate_api_key` — adicionar auth check

- **Severidade:** CRITICO
- **Arquivo:** `supabase/migrations/20260909000001_create_api_keys.sql:87-127`
- **Fix:** Adicionar check `is_admin_of_org(auth.uid(), p_org_id)` no inicio da funcao
- **Verificacao:** User de org A chamando `generate_api_key('org_B', ...)` deve dar erro

### W0-6: Setar `ALLOWED_ORIGINS` no Supabase

- **Severidade:** CRITICO
- **Arquivo:** `supabase/functions/_shared/cors.ts:13`
- **Fix:** Configurar env `ALLOWED_ORIGINS=https://torquecrm.com.br,https://app.torquecrm.com.br` nos secrets do Supabase (prod e dev)
- **Verificacao:** Request de origin desconhecido deve ter CORS rejeitado

### W0-7: Remover chaves expostas no frontend

- **Severidade:** CRITICO
- **Arquivos:**
  - `.env.development:14` — remover `VITE_SUPABASE_SERVICE_ROLE_KEY` (rotacionar key no Supabase dashboard)
  - `Dockerfile:23`, `docker-compose.yml:15`, `.github/workflows/docker-image.yml:51` — remover `VITE_INTERNAL_API_KEY` de build args
- **Fix:** Rotacionar ambas as chaves. Mover pra secrets de edge function only
- **Verificacao:** `grep -r "VITE_SUPABASE_SERVICE_ROLE_KEY\|VITE_INTERNAL_API_KEY" .` deve retornar 0

### W0-8: Deletar funcoes obsoletas

- **Severidade:** CRITICO
- **Funcoes:**
  - `reconfigure-uazapi-webhooks/` — marcado "DELETE AFTER USE" no config.toml, le tokens de WhatsApp de todos os tenants
  - `test-gemini-rag/` — funcao de teste com service_role, zero auth
- **Fix:** Deletar diretorios + remover entradas do config.toml
- **Verificacao:** `ls supabase/functions/ | grep -E "reconfigure-uazapi|test-gemini"` deve retornar vazio

---

## Wave 1 — URGENTE (48 horas)

> Vulnerabilidades exploraveis com pouco esforco adicional.
> Objetivo: eliminar todos os vetores de acesso nao autorizado restantes.

### W1-1: Adicionar auth ao `import-leads`

- **Severidade:** ALTO
- **Arquivo:** `supabase/functions/import-leads/index.ts`
- **Problema:** Aceita anon key publica, qualquer um importa leads em qualquer org
- **Fix:** Adicionar `requireAuth()` + verificar user pertence a org

### W1-2: Adicionar org-scoping no `webhook-orchestrator`

- **Severidade:** ALTO
- **Arquivo:** `supabase/functions/webhook-orchestrator/index.ts:343,554`
- **Problema:** `handleScheduleMeeting` e `handleTransferHuman` operam cross-tenant
- **Fix:** Adicionar `.eq("organization_id", tenantId)` em todos os updates. Rejeitar quando `tenantId` null

### W1-3: Revogar `GRANT SELECT TO anon` nas pipe views

- **Severidade:** ALTO
- **Arquivo:** `supabase/migrations/20260984000000_fix_compat_views_stage_id.sql:357-359`
- **Fix:** `REVOKE SELECT ON pipe_whatsapp, pipe_confirmacao, pipe_propostas FROM anon`

### W1-4: Restringir `check_rate_limit`

- **Severidade:** ALTO
- **Arquivo:** `20260909200000_create_rate_limits.sql:83`
- **Fix:** Remover `anon` do GRANT. Adicionar verificacao de caller dentro da funcao

### W1-5: Fixar `get_jobs_overview`

- **Severidade:** ALTO
- **Arquivo:** `20260801000000_create_automation_jobs.sql:90-107`
- **Fix:** Adicionar guard `is_master_user()`. Restringir GRANT a `service_role`

### W1-6: Habilitar RLS em tabelas faltantes

- **Severidade:** ALTO
- **Tabelas:**
  - `exchange_rates` — `20260961000000_deal_enhancement.sql:118`
  - `_lead_duplicates_audit` — `20260130100000_lead_phone_centralization.sql:106`
- **Fix:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies adequadas

### W1-7: Padronizar validacao de cron secret

- **Severidade:** ALTO
- **Problema:** Funcoes cron tem patterns diferentes — algumas passam sem auth se env nao setada
- **Fix:** Extrair `requireCronAuth()` helper. Pattern unico: `if (!CRON_SECRET || cronSecret !== CRON_SECRET) return 401`
- **Funcoes:** Todas que checam `x-cron-secret`

### W1-8: Fixar comparacao de HMAC no meta-webhook

- **Severidade:** ALTO
- **Arquivo:** `supabase/functions/_shared/meta-api.ts:475`
- **Fix:** Trocar `===` por `crypto.subtle.timingSafeEqual()`

### W1-9: Fixar `sz-chat-webhook` — rejeitar quando sem secret

- **Severidade:** ALTO
- **Arquivo:** `supabase/functions/sz-chat-webhook/index.ts:815-823`
- **Fix:** Retornar 401 quando `webhook_secret` nao configurado (fail closed)

### W1-10: Fixar `validateEvolutionWebhook` — fail closed

- **Severidade:** ALTO (MEDIO no audit, promovido por padrao fail-open)
- **Arquivo:** `supabase/functions/_shared/auth.ts:32-34`
- **Fix:** `if (!expectedKey) return { valid: false }` em vez de `true`

### W1-11: Substituir `xlsx` por `exceljs`

- **Severidade:** ALTO
- **Arquivo:** `package.json:91`
- **Fix:** `npm uninstall xlsx && npm install exceljs`. Atualizar importers

### W1-12: `npm audit fix` + upgrade react-router-dom

- **Severidade:** ALTO
- **Fix:** `npm audit fix`, upgrade `react-router-dom >= 6.31.0`

---

## Wave 2 — HARDENING (1 semana)

> Fortalecimento de autenticacao, headers de seguranca, e higiene de codigo.
> Objetivo: eliminar vetores de ataque indiretos e defense-in-depth.

### W2-1: Adicionar CSP e HSTS

- **Severidade:** CRITICO (downgraded para wave 2 por nao ser diretamente exploravel sozinho)
- **Arquivos:**
  - Nginx config no Dockerfile — adicionar `Strict-Transport-Security` e `Content-Security-Policy`
  - `supabase/functions/_shared/security-headers.ts` — adicionar mesmos headers
- **CSP sugerido:** `default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none';`

### W2-2: Aumentar requisitos de senha

- **Severidade:** ALTO
- **Arquivos:** `Auth.tsx:379`, `ResetPassword.tsx:55`, `admin-reset-user-password/index.ts:93`
- **Fix:** Minimo 12 chars, 1 maiuscula, 1 numero, 1 especial. Configurar tambem no Supabase Dashboard

### W2-3: Implementar MFA/2FA

- **Severidade:** ALTO
- **Fix:** Supabase MFA (TOTP) obrigatorio pra admin/master. `supabase.auth.mfa.enroll()` + `verify()`

### W2-4: Habilitar email confirmation

- **Severidade:** ALTO
- **Arquivo:** `supabase/config.toml:6`
- **Fix:** `enable_confirmations = true`

### W2-5: Desabilitar signup publico

- **Severidade:** ALTO
- **Fix:** `disable_signup = true` no config.toml. Provisionar users via `create-org-user` only

### W2-6: Adicionar `SET search_path = public` em SECURITY DEFINER functions

- **Severidade:** ALTO
- **Arquivos:** 10+ funcoes em multiplas migrations
- **Fix:** Nova migration alterando todas as funcoes afetadas

### W2-7: Adicionar `withSecurityHeaders` nas 42 funcoes faltantes

- **Severidade:** ALTO
- **Fix:** Aplicar wrapper em todas as funcoes ou mover pra middleware global no Sentry wrapper

### W2-8: Fixar `authHeader.includes()` — usar comparacao exata

- **Severidade:** ALTO
- **Arquivos:** `cron-health-check`, `process-workflow-executions`, `test-workflow-system`
- **Fix:** `authHeader === \`Bearer ${SERVICE_ROLE_KEY}\``

### W2-9: Fixar DOMPurify config no EmailThreadView

- **Severidade:** ALTO
- **Arquivo:** `src/components/email/EmailThreadView.tsx:118`
- **Fix:** Adicionar `ALLOWED_TAGS` whitelist, `FORBID_TAGS: ['form', 'input', 'style', 'iframe']`

### W2-10: Fixar todas as comparacoes timing-safe restantes

- **Severidade:** MEDIO
- **Arquivos:** `asaas-webhook/index.ts:514`, `lead-webhook/index.ts:83`
- **Fix:** `crypto.subtle.timingSafeEqual()` em todas as comparacoes de secrets

---

## Wave 3 — ENDURECIMENTO (2 semanas)

> Melhorias de defense-in-depth e higiene operacional.
> Objetivo: reduzir superficie de ataque e melhorar monitoramento.

### W3-1: Restringir cross-tenant visibility

- **Severidade:** MEDIO
- **Tabelas:**
  - `team_members` — SELECT `USING(true)` → filtrar por org
  - `profiles` — SELECT `USING(true)` → filtrar por org
  - `tags` — SELECT `USING(true)` → filtrar por org
- **Fix:** Migration com policies que filtram `organization_id` via `auth.uid()` join `team_members`

### W3-2: Endurecer `WITH CHECK` em UPDATE policies

- **Severidade:** MEDIO
- **Tabelas:** `pipe_propostas`, `pipe_whatsapp`, `pipe_confirmacao`
- **Fix:** `WITH CHECK` deve verificar que `organization_id` nao mudou (mirror do USING)

### W3-3: Docker — rodar como non-root

- **Severidade:** MEDIO
- **Arquivo:** Dockerfile
- **Fix:** Adicionar `USER nginx` ou criar user dedicado

### W3-4: Migrar rate limiting pra persistent

- **Severidade:** MEDIO
- **Problema:** Rate limiting in-memory reseta em cold start
- **Fix:** Migrar endpoints criticos pra `checkRateLimitPersistent()` (ja existe no codebase)

### W3-5: Adicionar Dependabot + npm audit no CI

- **Severidade:** MEDIO
- **Fix:**
  - Criar `.github/dependabot.yml` pra npm
  - Adicionar step `npm audit --audit-level=high` no CI workflow

### W3-6: Fixar user enumeration no signup

- **Severidade:** MEDIO
- **Arquivo:** `src/pages/Signup.tsx:153-155`
- **Fix:** Mensagem generica. Habilitar leak-resistant auth no Supabase Dashboard

### W3-7: Adicionar `rel="noopener noreferrer"` nos links externos

- **Severidade:** MEDIO
- **Arquivos:** 14 instancias em multiplos componentes
- **Fix:** Adicionar atributo + lint rule `react/jsx-no-target-blank`

### W3-8: Deletar funcoes legacy Evolution API

- **Severidade:** BAIXO
- **Diretorios:** `evolution-api-proxy/`, `evolution-webhook/`
- **Fix:** Deletar + confirmar que nao estao no config.toml

### W3-9: Fixar sanitization ordering em validation.ts

- **Severidade:** BAIXO
- **Arquivo:** `supabase/functions/_shared/validation.ts:52-87`
- **Fix:** Rodar stripping de protocol/event handlers ANTES do HTML encoding

### W3-10: Fixar `timingSafeEqual` length leak

- **Severidade:** BAIXO
- **Arquivo:** `supabase/functions/whatsapp-webhook/index.ts:77`
- **Fix:** Pad strings pro mesmo tamanho antes de comparar

---

## Checklist de validacao pos-remediacao

- [ ] Pentest cross-tenant: user org A nao acessa dados org B (queries, RPCs, edge functions)
- [ ] Pentest unauth: requests sem auth retornam 401 em TODAS as edge functions (exceto webhooks publicos com secret)
- [ ] `npm audit` retorna 0 HIGH/CRITICAL
- [ ] `grep -r "VITE_.*SERVICE_ROLE\|VITE_.*INTERNAL.*KEY" .` retorna 0
- [ ] CORS: request de origin desconhecido rejeitado
- [ ] CSP: inline script bloqueado pelo browser
- [ ] HSTS: HTTP redirecta pra HTTPS
- [ ] MFA ativo pra todos os admin/master
- [ ] Signup publico desabilitado
- [ ] Email confirmation habilitado
- [ ] Password policy: minimo 12 chars + complexidade

---

## Metricas de progresso

| Wave | Items | Estimativa | Status | Commit |
|------|-------|-----------|--------|--------|
| Wave 0 | 8/8 | Mesmo dia | FEITO | `b8c5647f` |
| Wave 1 | 12/12 | 48h | FEITO | `a4b6de63` |
| Wave 2 | 8/10 | 1 semana | FEITO | `a75334f4` |
| Wave 3 | 9/10 | 2 semanas | FEITO | `7be8550a` |

### Producao (2026-05-15)

- Migrations W0-W2: aplicadas via `supabase db query --linked`
- Migration W3 (cross-tenant): aplicada via SQL direto (team_members, profiles, tags hardened)
- W3-2 (pipe_propostas): SKIP — pipe_propostas e VIEW, nao tabela. Seguranca herdada das tabelas base via RLS
- W2-6 (fire_workflow_trigger): prod tem 5 params, migration corrigida para assinatura correta
- Edge functions: todas deployadas via `supabase functions deploy`
- Funcoes deletadas (test-gemini-rag, reconfigure-uazapi-webhooks): confirmado ausentes no deploy

### Items pendentes (decisoes de produto)

- **W2-3 (MFA/2FA)**: Requer implementacao de flow de enrollment no frontend + decisao sobre obrigatoriedade
- **W2-5 (Desabilitar signup publico)**: Requer confirmar que provisioning via create-org-user cobre todos os cenarios
- **W3-7 (rel=noopener)**: Ja estava correto — todos os links externos ja tinham o atributo
