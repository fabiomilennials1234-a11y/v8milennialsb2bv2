-- 20270820160000_find_leads_no_reply_enxerga_canal_oficial.sql
--
-- #1693 — "Lead não respondeu" ignora respostas do canal oficial (épico #1684).
--
-- O defeito
-- ---------
-- `find_leads_no_reply` é a função que o cron `process-workflow-executions`
-- consulta para decidir quem não respondeu e, a partir daí, disparar o gatilho
-- `lead_no_reply`. Ela olhava UMA tabela — `whatsapp_messages`, o chip — e casava
-- a mensagem com o lead por `wm.lead_id`.
--
-- As mensagens do canal oficial (WhatsApp API via NotificaMe, e o Instagram)
-- vivem em `channel_messages`. Medido em produção em 2026-08-20: das 5.312
-- mensagens de ENTRADA do canal oficial de WhatsApp, 5.312 têm telefone e apenas
-- 3.521 têm `lead_id`. Ou seja: a resposta do cliente pelo número oficial era
-- invisível para esta função, e o cron seguia tratando quem respondeu como quem
-- sumiu — mandando cobrança automática a quem já tinha respondido.
--
-- O conserto
-- ----------
-- Uma segunda guarda `NOT EXISTS`, sobre `channel_messages`, ao lado da que já
-- existe sobre `whatsapp_messages`. A guarda do chip NÃO é tocada.
--
-- Chave de correspondência, por canal — quem decide a chave é o canal, não o
-- campo estar preenchido (mesmo invariante fixado no #1686 / PR #1694):
--   * `lead_id`  — qualquer canal. Conversa já vinculada a um lead conta como
--                  resposta daquele lead, inclusive no Instagram.
--   * telefone   — SÓ no canal `whatsapp`, e SÓ quando não há vínculo de lead.
--                  O Direct do Instagram não tem telefone (medido: 721 mensagens
--                  de entrada, 0 com telefone), e o identificador do Instagram
--                  tem 15 a 17 dígitos: aceitá-lo como telefone o faria casar
--                  com a base de leads.
--
-- A normalização é `normalize_br_mobile`, a MESMA que `resolve_wait_response_by_phone`
-- usa na perna de entrada. Contar a resposta com uma régua e destravar a espera
-- com outra faria as duas metades do mesmo evento discordarem.
--
-- Guarda de comprimento (10 a 13 dígitos) no lado da mensagem: em produção há 4
-- linhas cujo `phone_number` é um `@lid` do WhatsApp (14 e 16 dígitos), que não
-- é telefone. Sem o teto, a normalização os devolveria intactos e eles poderiam
-- casar por acidente.
--
-- Inércia para quem só usa chip
-- -----------------------------
-- A subconsulta é recortada por `cm.organization_id = p_organization_id`. Numa
-- organização sem nenhuma linha em `channel_messages` ela é vazia, o `NOT EXISTS`
-- é verdadeiro para todo lead, e o conjunto de candidatos é literalmente o mesmo.
-- Isso não é presunção: o ensaio transacional colado no PR roda a função ANTES e
-- DEPOIS, organização por organização, e prova conjunto idêntico onde não há
-- canal oficial.
--
-- Grants
-- ------
-- `CREATE OR REPLACE` preserva o ACL (só `DROP` + `CREATE` o reabriria para
-- PUBLIC/anon). O REVOKE/GRANT abaixo é cinto e suspensório: reafirma
-- explicitamente o estado medido em produção
-- (`{postgres=X/postgres,service_role=X/postgres}`), o mesmo que
-- 20270811000006_revoke_cross_tenant_rpc_surface_wave3_reads.sql estabeleceu.

CREATE OR REPLACE FUNCTION public.find_leads_no_reply(
  p_organization_id uuid,
  p_cutoff timestamp with time zone,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  -- Respostas do canal oficial na janela, materializadas UMA vez por chamada.
  -- Correlacionar `channel_messages` lead a lead faria a varredura por lead;
  -- aqui o conjunto é pequeno (só mensagens de entrada depois do corte).
  WITH official_reply AS MATERIALIZED (
    SELECT
      cm.lead_id,
      CASE
        WHEN cm.channel = 'whatsapp'
         AND cm.phone_number IS NOT NULL
         AND length(regexp_replace(cm.phone_number, '[^0-9]', '', 'g')) BETWEEN 10 AND 13
        THEN public.normalize_br_mobile(regexp_replace(cm.phone_number, '[^0-9]', '', 'g'))
      END AS phone_key
    FROM public.channel_messages cm
    WHERE cm.organization_id = p_organization_id
      AND cm.direction = 'incoming'
      AND cm.created_at > p_cutoff
  )
  SELECT DISTINCT l.id
  FROM public.leads l
  JOIN public.conversations c ON c.lead_id = l.id
  WHERE l.organization_id = p_organization_id
    AND c.last_message_at < p_cutoff
    AND c.last_message_at IS NOT NULL
    AND (l.ai_disabled IS NULL OR l.ai_disabled = false)
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_messages wm
      WHERE wm.lead_id = l.id
        AND wm.direction = 'incoming'
        AND wm.created_at > p_cutoff
    )
    AND NOT EXISTS (
      SELECT 1 FROM official_reply orp
      WHERE orp.lead_id = l.id
         OR (
              orp.lead_id IS NULL
              AND orp.phone_key IS NOT NULL
              AND l.phone_digits IS NOT NULL
              AND length(l.phone_digits) >= 10
              AND orp.phone_key = public.normalize_br_mobile(l.phone_digits)
            )
    )
  ORDER BY l.id
  LIMIT p_limit;
$function$;

REVOKE EXECUTE ON FUNCTION public.find_leads_no_reply(uuid, timestamp with time zone, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.find_leads_no_reply(uuid, timestamp with time zone, integer)
  TO service_role;

COMMENT ON FUNCTION public.find_leads_no_reply(uuid, timestamp with time zone, integer) IS
  'Candidatos ao gatilho lead_no_reply. Enxerga resposta do chip (whatsapp_messages, '
  'por lead_id) E do canal oficial (channel_messages: por lead_id em qualquer canal, '
  'por telefone normalizado apenas no canal whatsapp e apenas sem vínculo de lead). '
  'service_role only — #1693.';
