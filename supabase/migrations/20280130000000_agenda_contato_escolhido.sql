-- 20280130000000_agenda_contato_escolhido.sql
--
-- Escolha do CONTATO no "Nova agenda" do Comando (Café Jurerê, 27/11).
--
-- Na Café um cliente tem vários contatos (1.486 clientes com 2+ nomes, 2.776
-- com 2+ telefones em 27/11). O modal escolhia só o cliente; a agenda e a
-- reunião não diziam COM QUEM falar, e o "Entrar em contato" da Agenda abria
-- sempre o telefone principal do lead.
--
-- Contato = uma linha de `lead_phones` (nome do contato do ERP + número), o
-- mesmo vínculo que `deals.lead_phone_id` já usa no "Novo negócio". Não usa
-- `lead_contacts`/`contacts` (0 linhas na Café).
--
-- ── O que muda ───────────────────────────────────────────────────────────
-- 1. `agenda_contatos.lead_phone_id` e `meetings.lead_phone_id` (nulos, FK
--    para `lead_phones`, ON DELETE SET NULL). Nulo = sem contato escolhido:
--    tudo o que já existe continua igual.
-- 2. Trava `fn_lead_phone_do_mesmo_lead`: o contato tem que ser DO cliente da
--    linha (mesmo lead, mesma org, não apagado). Escolha explícita inválida é
--    recusada (22023). Quando só o `lead_id` muda (fusão de lead), o vínculo
--    que deixou de valer é limpo em silêncio — nunca derruba a fusão.
-- 3. `agenda_contato_marcar` ganha `p_lead_phone` (DEFAULT NULL). Remarcar
--    sem contato (a pílula de data da Agenda) MANTÉM o contato já escolhido.
-- 4. `get_agenda_contatos` devolve `lead_phone_id`, `contato_nome` e
--    `contato_telefone` (colunas novas no FIM; as antigas não mudam).
--
-- ── Segurança ────────────────────────────────────────────────────────────
-- A trava é SECURITY DEFINER de propósito: ela confere um FATO da linha (o
-- telefone pertence a este lead?), não visibilidade. Como INVOKER ela passaria
-- pela RLS de `lead_phones` (que herda a de `leads`) e poderia recusar ou
-- limpar um vínculo válido só porque quem grava não enxerga o lead — o caso da
-- fusão feita por função INVOKER. Quem decide QUEM grava continuam sendo as
-- policies de `meetings` e `agenda_contatos`, intocadas. A resposta é só
-- "vale / não vale", sobre um uuid que a pessoa já tem. Função de trigger não
-- é chamável por RPC; mesmo assim, sem EXECUTE para PUBLIC/anon/authenticated.
--
-- Leitura: `get_agenda_contatos` segue INVOKER — o contato vem por LEFT JOIN
-- em `lead_phones` sob a RLS de quem lê. Contato apagado (soft) volta nulo e a
-- tela cai no telefone principal.
--
-- DROP + CREATE nas duas RPCs: muda a assinatura de `agenda_contato_marcar`
-- (um CREATE OR REPLACE criaria uma SEGUNDA função, e a chamada de 5 argumentos
-- ficaria ambígua) e o RETURNS TABLE de `get_agenda_contatos`. Os corpos de
-- partida são os VIGENTES em prod, conferidos por md5 do prosrc em 27/11
-- (marcar ad439836…, listar 533e754e… = 20280117020000). Sem COMMENT em prod
-- nas duas; os GRANTs são refeitos abaixo, iguais aos de antes.
--
-- Compatível com o front de antes: a chamada de 5 argumentos nomeados cai na
-- função nova (o 6º tem default) e as colunas novas da lista são ignoradas.
-- Ordem: migration ANTES do merge (o front sobe sozinho no merge).
--
-- Custo: `meetings` 3,1 mil linhas, `agenda_contatos` 3, `lead_phones` 90 mil
-- (prod, 27/11). ADD COLUMN nulo é só catálogo; a FK valida uma coluna toda
-- nula. lock_timeout 3s: se não pegar o lock, aborta limpo.
--
-- Rollback: supabase/migrations/rollback/20280130000000_agenda_contato_escolhido.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Colunas
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agenda_contatos
  ADD COLUMN IF NOT EXISTS lead_phone_id uuid NULL
    REFERENCES public.lead_phones(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.agenda_contatos.lead_phone_id IS
  'Contato do cliente com quem é a agenda (lead_phones.id). Nulo = sem contato escolhido.';

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS lead_phone_id uuid NULL
    REFERENCES public.lead_phones(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.meetings.lead_phone_id IS
  'Contato do cliente com quem é a reunião (lead_phones.id). Nulo = sem contato escolhido.';

-- A FK precisa de índice no lado que referencia: sem ele, apagar um telefone
-- varre a tabela inteira. Parcial: quase toda linha é nula.
CREATE INDEX IF NOT EXISTS meetings_lead_phone_id_idx
  ON public.meetings (lead_phone_id) WHERE lead_phone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_contatos_lead_phone_id_idx
  ON public.agenda_contatos (lead_phone_id) WHERE lead_phone_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Trava: o contato é do cliente da linha
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_phone_do_mesmo_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_escolhido boolean;
BEGIN
  IF NEW.lead_phone_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Escolha explícita: no INSERT, ou quando o próprio contato mudou.
  v_escolhido := TG_OP = 'INSERT' OR NEW.lead_phone_id IS DISTINCT FROM OLD.lead_phone_id;

  -- Remarcar e editar sem mexer no contato nem no cliente: nada a conferir.
  IF NOT v_escolhido AND NEW.lead_id IS NOT DISTINCT FROM OLD.lead_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.lead_phones lp
        WHERE lp.id = NEW.lead_phone_id
          AND lp.lead_id = NEW.lead_id
          AND lp.organization_id = NEW.organization_id
          AND lp.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  IF v_escolhido THEN
    RAISE EXCEPTION 'Este contato não é deste cliente. Atualize e escolha de novo.'
      USING ERRCODE = '22023';
  END IF;

  -- Só o cliente mudou (fusão): o contato antigo deixou de valer.
  NEW.lead_phone_id := NULL;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_lead_phone_do_mesmo_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_agenda_contatos_contato_do_lead ON public.agenda_contatos;
CREATE TRIGGER trg_agenda_contatos_contato_do_lead
  BEFORE INSERT OR UPDATE OF lead_phone_id, lead_id, organization_id ON public.agenda_contatos
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_phone_do_mesmo_lead();

DROP TRIGGER IF EXISTS trg_meeting_contato_do_lead ON public.meetings;
CREATE TRIGGER trg_meeting_contato_do_lead
  BEFORE INSERT OR UPDATE OF lead_phone_id, lead_id, organization_id ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_phone_do_mesmo_lead();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Marcar / remarcar com o contato
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.agenda_contato_marcar(uuid, uuid, date, text, uuid);

CREATE FUNCTION public.agenda_contato_marcar(
  p_org uuid,
  p_lead uuid,
  p_data date,
  p_observacao text DEFAULT NULL,
  p_owner uuid DEFAULT NULL,
  p_lead_phone uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_me    uuid;
  v_owner uuid;
  v_id    uuid;
BEGIN
  IF p_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_lead IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'Escolha o cliente e a data da agenda.' USING ERRCODE = '22023';
  END IF;

  v_me := public.my_team_member_id(p_org);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Só um membro da equipe pode marcar agenda.' USING ERRCODE = '42501';
  END IF;
  v_owner := COALESCE(p_owner, v_me);
  IF v_owner <> v_me AND NOT public.is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Só o admin marca agenda para outra pessoa.' USING ERRCODE = '42501';
  END IF;

  -- Contato vazio ao remarcar = manter o que já estava escolhido. Quem confere
  -- que o contato é deste cliente é a trava da tabela.
  INSERT INTO public.agenda_contatos (organization_id, lead_id, owner_id, data_agenda, observacao, created_by, lead_phone_id)
  VALUES (p_org, p_lead, v_owner, p_data, NULLIF(btrim(p_observacao), ''), v_me, p_lead_phone)
  ON CONFLICT (organization_id, lead_id, owner_id) WHERE concluida_em IS NULL
  DO UPDATE SET data_agenda   = EXCLUDED.data_agenda,
                observacao    = COALESCE(EXCLUDED.observacao, public.agenda_contatos.observacao),
                lead_phone_id = COALESCE(EXCLUDED.lead_phone_id, public.agenda_contatos.lead_phone_id)
  RETURNING public.agenda_contatos.id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_contato_marcar(uuid, uuid, date, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_contato_marcar(uuid, uuid, date, text, uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Listar com o contato
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_agenda_contatos(uuid, boolean, integer);

CREATE FUNCTION public.get_agenda_contatos(p_org uuid, p_somente_meus boolean DEFAULT false, p_limite integer DEFAULT 500)
 RETURNS TABLE(id uuid, lead_id uuid, lead_name text, lead_company text, lead_phone text, lead_phones text[], lead_erp_code text, lead_uf text, lead_cidade text, erp_representante text, owner_id uuid, owner_name text, data_agenda date, observacao text, situacao text, created_at timestamp with time zone, lead_phone_id uuid, contato_nome text, contato_telefone text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_hoje date;
  v_me   uuid;
BEGIN
  IF p_org IS NULL OR NOT (
       public.is_master_user()
       OR EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  v_hoje := public.agenda_contatos_hoje(p_org);
  v_me := public.my_team_member_id(p_org);

  RETURN QUERY
  SELECT a.id, a.lead_id, l.name::text, l.company::text, l.phone::text,
         COALESCE(fones.lista, CASE WHEN l.phone IS NOT NULL THEN ARRAY[l.phone::text] END),
         l.erp_code::text,
         COALESCE(NULLIF(btrim(u.erp_uf), ''), l.uf)::text,
         NULLIF(btrim(u.erp_city), '')::text,
         NULLIF(btrim(u.erp_owner_name), '')::text,
         a.owner_id, tm.name::text, a.data_agenda, a.observacao,
         CASE WHEN a.data_agenda < v_hoje THEN 'atrasada'
              WHEN a.data_agenda = v_hoje THEN 'hoje'
              ELSE 'futura' END,
         a.created_at,
         ct.id,
         NULLIF(btrim(ct.label), '')::text,
         NULLIF(btrim(ct.phone), '')::text
    FROM public.agenda_contatos a
    JOIN public.leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
    LEFT JOIN public.team_members tm ON tm.id = a.owner_id
    -- upsell_clients é 1:1 com o lead (medido em prod: no máximo 1 por lead);
    -- o LATERAL com LIMIT 1 garante que uma duplicata futura não duplique a agenda.
    LEFT JOIN LATERAL (
      SELECT uc.erp_city, uc.erp_uf, uc.erp_owner_name
        FROM public.upsell_clients uc
       WHERE uc.lead_id = l.id AND uc.organization_id = p_org
       ORDER BY uc.updated_at DESC NULLS LAST
       LIMIT 1
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(lp.phone::text ORDER BY lp.is_primary DESC, lp.created_at ASC) AS lista
        FROM public.lead_phones lp
       WHERE lp.lead_id = l.id AND lp.organization_id = p_org AND lp.deleted_at IS NULL
         AND NULLIF(btrim(lp.phone), '') IS NOT NULL
    ) fones ON true
    -- O contato escolhido. Apagado (soft) volta nulo: a tela cai no principal.
    LEFT JOIN public.lead_phones ct
      ON ct.id = a.lead_phone_id AND ct.lead_id = a.lead_id AND ct.deleted_at IS NULL
   WHERE a.organization_id = p_org
     AND a.concluida_em IS NULL
     AND (NOT COALESCE(p_somente_meus, false) OR a.owner_id = v_me)
   ORDER BY a.data_agenda ASC, l.name ASC, a.id ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 500), 1), 1000);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agenda_contatos(uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agenda_contatos(uuid, boolean, integer) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
