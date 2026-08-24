-- 20270825000010_comando_conversas_escopo_por_usuario.sql
--
-- "Aguardando resposta" (aba Comando) passa a ser a fila DO VENDEDOR.
--
-- ─── O que muda ──────────────────────────────────────────────────────────────
--
-- Antes: qualquer membro via a fila da ORG INTEIRA naquele chip, porque o
-- bloco de isolamento só liga quando `organizations.chat_restrict_to_owner` é
-- true — e ele é false em 28 das 30 orgs (medido no PROD em 2026-08-24: 2 orgs
-- com a flag ligada). Com a flag desligada o código fazia
-- `v_iso_bypass := true` e devolvia tudo.
--
-- Agora: quem não é admin da org recebe só o que é dele. Admin e master
-- continuam recebendo tudo, e ganham DUAS colunas novas para saber de quem é
-- cada conversa.
--
-- ─── A regra, em uma frase ───────────────────────────────────────────────────
--
--   "vejo o que é MEU + o que não é de NINGUÉM; nunca o de OUTRO."
--
-- O "+ o que não é de ninguém" não é generosidade, é medição: das 15.019
-- conversas com mensagem recebida nos últimos 30 dias no PROD, 4.737 (32%) não
-- têm lead nenhum e outras 1.197 (8%) têm lead sem responsável. Recortar só
-- por "é meu" apagaria 40% da fila de todo vendedor — esconderia trabalho real,
-- sem que ninguém percebesse. Registro órfão também não é "dado de outro
-- usuário", que é o que o pedido manda proteger.
--
-- ─── Por que NÃO tem parâmetro de escopo ─────────────────────────────────────
--
-- 🔒 Esta RPC é chamada de UM lugar só (`useConversasAguardando`, que só o
-- Comando consome — conferido por grep em 2026-08-24). Como não existe um
-- segundo consumidor que precise da visão ampla, o escopo é decidido AQUI
-- DENTRO, por `is_org_admin(p_org)`, e não viaja na requisição.
--
-- Isso é de propósito e é o ponto mais importante deste arquivo: **não existe
-- parâmetro para o cliente adulterar.** Trocar payload, refazer o fetch pelo
-- console ou chamar a RPC na mão devolve exatamente a mesma linha. É o que o
-- critério de aceite nº 11 pede, e é mais forte do que validar um parâmetro.
--
-- ⚠️ A LISTA DE ARGUMENTOS NÃO MUDA — `(p_org, p_instance, p_limit,
-- p_window_days)`, igual ao que está no PROD hoje. Só o RETURNS ganha colunas.
-- Consequência boa: o front antigo continua funcionando contra a função nova
-- (ignora as colunas a mais) e o front novo continua funcionando contra a
-- função antiga (as colunas chegam `undefined` e a UI não mostra o dono). Não
-- há ordem obrigatória entre aplicar esta migration e deployar o front, e
-- nenhum risco de `PGRST202` derrubar o card — que foi como a #1774 derrubou o
-- board inteiro por causa de um parâmetro novo.
--
-- ─── O que NÃO muda ──────────────────────────────────────────────────────────
--
-- O bloco `chat_restrict_to_owner` fica intacto, com os mesmos bypasses
-- (`is_master_user`, `is_user_admin`, override `leads.view_all`) e o mesmo
-- `leads.view_unassigned`. As duas regras compõem por AND: o escopo novo só
-- ESTREITA. Para as 2 orgs que já isolam, nada muda de comportamento.
-- O inbox (`/chat`) não é tocado — ele lê outra RPC.

DROP FUNCTION IF EXISTS public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer);

