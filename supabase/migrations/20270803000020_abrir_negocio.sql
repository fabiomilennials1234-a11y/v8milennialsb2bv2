-- ============================================================================
-- A porta de criação do Negócio. Passo 7 do L2 (fatia 2, lead-negocio).
--
-- ADR-0023 decisão 3: "um Negócio nasce só por clique humano". Nenhum ingest,
-- integração ou automação abre um.
-- ADR-0023 decisão 9: título derivado e editável, default `Negócio de <mês>/<ano>`.
--
-- ── POR QUE ISTO É UM PASSO MAIOR DO QUE O PLANO DIZIA ─────────────────────
-- O plano tratava o passo 7 como "trocar o default de um campo". Medido em
-- 2026-08-03: depois do passo 3 (que apagou `/negocios`) **não sobra caminho
-- nenhum de criação de negócio no repo**. O único `INSERT INTO deals` vivia em
-- `carteira/hooks/useDeals.ts`, apagado junto com a rota. A "porta única" da UI
-- (`NewDealDialog` → `CrossPipePanel`) nunca criou linha em `deals`: ela cria
-- card na view legada, e o título que o usuário lê é derivado NA LEITURA, a
-- partir do nome do funil — exatamente o que a decisão 9 rejeita por produzir
-- dezenas de milhares de negócios chamados "Qualificação".
--
-- Ou seja: a decisão 3 pressupõe uma porta que ainda não existia. Isto a escreve.
--
-- ── DUAS ESCRITAS QUE NÃO PODEM SE SEPARAR ─────────────────────────────────
-- Abrir um negócio é criar a IDENTIDADE (`deals`) e a POSIÇÃO
-- (`pipeline_entries` / `custom_pipe_entries`) ligadas por `deal_id`. Se as duas
-- forem chamadas do cliente, uma falha no meio deixa card órfão — o mesmo estado
-- que o backfill do L3 existe para consertar, criado de novo a cada erro de rede.
-- Aqui as duas vivem no corpo de uma função: ou as duas acontecem, ou nenhuma.
--
-- ── POR QUE A FUNÇÃO REUSA A VIEW DE COMPATIBILIDADE ───────────────────────
-- Os `INSTEAD OF INSERT` de `pipe_whatsapp` / `pipe_confirmacao` /
-- `pipe_propostas` já resolvem o `pipeline_id` pelo slug e já mapeiam os campos
-- legados para `metadata` — 13 chaves só em propostas (`sale_value`, `closer_id`,
-- `product_id`, `loss_reason_id`, `metrics_period_at`, ...). Reescrever esse
-- mapeamento aqui seria duplicar lógica testada em produção para ganhar nada, e
-- os dois caminhos divergiriam no primeiro campo novo. A função pré-gera o `id`
-- (o trigger faz `COALESCE(NEW.id, gen_random_uuid())`), insere pela view, e usa
-- esse id para ligar o `deal_id`.
--
-- ── SECURITY INVOKER, de propósito ─────────────────────────────────────────
-- Sem `SECURITY DEFINER`: quem abre negócio tem exatamente a permissão que já
-- tinha para criar o card, porque a RLS do chamador continua valendo em `deals`,
-- em `pipeline_entries` e nas views. Isso deixa a pergunta em aberto do L4
-- ("quem pode abrir um negócio: todo mundo, só admin, ou só quem atende?")
-- REVERSÍVEL — responder depois é apertar policy, não reescrever esta função.
-- Também evita a armadilha de EXECUTE deste projeto: DEFINER exigiria pinar
-- `search_path` e revogar de PUBLIC **e** de anon **e** de authenticated.
-- ============================================================================

BEGIN;

