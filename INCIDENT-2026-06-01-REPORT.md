# Incidente de Segurança 2026-06-01 — Vazamento cross-tenant (views + RPCs + webhooks)

**Projeto:** Torque CRM produção (`jsjsmuncfkbsbzqzqhfq`) · **Status:** CONTIDO

> Este incidente foi tratado por duas frentes paralelas. Esta nota cobre **views, RPCs
> (lado autenticado) e webhooks**. O **lado anônimo** (policies `{public} USING(true)` em
> conversations/messages, REVOKE anon em tabelas e RPCs, `suggest-retention-action`) está no
> commit `1a388933` / migration `20260601130000_security_fix_anon_conversation_leak.sql`.

## Como começou
Um dev de uma org cliente ("Dna de Almas"), com a conta admin legítima `dnadealmas@gmail.com`,
demonstrou leitura de dados de outras orgs. Evidências (prints/vídeo) confirmaram dumps de
pipelines, notas e contatos de múltiplos tenants.

## Causa raiz (3 classes)
1. **Views sem `security_invoker`** (`pipe_whatsapp/confirmacao/propostas`, `*_compat`,
   `leads_compat`, `unified_inbox_messages`, ...): rodavam como dono `postgres` → bypassavam RLS.
2. **RPCs `SECURITY DEFINER` sem guard de org**: recebiam `p_org_id` e não checavam membership →
   qualquer autenticado lia o comercial de qualquer org.
3. **Webhooks com bypass de auth** (`webhook-new-lead`, `webhook-confirmacao`): "janela de graça"
   aceitava request sem API key e resolvia org do body → injeção anônima cross-tenant.

## Escopo (verificado no prod, impersonando a conta atacante)
- View `pipe_whatsapp`: 7.587 linhas / **36 orgs** (esperado 15 / 1).
- `leads_compat` (ANÔNIMO): **14.452 leads / 41 orgs** (nome, email, telefone, faturamento, notas).
- RPCs: dna de almas puxou da Milennials `get_dashboard_metrics` (MRR R$203.349),
  `get_analytics_financial_metrics` (MRR R$160.463), `get_mkt_origin_metrics` (R$94.684, 762 leads),
  funil, vendedores, produtos.
- **LGPD**: 41 orgs com dados expostos. Totais: 14.536 leads · 10.982 mensagens · 15.057 pipeline entries.

## Forense
- Logins da conta dna de almas ("Bruno") em 2026-06-01: **`179.87.181.180`** (13:11) e
  **`200.188.241.40`** (13:30/logout 13:41), residenciais BR. (`54.20.61.162`/`18.228.221.58` = AWS
  em `/admin/users`, backend.) `206.0.95.88` = egress de dev/teste compartilhado, NÃO o atacante.
- Retenção de logs via API ≈ 24h. SELECT não loga linha → exposição assumida = total acessível.

## Remediação aplicada no prod (+ versionada)
- **Views** (`20261114000000_fix_view_rls_bypass_security_invoker.sql`): `security_invoker=on` nas 7
  views vivas + REVOKE anon + DROP das 3 `*_compat` órfãs. Pós-fix: anon → `permission denied`;
  logado → só a própria org.
- **RPCs** (`20261114000001_guard_definer_analytics_rpcs.sql`): helper `assert_org_access(p_org_id)`
  = service_role OU master OU membro, no topo de 10 RPCs analytics/dashboard + `create_lead_with_pipe`;
  `get_operations_overview`/`get_usage_by_org` gated por `is_master_user()`. Pós-fix verificado:
  não-membro → `access_denied`; membro/master → dados normais.
- **Webhooks** (código): `webhook-new-lead` + `webhook-confirmacao` fail-closed (sem chave = 401;
  org só da API key). Tráfego 48h = 0 (ingestão real usa `lead-webhook`) → deploy risco ~zero.
  **Pendente deploy manual**: `supabase functions deploy webhook-new-lead webhook-confirmacao --project-ref jsjsmuncfkbsbzqzqhfq`.

## Pendências (não corrigidas)
- **Buckets `media`/`help-media` públicos** com PII de WhatsApp — fix exige signed URLs (flipar quebra `<img>`).
- `lead-webhook`/`webhook-orchestrator` (HIGH): confiam em org do body com chave global compartilhada.
- `get_lead/user_write_instance` (LOW): instância WhatsApp sem checar caller.
- `erp-order-webhook`/`tinyerp-webhook` (MED): verificação de secret fail-OPEN sem env.
- `product_variants` (HIGH): policy FOR ALL admin sem escopo de org.
- **Não-técnico**: notificação ANPD/titulares; suspender conta/IPs do atacante; reconciliar drift dev↔prod;
  assert de CI (toda view tenant com `security_invoker=on`).

## Apêndice — acesso prod p/ auditoria
MCP Supabase só alcança dev. Prod via Management API com token do CLI:
`security find-generic-password -s "Supabase CLI" -w` → strip `go-keyring-base64:` → `base64 -D` →
`sbp_...` → `POST https://api.supabase.com/v1/projects/<ref>/database/query`. Logs: `.../analytics/endpoints/logs.all`.