CREATE FUNCTION public.get_conversations_awaiting_human_reply(
  p_org          uuid,
  p_instance     uuid,
  p_limit        integer DEFAULT 10,
  p_window_days  integer DEFAULT 30
)
RETURNS TABLE(
  phone_number            text,
  normalized_phone        text,
  push_name               text,
  lead_id                 uuid,
  conversation_id         uuid,
  last_client_message     text,
  last_client_message_at  timestamp with time zone,
  ai_replied              boolean,
  ai_replied_at           timestamp with time zone,
  waiting_total           integer,
  -- ── colunas novas: quem é o dono da conversa ──────────────────────────────
  -- Só o admin vê isso na tela; para o vendedor a lista já é dele inteira.
  owner_team_member_id    uuid,
  owner_name              text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 10), 1), 200);
  v_days   integer := least(greatest(coalesce(p_window_days, 30), 1), 180);
  v_ids    uuid[];
  -- Isolamento por responsavel (#1629), resolvido UMA vez e nao por linha.
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
  -- Escopo do Comando (novo).
  v_me         uuid;
  v_admin      boolean;
  v_scope_mine boolean;
BEGIN
  -- Mesmo gate da RPC irma, com o mesmo endurecimento: `NOT (x IN (lista com
  -- NULL))` devolve NULL e `IF NULL THEN` nao dispara -- gate aberto em vez de
  -- erro. Por isso NOT EXISTS + COALESCE, e nao `NOT IN`.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  -- Chip = instancia viva + as ja apagadas do mesmo numero.
  v_ids := whatsapp_chip_instance_ids(p_org, p_instance);

  -- ── Escopo do Comando ─────────────────────────────────────────────────────
  -- Resolvido ANTES do isolamento porque o `v_me` serve aos dois.
  -- `v_me` e NULL para master (nao tem linha em team_members); por isso o
  -- recorte so liga quando NAO e admin -- master cai sempre no ramo "ve tudo",
  -- e nunca no ramo que filtraria por um id inexistente e devolveria vazio.
  v_me         := public.my_team_member_id(p_org);
  v_admin      := public.is_org_admin(p_org);
  v_scope_mine := NOT v_admin;

  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    v_iso_tm := v_me;

    v_iso_bypass :=
      public.is_master_user()
      OR public.is_user_admin()
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  RETURN QUERY
  WITH janela AS (
    SELECT m.normalized_phone AS np,
           max(m."timestamp") FILTER (WHERE m.direction = 'incoming') AS last_in,
           max(m."timestamp") FILTER (
             WHERE m.direction = 'outgoing' AND m.sent_source = 'manual'
           ) AS last_human_out,
           max(m."timestamp") FILTER (
             WHERE m.direction = 'outgoing' AND m.sent_source <> 'manual'
           ) AS last_ai_out
    FROM whatsapp_messages m
    WHERE m.organization_id = p_org
      AND m.instance_id = ANY(v_ids)
      AND m.deleted_at IS NULL
      -- Grupo saiu do produto (#1632) e e 40% das mensagens.
      AND m.is_group = false
      AND m.normalized_phone IS NOT NULL
      AND m."timestamp" > now() - make_interval(days => v_days)
    GROUP BY m.normalized_phone
  ),
  -- So as que esperam: o cliente falou e nenhum humano falou depois.
  esperando AS (
    SELECT j.np, j.last_in, j.last_ai_out
    FROM janela j
    WHERE j.last_in IS NOT NULL
      AND (j.last_human_out IS NULL OR j.last_in > j.last_human_out)
  ),
  -- Isolamento + escopo. Um EXISTS por conversa, contra `leads`, indexado por
  -- (organization_id, normalized_phone).
  visivel AS (
    SELECT e.np, e.last_in, e.last_ai_out
    FROM esperando e
    WHERE
      -- (1) Politica de isolamento da ORG. INALTERADA.
      (
        v_iso_bypass
        OR EXISTS (
             SELECT 1 FROM public.leads l
             WHERE l.organization_id  = p_org
               AND l.normalized_phone = e.np
               AND l.deleted_at IS NULL
               AND (
                 COALESCE(v_iso_tm IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id), false) -- metric-lint-allow: visibilidade por responsavel, nao atribuicao de receita — R5 nao se aplica
                 OR (
                   COALESCE(l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id) IS NULL -- metric-lint-allow: teste de "lead sem dono", nao soma por membro
                   AND v_iso_unassign
                 )
               )
           )
      )
      -- (2) Escopo do Comando. NOVO, e so ESTREITA.
      --
      -- Le-se: "guarde a linha, A NAO SER QUE exista um lead deste telefone
      -- que TENHA dono e esse dono NAO seja eu". Escrito na negativa de
      -- proposito -- e o jeito de deixar passar tanto o que e meu quanto o que
      -- nao e de ninguem, sem precisar de dois ramos.
      AND (
        NOT v_scope_mine
        OR NOT EXISTS (
             SELECT 1 FROM public.leads l2
             WHERE l2.organization_id  = p_org
               AND l2.normalized_phone = e.np
               AND l2.deleted_at IS NULL
               AND COALESCE(l2.pre_sale_responsible_id, l2.sale_responsible_id, l2.sdr_id, l2.closer_id) IS NOT NULL -- metric-lint-allow: teste de "lead tem dono", nao soma por membro
               AND NOT COALESCE(v_me IN (l2.pre_sale_responsible_id, l2.sale_responsible_id, l2.sdr_id, l2.closer_id), false) -- metric-lint-allow: visibilidade por responsavel, nao atribuicao de receita
           )
      )
  ),
  -- A thread pode ter sido arquivada/apagada pelo usuario: respeitar.
  conv AS (
    SELECT DISTINCT ON (c.normalized_phone)
           c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = ANY(v_ids)
      AND c.normalized_phone IS NOT NULL
    ORDER BY c.normalized_phone, (c.instance_id = p_instance) DESC,
             c.created_at DESC NULLS LAST, c.id
  ),
  elegivel AS (
    SELECT v.np, v.last_in, v.last_ai_out, cv.id AS conversation_id
    FROM visivel v
    LEFT JOIN conv cv ON cv.np = v.np
    WHERE cv.deleted_at IS NULL AND cv.archived_at IS NULL
  ),
  -- `waiting_total` viaja em toda linha: a tela precisa dizer "e mais N"
  -- sem uma segunda ida ao banco. Ja conta DEPOIS do recorte, entao o
  -- contador do card respeita a permissao -- que e o que o pedido exige.
  contado AS (
    SELECT el.*, count(*) OVER ()::integer AS total
    FROM elegivel el
  ),
  topo AS (
    SELECT c.* FROM contado c
    ORDER BY c.last_in DESC
    LIMIT v_limit
  )
  -- O TEXTO do cliente so agora, e so para as linhas que sobreviveram ao LIMIT.
  SELECT s.phone_number,
         t.np,
         s.last_push_name,
         s.lead_id,
         t.conversation_id,
         msg.content,
         t.last_in,
         (t.last_ai_out IS NOT NULL AND t.last_ai_out > t.last_in),
         CASE WHEN t.last_ai_out > t.last_in THEN t.last_ai_out END,
         t.total,
         dono.tm_id,
         tmo.name
  FROM topo t
  LEFT JOIN LATERAL (
    SELECT DISTINCT ON (x.normalized_phone) x.phone_number, x.last_push_name, x.lead_id
    FROM whatsapp_conversation_summary x
    WHERE x.organization_id = p_org
      AND x.instance_id = ANY(v_ids)
      AND x.normalized_phone = t.np
    ORDER BY x.normalized_phone, x.last_message_time DESC
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT w.content
    FROM whatsapp_messages w
    WHERE w.organization_id = p_org
      AND w.instance_id = ANY(v_ids)
      AND w.normalized_phone = t.np
      AND w.direction = 'incoming'
      AND w.deleted_at IS NULL
    ORDER BY w."timestamp" DESC
    LIMIT 1
  ) msg ON true
  -- O dono, so para as linhas que sobreviveram ao LIMIT (no maximo 200).
  -- A ordem do COALESCE e a MESMA do predicado de isolamento acima: o nome que
  -- aparece na tela e o mesmo que decide quem enxerga a linha. Duas ordens
  -- diferentes aqui produziriam um card que mostra "Ana" para uma conversa que
  -- some da lista da Ana.
  LEFT JOIN LATERAL (
    SELECT COALESCE(l3.pre_sale_responsible_id, l3.sale_responsible_id, l3.sdr_id, l3.closer_id) AS tm_id -- metric-lint-allow: rotulo de dono na UI, nao atribuicao de receita
    FROM public.leads l3
    WHERE l3.organization_id  = p_org
      AND l3.normalized_phone = t.np
      AND l3.deleted_at IS NULL
    LIMIT 1
  ) dono ON true
  LEFT JOIN public.team_members tmo ON tmo.id = dono.tm_id
  ORDER BY t.last_in DESC;
END;
$function$;

COMMENT ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) IS
  'Fila do card "Aguardando resposta" do Comando. Recorte por usuario decidido '
  'DENTRO da funcao (is_org_admin): nao-admin recebe so o que e dele ou nao e '
  'de ninguem. Sem parametro de escopo, de proposito — nao ha o que o cliente '
  'adulterar.';

REVOKE ALL     ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) TO authenticated, service_role;
