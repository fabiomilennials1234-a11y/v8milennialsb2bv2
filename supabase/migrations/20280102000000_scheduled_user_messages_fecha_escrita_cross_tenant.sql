-- =============================================================================
-- scheduled_user_messages: fecha a escrita cross-tenant da fila de envio
-- =============================================================================
--
-- O furo (herdado do baseline, 20260101000000:36488 e :36514)
-- ------------------------------------------------------------
-- A fila é consumida pelo worker `process-scheduled-user-messages`, que roda
-- como service_role e confia na linha: manda WhatsApp para `phone_number`,
-- pela instância `whatsapp_instance_id`, em nome de `organization_id`. A
-- busca da instância é por `id`, sem filtro de org. Então quem escreve a
-- linha escolhe por qual caixa — de qualquer org — a mensagem sai.
--
-- E a escrita estava aberta:
--
--   * UPDATE "Members can update own scheduled messages": só USING
--     (`created_by` é um team_members meu), sem WITH CHECK e sem olhar
--     `is_active`. O autor podia, via PostgREST direto, reescrever
--     `organization_id`, `whatsapp_instance_id`, `phone_number` e `created_by`
--     da própria linha — e um membro desativado continuava podendo.
--   * INSERT "Members can insert own org scheduled messages": checava só a
--     org. `whatsapp_instance_id`, `lead_id`, `created_by` e `assigned_to`
--     podiam apontar para outra org. É o MESMO vetor, sem precisar de UPDATE.
--
--   Medido no PGlite contra o texto de prod (tests/integration/
--   scheduled-user-messages-cross-tenant.test.mjs, teste "sentinela"):
--     - qualquer membro aponta a própria linha para a instância de outra org
--       (UPDATE ou INSERT) e troca o telefone de destino;
--     - quem é membro de DUAS orgs move a linha inteira de A para B (para
--       membro de uma org só, a policy de SELECT na linha nova barra, porque
--       o UPDATE do PostgREST sempre tem WHERE);
--     - membro DESATIVADO reescreve o destino das próprias linhas com um
--       UPDATE sem filtro (sem WHERE não há leitura, só o USING, que não olha
--       is_active).
--   Em prod em 10/11/2026: zero linhas com instância, lead, autor ou
--   responsável de outra org — nenhum sinal de exploração.
--
-- A correção, em três camadas independentes
-- -----------------------------------------
-- 1. Policies INSERT/UPDATE com o mesmo predicado em USING e WITH CHECK:
--    org acessível (`get_my_organization_ids()`, que já corta membro inativo e
--    org suspensa) E `created_by` é o MEU team_members, ativo, DA ORG DA LINHA
--    (`my_team_member_id(organization_id)`, helper DEFINER já em prod — sem
--    SELECT inline em team_members dentro da policy).
--
-- 2. Trigger de integridade (todas as roles, inclusive service_role):
--    instância, lead, autor e responsável têm de ser da org da linha. É
--    invariante do dado, não permissão — vale para qualquer escritor futuro
--    (automação, edge fn, RPC DEFINER). SECURITY DEFINER porque precisa ler
--    `whatsapp_instances`/`leads`/`team_members` sem o recorte de RLS de quem
--    escreve; senão a guarda dependeria do que o chamador enxerga.
--
-- 3. Trigger de imutabilidade (só para `authenticated`/`anon`): o cliente
--    edita conteúdo, mídia, horário e responsável, e move o status pelos
--    caminhos que o front tem. Endereço da entrega (org, instância, telefone,
--    lead, autor) e trilha do worker (`sent_at`) não mudam depois de criados.
--
--    Transições de status permitidas ao cliente:
--      scheduled → scheduled   (editar, "enviar agora" = scheduled_at := now())
--      scheduled → cancelled   (cancelar)
--      failed    → scheduled   (tentar de novo; zera retry_count/error_message)
--      failed    → cancelled   (descartar)
--    Linha em sending/sent/cancelled é congelada para o cliente: reviver um
--    `sent` reenviaria a mensagem (duplicata = vetor de ban), e reescrever o
--    conteúdo de um `sent` falsificaria o histórico.
--
--    Por que `current_user` e não claim do JWT: a trigger é SECURITY INVOKER,
--    então `current_user` é a role efetiva do PostgREST (`authenticated`,
--    `service_role`). A ação de FK `ON DELETE SET NULL` em
--    `whatsapp_instance_id`/`assigned_to` roda como dono da tabela, então
--    apagar uma instância continua funcionando mesmo quando quem apaga é um
--    usuário. Migration/MCP rodam como postgres e também passam.
--
-- O que NÃO muda
-- --------------
--   * SELECT (org inteira) e as policies master_ghost_* — intocadas. O master
--     passa pelas suas policies, mas a integridade (2) e a imutabilidade (3)
--     valem para ele também: nenhum fluxo legítimo move linha entre orgs.
--   * Worker: só atualiza status/sent_at/error_message/retry_count/
--     scheduled_at, como service_role → (3) não se aplica, (2) não dispara
--     porque não toca colunas de endereço.
--   * Linhas existentes: (2) só avalia coluna que MUDOU. Linha antiga
--     inconsistente não trava o worker; ela só não pode ser reescrita.
--
-- Rollback: supabase/migrations/rollback/20280102000000_scheduled_user_messages_fecha_escrita_cross_tenant.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can insert own org scheduled messages" ON public.scheduled_user_messages;
DROP POLICY IF EXISTS "Members can update own scheduled messages" ON public.scheduled_user_messages;

