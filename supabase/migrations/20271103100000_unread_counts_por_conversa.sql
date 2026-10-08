-- ============================================================================
-- get_unread_counts: custo proporcional às conversas, não ao volume de mensagens
-- ============================================================================
--
-- ⚠️ VERSÃO PROVISÓRIA. O ledger de prod colide com frequência (memória
-- colisao-de-ledger-e-o-normal-agora): renumerar NA HORA de aplicar.
--
-- ─── O INCIDENTE ────────────────────────────────────────────────────────────
--
-- Prod caiu em 2026-10-02 12:46 UTC (`too many clients` às 12:40, crash
-- recovery até 12:48, restart 12:50). No ranking do auto_explain (>10 s) entre
-- 11:30 e 15:10, `get_unread_total` aparece 13 vezes — 14.257 ms com 16 caixas.
-- Ela é `sum()` sobre esta função, e o front a chamava a cada 60 s em TODA tela.
--
-- ─── O DEFEITO (medido, EXPLAIN em prod) ────────────────────────────────────
--
-- `organization_id IN (SELECT get_my_organization_ids())` virava HASH JOIN, e
-- com isso `organization_id` — a 1ª coluna de `idx_whatsapp_msgs_unread_cover`
-- (organization_id, instance_id, timestamp DESC) — saía da condição de índice.
-- Sobrava `instance_id = ANY(...) AND timestamp > now()-30d` sobre colunas que
-- NÃO são prefixo: o Postgres varria o índice parcial INTEIRO, de todas as
-- orgs, a cada chamada, e ainda montava a chave concatenada
-- 'whatsapp:'||instance||':'||phone POR MENSAGEM para casar o read-state.
--   - 16 caixas (Alamaster, admin):  ~6,7 s de parede sob carga (14,3 s no log)
--   - 57 caixas (Alamaster, admin):  > 20 s — estourou o statement_timeout
--
-- ─── A REESCRITA ────────────────────────────────────────────────────────────
--
-- O limiar de uma conversa é greatest(now()-30d, COALESCE(last_read_at,
-- now()-7d)). Isso parte o problema em dois conjuntos DISJUNTOS:
--
--   `fresh` — conversas SEM read-state: limiar = now()-7d. Index-only scan no
--      índice de cobertura, parametrizado por (org, caixa) — o LATERAL com
--      GROUP BY não é achatável, então o planner não tem como voltar à
--      varredura global. Lê só 7 dias, e quase tudo que lê é contado: numa
--      conversa nunca aberta, toda incoming da semana É não-lida.
--   `seen`  — conversas COM read-state do usuário: uma sonda por conversa em
--      `idx_whatsapp_msgs_org_phone_instance_ts`, já limitada a
--      `timestamp > limiar`. Custa o que há de NÃO-LIDO, não o histórico.
--
-- O read-state é resolvido UMA vez (CTE `rs`, só as linhas do usuário), com a
-- chave casada por prefixo de tamanho fixo ('whatsapp:' + uuid + ':' = 46
-- chars) em vez de concatenar por mensagem. `rs` é único por (org, caixa,
-- telefone) por construção: `conversation_read_state_unique_per_user_conversation`.
--
-- Medido em prod (EXPLAIN ANALYZE, transação read-only, como o usuário real):
--   - 57 caixas, admin Alamaster:  > 20 s (timeout)  →  109 ms quente
--     (generic plan, como roda dentro da função: 118 ms)
--   - 16 caixas, admin Alamaster:  ~6,7 s            →  44 ms
--
-- ─── SEMÂNTICA: IDÊNTICA ────────────────────────────────────────────────────
--
-- Mesmas colunas, mesmos números, inclusive o ramo `marked_unread` (copiado
-- literalmente) e o grupo de `normalized_phone` NULL (cai em `fresh`, nunca
-- casa read-state — como na original). Provado com md5 do conjunto ordenado,
-- função viva × corpo novo, mesma transação read-only, mesmo usuário:
--   - admin Alamaster, 16 caixas:            359 linhas, md5 79c231de… — iguais
--   - usuário com 1.185 read-states e 3 `marked_unread`, 1 caixa: 7 linhas, md5 3246a14a… — iguais
--   - usuário com 243 read-states e 2 `marked_unread`, 6 caixas: 364 linhas, md5 b3745cf9… — iguais
--
-- Corpo de partida: pg_get_functiondef de PROD (2026-10-02), não o do repo.
-- SECURITY DEFINER, search_path '', gate por get_my_organization_ids() e
-- assinatura preservados. CREATE OR REPLACE preserva grants; reafirmados abaixo
-- de forma idempotente (estado de prod: authenticated + service_role, sem
-- PUBLIC/anon). `get_unread_total` (sum sobre esta) não muda.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_instance_ids uuid[])
RETURNS TABLE(instance_id uuid, normalized_phone text, unread integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
-- (org, caixa) pedidas que a pessoa alcança. O gate de org é este produto:
-- caixa de org alheia não forma par com nenhuma org do usuário.
WITH scope AS (
  SELECT DISTINCT o.org_id, x.inst, x.inst::text AS inst_txt
  FROM public.get_my_organization_ids() AS o(org_id)
  CROSS JOIN unnest(p_instance_ids) AS x(inst)
  WHERE x.inst IS NOT NULL
),
rs AS (
  SELECT s.org_id, s.inst,
         substr(r.conversation_key, 47) AS np,
         r.last_read_at
  FROM public.conversation_read_state r
  JOIN scope s
    ON s.org_id = r.organization_id
   AND left(r.conversation_key, 46) = 'whatsapp:' || s.inst_txt || ':'
  WHERE r.user_id = auth.uid()
),
fresh AS (
  SELECT s.inst AS instance_id, f.normalized_phone, f.unread
  FROM scope s
  CROSS JOIN LATERAL (
    SELECT m.normalized_phone, count(*)::int AS unread
    FROM public.whatsapp_messages m
    WHERE m.organization_id = s.org_id
      AND m.instance_id = s.inst
      AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
      AND m."timestamp" > now() - interval '7 days'
    GROUP BY m.normalized_phone
  ) f
  WHERE NOT EXISTS (
    SELECT 1 FROM rs
    WHERE rs.org_id = s.org_id
      AND rs.inst = s.inst
      AND rs.np = f.normalized_phone)
),
seen AS (
  SELECT rs.inst AS instance_id, rs.np AS normalized_phone, c.unread
  FROM rs
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS unread
    FROM public.whatsapp_messages m
    WHERE m.organization_id = rs.org_id
      AND m.normalized_phone = rs.np
      AND m.instance_id = rs.inst
      AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
  ) c
  WHERE c.unread > 0
),
natural_unread AS (
  SELECT u.instance_id, u.normalized_phone, sum(u.unread)::int AS unread
  FROM (SELECT * FROM fresh UNION ALL SELECT * FROM seen) u
  GROUP BY u.instance_id, u.normalized_phone
),
combined AS (
  SELECT * FROM natural_unread
  UNION ALL
  SELECT i.id, split_part(r.conversation_key, ':', 3), 1
  FROM public.conversation_read_state r
  JOIN public.whatsapp_instances i
    ON r.conversation_key LIKE 'whatsapp:' || i.id::text || ':%'
   AND i.organization_id = r.organization_id
  WHERE r.user_id = auth.uid() AND r.marked_unread
    AND r.organization_id IN (SELECT public.get_my_organization_ids())
    AND i.id = ANY(p_instance_ids)
)
SELECT c.instance_id, c.normalized_phone, max(c.unread)::integer AS unread
FROM combined c
GROUP BY c.instance_id, c.normalized_phone
;
$function$;

REVOKE ALL ON FUNCTION public.get_unread_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_counts(uuid[]) TO authenticated, service_role;
