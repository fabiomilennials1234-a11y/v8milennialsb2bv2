-- 20270811000006_revoke_cross_tenant_rpc_surface_wave3_reads.sql
--
-- APLICADA EM PRODUÇÃO em 2026-08-11 com autorização do CTO. Terceira onda.
-- Ver 20270811000004 e ...005 para o mecanismo do vetor.
--
-- Esta onda fecha LEITURA cross-tenant — exfiltração, não sabotagem. Achada numa
-- varredura mais larga: o recorte das duas primeiras exigia que a função
-- ESCREVESSE (INSERT/UPDATE/DELETE no corpo), e por isso era CEGO para função que
-- só LÊ. Num CRM B2B, a carteira de leads é o ativo — ler a lista alheia é pior
-- que mexer nela.
--
-- TRÊS DEVOLVEM `phone_number` de lead de QUALQUER organização:
--   get_followup_eligible_leads     (lead_id, last_outgoing_at, phone_number)
--   get_leads_no_response_from_lead (lead_id, last_outgoing_at, phone_number)
--   get_leads_team_no_response      (lead_id, last_incoming_at, phone_number)
-- As outras:
--   find_leads_no_reply             (id) — enumera leads da vítima
--   get_leads_not_confirmed         (lead_id, meeting_date, confirmacao_id, status)
--   get_analytics_utm_metrics       (jsonb) — métricas de marketing da vítima
--   resolve_wait_response_by_phone  — irmão de resolve_wait_response, mesma forma
--
-- Todas SECURITY DEFINER de dono `postgres` (ignora RLS), recebendo
-- `organization_id` por parâmetro, sem gate, e executáveis por `authenticated` —
-- logo servidas pelo PostgREST a qualquer sessão logada.
--
-- POR QUE REVOGAR NÃO QUEBRA NADA, medido em produção:
--   * nenhuma é chamada pelo front — no `src/` só aparecem em `types.ts`, que é
--     gerado do schema e não é chamada;
--   * as que o backend usa são chamadas por edge function, com `service_role`:
--     `process-workflow-executions`, `process-followup-automations`,
--     `_shared/copilot/followup-situations`;
--   * ZERO chamadores internos no banco para todas — nada depende do grant de
--     `authenticated`.
--
-- `get_user_write_instance` fica FORA de propósito: resolve a instância de escrita
-- do usuário e merece leitura própria antes de mexer.
--
-- Mesmo limite das anteriores: contenção por grant. `DROP+CREATE` reabre. O
-- conserto durável é `_unchecked` service_role-only + wrapper que autoriza.

REVOKE EXECUTE ON FUNCTION public.find_leads_no_reply(uuid, timestamp with time zone, integer)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_followup_eligible_leads(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_leads_no_response_from_lead(uuid, integer, integer, text, text[])
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_leads_team_no_response(uuid, integer, integer, text, text[])
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_leads_not_confirmed(uuid, integer, integer, text[])
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_analytics_utm_metrics(uuid, date, date, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
