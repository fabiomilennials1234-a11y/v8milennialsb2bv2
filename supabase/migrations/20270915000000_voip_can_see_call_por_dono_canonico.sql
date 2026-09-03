-- 20270915000000_voip_can_see_call_por_dono_canonico.sql
--
-- `voip_can_see_call` — a fronteira do lead na leitura de `voip_calls` — passa
-- a olhar o DONO CANÔNICO do lead.
--
-- ── O QUE MUDA ────────────────────────────────────────────────────────────
-- Um único termo: `can_see_lead_by_permissions(l.sdr_id, l.closer_id)` vira
-- `can_see_lead_by_permissions(l.pre_sale_responsible_id, l.sale_responsible_id)`.
-- Tudo o mais fica: `p_lead_id IS NULL → true` (ligação de número sem cadastro
-- é fato da organização, ADR-0027), `COALESCE(…, false)` (lead inexistente não
-- abre nada), STABLE, SECURITY DEFINER, `search_path = public`.
--
-- ── POR QUÊ ───────────────────────────────────────────────────────────────
-- O produto atribui dono só por `pre_sale_responsible_id` / `sale_responsible_id`.
-- `sdr_id`, `closer_id` e `responsible_id` são LEGADAS: espelho mantido por
-- trigger (`fn_sync_canonical_assignment`) e marcadas para drop no #755. A
-- função nasceu (20270730000000) lendo as legadas — e o espelho não é fiel:
-- medido em produção em 2026-09-02, 26 leads têm dono canônico e legado
-- divergentes, e neles quem é dono de verdade não lia a própria ligação.
--
-- Esta é a mesma correção que o plano de chamada recebeu no código no mesmo
-- dia (`_shared/voip/call-plane.ts`: o gate de dono legado saiu e a
-- autorização passou a ser "vê o lead sob a RLS de `leads` → pode ligar"). A
-- policy de `leads` já olha as canônicas via `is_user_responsible(pre_sale,
-- sale)`; esta função era o último lugar da voz preso às legadas.
--
-- ── OR REPLACE, NUNCA DROP + CREATE ───────────────────────────────────────
-- DROP reseta os grants para o default de `pg_default_acl` (EXECUTE para
-- PUBLIC/anon) — reincidência conhecida nesta base. A assinatura não muda, então
-- OR REPLACE preserva REVOKE de PUBLIC/anon e o GRANT a authenticated/service_role
-- feitos na 20270730000000. O pgTAP `voip_can_see_call_dono_canonico_test.sql`
-- afirma os grants depois desta migration.

CREATE OR REPLACE FUNCTION public.voip_can_see_call(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_lead_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT public.can_see_lead_by_permissions(l.pre_sale_responsible_id, l.sale_responsible_id)
         FROM public.leads l
        WHERE l.id = p_lead_id),
      false)
  END
$$;

COMMENT ON FUNCTION public.voip_can_see_call(uuid) IS
  'Fronteira do lead para linhas de chamada, pelo dono CANÔNICO '
  '(pre_sale_responsible_id/sale_responsible_id) desde 2026-09-02 — as colunas '
  'legadas sdr_id/closer_id são espelho por trigger e saem no #755. lead_id nulo '
  '(número desconhecido ligando) é visível para a org inteira, por decisão de '
  'produto: a chamada tem que ser atendível por quem está de plantão.';