CREATE POLICY "Members can insert own org scheduled messages"
  ON public.scheduled_user_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND created_by = public.my_team_member_id(organization_id)
  );

CREATE POLICY "Members can update own scheduled messages"
  ON public.scheduled_user_messages
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND created_by = public.my_team_member_id(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND created_by = public.my_team_member_id(organization_id)
  );

-- -----------------------------------------------------------------------------
-- 2. Integridade de tenant (todas as roles)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduled_user_messages_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_insert boolean := (TG_OP = 'INSERT');
BEGIN
  IF NEW.whatsapp_instance_id IS NOT NULL
     AND (v_is_insert
          OR NEW.whatsapp_instance_id IS DISTINCT FROM OLD.whatsapp_instance_id
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_instances wi
       WHERE wi.id = NEW.whatsapp_instance_id
         AND wi.organization_id = NEW.organization_id
     )
  THEN
    RAISE EXCEPTION 'A instância de WhatsApp não pertence à organização da mensagem agendada.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.lead_id IS NOT NULL
     AND (v_is_insert
          OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.leads l
       WHERE l.id = NEW.lead_id
         AND l.organization_id = NEW.organization_id
     )
  THEN
    RAISE EXCEPTION 'O lead não pertence à organização da mensagem agendada.'
      USING ERRCODE = '42501';
  END IF;

  IF (v_is_insert
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members tm
       WHERE tm.id = NEW.created_by
         AND tm.organization_id = NEW.organization_id
     )
  THEN
    RAISE EXCEPTION 'O autor não é membro da organização da mensagem agendada.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.assigned_to IS NOT NULL
     AND (v_is_insert
          OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members tm
       WHERE tm.id = NEW.assigned_to
         AND tm.organization_id = NEW.organization_id
     )
  THEN
    RAISE EXCEPTION 'O responsável não é membro da organização da mensagem agendada.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.scheduled_user_messages_tenant_integrity() IS
  'Invariante de tenant da fila de envio: instância, lead, autor e responsável são da org da linha. Vale para todas as roles. Só avalia coluna que mudou, para não travar o worker em linha antiga.';

-- -----------------------------------------------------------------------------
-- 3. Imutabilidade para o cliente (authenticated/anon)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduled_user_messages_client_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  -- service_role (worker), postgres (migration, ação de FK) e demais roles
  -- de servidor passam. Só o cliente do PostgREST é restringido.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- INSERT: o cliente só cria agendamento novo. Estado e trilha são do worker
  -- — sem isto dava para inserir direto um `sent` com `sent_at` e forjar o
  -- histórico de enviadas.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'scheduled'
       OR NEW.sent_at IS NOT NULL
       OR NEW.retry_count <> 0
       OR NEW.error_message IS NOT NULL
    THEN
      RAISE EXCEPTION 'Mensagem agendada nasce com status scheduled, sem sent_at, retry_count nem error_message.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.whatsapp_instance_id IS DISTINCT FROM OLD.whatsapp_instance_id
     OR NEW.phone_number IS DISTINCT FROM OLD.phone_number
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Organização, autor, instância, telefone e lead de uma mensagem agendada não podem ser alterados.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status NOT IN ('scheduled', 'failed') THEN
    RAISE EXCEPTION 'Mensagem agendada com status % não pode mais ser alterada.', OLD.status
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
       NEW.status = OLD.status
    OR (OLD.status = 'scheduled' AND NEW.status = 'cancelled')
    OR (OLD.status = 'failed'    AND NEW.status IN ('scheduled', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Transição de status % → % não é permitida.', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  -- Contador e erro são do worker; o cliente só pode zerá-los ("tentar de novo").
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count AND NEW.retry_count <> 0 THEN
    RAISE EXCEPTION 'retry_count só pode ser zerado pelo cliente.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.error_message IS DISTINCT FROM OLD.error_message AND NEW.error_message IS NOT NULL THEN
    RAISE EXCEPTION 'error_message só pode ser limpo pelo cliente.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.scheduled_user_messages_client_guard() IS
  'Imutabilidade da fila de envio para authenticated/anon: INSERT nasce scheduled sem trilha do worker; endereço da entrega e trilha do worker são fixos; status só scheduled→cancelled, failed→scheduled|cancelled; sending/sent/cancelled congelados.';

-- Funções de trigger não são chamáveis direto, mas o default privilege do
-- schema public as nasce executáveis por PUBLIC/anon/service_role. Revoga
-- tudo: o trigger dispara independentemente de EXECUTE.
REVOKE ALL ON FUNCTION public.scheduled_user_messages_tenant_integrity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduled_user_messages_client_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_scheduled_user_messages_tenant_integrity ON public.scheduled_user_messages;
CREATE TRIGGER trg_scheduled_user_messages_tenant_integrity
  BEFORE INSERT OR UPDATE ON public.scheduled_user_messages
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_user_messages_tenant_integrity();

DROP TRIGGER IF EXISTS trg_scheduled_user_messages_client_guard ON public.scheduled_user_messages;
CREATE TRIGGER trg_scheduled_user_messages_client_guard
  BEFORE INSERT OR UPDATE ON public.scheduled_user_messages
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_user_messages_client_guard();

COMMIT;