-- ── Título derivado ────────────────────────────────────────────────────────
--
-- Sem `to_char(..., 'TMMonth')`: aquilo depende de `lc_time` do servidor, que
-- ninguém neste projeto controla nem versiona — o título sairia em inglês, ou
-- mudaria de idioma numa troca de instância, em dado já gravado. Array literal é
-- determinístico e revisável.
--
-- A data é convertida para o fuso da ORG antes de virar mês/ano. Um negócio
-- aberto às 22h de 31/03 em São Paulo é 01/04 em UTC: sem isto, o título diria
-- abril para quem viveu março. As 96 orgs têm `timezone` preenchido (medido
-- 2026-08-03); o COALESCE cobre org nova antes do onboarding.
CREATE OR REPLACE FUNCTION public.fn_negocio_titulo_padrao(
  p_when timestamptz,
  p_timezone text DEFAULT 'America/Sao_Paulo'
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 'Negócio de '
      || (ARRAY['janeiro','fevereiro','março','abril','maio','junho',
                'julho','agosto','setembro','outubro','novembro','dezembro']
          )[EXTRACT(MONTH FROM p_when AT TIME ZONE COALESCE(NULLIF(p_timezone,''), 'America/Sao_Paulo'))::int]
      || '/'
      || EXTRACT(YEAR FROM p_when AT TIME ZONE COALESCE(NULLIF(p_timezone,''), 'America/Sao_Paulo'))::int::text;
$$;

COMMENT ON FUNCTION public.fn_negocio_titulo_padrao(timestamptz, text) IS
  'ADR-0023 decisão 9: título default do Negócio, `Negócio de <mês>/<ano>` no fuso da org. Derivado e editável — não é identidade.';

-- ── A porta ────────────────────────────────────────────────────────────────
--
-- `p_pipe` aceita os três slugs de sistema ou `custom:<pipeline_id>`.
-- `p_title` NULL → derivado. Passar título é o caso do usuário que já sabe como
-- quer chamar ("Reposição trimestral"), previsto pela decisão 9.
CREATE OR REPLACE FUNCTION public.abrir_negocio(
  p_lead_id     uuid,
  p_pipe        text,
  p_stage       text,
  p_owner_id    uuid    DEFAULT NULL,
  p_value       numeric DEFAULT NULL,
  p_meeting_date timestamptz DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_title       text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_org        uuid;
  v_tz         text;
  v_deal_id    uuid;
  v_entry_id   uuid := gen_random_uuid();
  v_title      text;
  v_custom_id  uuid;
  v_notes      text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  -- A org vem do LEAD, nunca de parâmetro. Com RLS de invoker, um lead de outra
  -- organização simplesmente não é visível e a função aborta aqui — o chamador
  -- não consegue escolher em qual org escreve.
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Lead % não encontrado (ou está na lixeira).', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = v_org;

  -- Dono de outra org é recusado aqui, e não só pela trava do M6: a mensagem
  -- daqui diz o que aconteceu, a do gatilho diz que uma constraint falhou.
  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = v_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização deste lead.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_title := COALESCE(
    NULLIF(btrim(COALESCE(p_title, '')), ''),
    public.fn_negocio_titulo_padrao(now(), v_tz)
  );

  INSERT INTO public.deals (organization_id, title, source_lead_id, owner_id, value, notes, created_by)
  VALUES (v_org, v_title, p_lead_id, p_owner_id, p_value, v_notes, auth.uid())
  RETURNING id INTO v_deal_id;

  IF p_pipe LIKE 'custom:%' THEN
    v_custom_id := substring(p_pipe FROM 8)::uuid;

    INSERT INTO public.custom_pipe_entries
      (id, pipeline_id, lead_id, organization_id, stage_id, assigned_to, notes, deal_id)
    VALUES (v_entry_id, v_custom_id, p_lead_id, v_org, p_stage::uuid, p_owner_id, v_notes, v_deal_id);

  ELSIF p_pipe = 'whatsapp' THEN
    INSERT INTO public.pipe_whatsapp
      (id, lead_id, organization_id, status, responsible_id, sdr_id, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, v_notes);

  ELSIF p_pipe = 'confirmacao' THEN
    INSERT INTO public.pipe_confirmacao
      (id, lead_id, organization_id, status, responsible_id, sdr_id, meeting_date, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, p_meeting_date, v_notes);

  ELSIF p_pipe = 'propostas' THEN
    INSERT INTO public.pipe_propostas
      (id, lead_id, organization_id, status, responsible_id, closer_id, sale_value, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, p_value, v_notes);

  ELSE
    -- `upsell` cai aqui de propósito: carteira entra por regra própria
    -- (ADR-0023 decisão 8), não por esta porta.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', p_pipe
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Liga a posição à identidade. Nos funis de sistema a linha nasceu pelo
  -- `INSTEAD OF` da view, que não conhece `deal_id`; no custom já nasceu ligada.
  IF p_pipe NOT LIKE 'custom:%' THEN
    UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = v_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Card criado mas não encontrado para ligar ao negócio (entry %). Transação desfeita para não deixar negócio sem posição.', v_entry_id
        USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  RETURN v_deal_id;
END;
$$;

COMMENT ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text) IS
  'ADR-0023 decisão 3: a única porta de criação de Negócio, e ela é humana. Cria `deals` + a posição no funil ligadas por deal_id, numa transação só. SECURITY INVOKER: a permissão é a mesma de criar o card, e apertá-la depois é mexer em policy, não nesta função.';

-- ── ACL ────────────────────────────────────────────────────────────────────
-- A armadilha deste projeto tem dois lados e nenhum revoke sozinho fecha os
-- dois: `PUBLIC` concede implícito no CREATE, e um `ALTER DEFAULT PRIVILEGES`
-- concede NOMINALMENTE a `anon` e `authenticated` em toda função nova do schema.
-- Revogar dos três, e conferir — verificação abaixo.
REVOKE ALL     ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text) TO authenticated;

REVOKE ALL     ON FUNCTION public.fn_negocio_titulo_padrao(timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_negocio_titulo_padrao(timestamptz, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_negocio_titulo_padrao(timestamptz, text) TO authenticated;

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE v_mes text; v_anon boolean; v_auth boolean;
BEGIN
  -- Título: 31/03 às 22h em São Paulo é 01/04 em UTC. O fuso tem de ganhar.
  SELECT public.fn_negocio_titulo_padrao('2026-04-01T01:00:00Z'::timestamptz, 'America/Sao_Paulo') INTO v_mes;
  IF v_mes <> 'Negócio de março/2026' THEN
    RAISE EXCEPTION 'FAIL: título derivado ignorou o fuso da org. Esperava "Negócio de março/2026", veio "%".', v_mes;
  END IF;

  SELECT has_function_privilege('anon',
    'public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text)', 'EXECUTE') INTO v_anon;
  SELECT has_function_privilege('authenticated',
    'public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text)', 'EXECUTE') INTO v_auth;

  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon executa abrir_negocio. O revoke não pegou — confira PUBLIC e o ALTER DEFAULT PRIVILEGES.';
  END IF;
  IF NOT v_auth THEN
    RAISE EXCEPTION 'FAIL: authenticated NÃO executa abrir_negocio — a porta ficou fechada para quem deveria abrir negócio.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: título derivado respeita o fuso da org; abrir_negocio é SECURITY INVOKER, negada a anon e concedida a authenticated.';
END$$;

COMMIT;
