-- Telefone N:N, PR4 (Chamado 99067f13): compartilhar o numero principal entre leads.
--
-- Regra do CTO: o mesmo numero pode ser telefone PRINCIPAL de mais de um lead, mas
-- SO por acao explicita do usuario. Webhook, import, ERP (Toth) e chat nunca marcam.
-- O mecanismo (coluna leads.phone_compartilhado + indice unico parcial que ignora os
-- compartilhados) ja esta em prod (PR2/PR3). Esta migration entrega o unico caminho de
-- escrita da marca e o desfazer.
--
-- O QUE MUDA
--  1. salvar_telefones_do_lead ganha p_permitir_compartilhado boolean DEFAULT false
--     (ultimo parametro). A assinatura de 2 argumentos e REMOVIDA na mesma transacao
--     (senao as duas ficariam ambiguas no PostgREST); quem chama com 2 argumentos
--     resolve para a nova, com false. Continua INVOKER, search_path 'public'.
--       false (padrao): comportamento identico ao de prod (23505 no indice).
--       true: exige sessao + assert_org_access(org DO LEAD). Quem decide se o
--             usuario pode editar o lead e a propria RLS de UPDATE de leads: o UPDATE
--             que nao afeta linha vira 42501 sem_permissao_lead. NAO usa
--             can_update_lead: ela nao tem EXECUTE para authenticated (so roda dentro
--             de DEFINER) e esta funcao e INVOKER; chama-la aqui seria "permission
--             denied" para todo usuario que nao e master. Se o indice recusa o
--             principal novo, marca ESTE lead (o que esta adicionando o numero) e
--             salva. O dono NUNCA e marcado. Numero livre: true nao marca nada.
--  2. lead_phone_descompartilhar(p_lead_id): zera a marca. SECURITY DEFINER,
--     search_path '', assert_org_access + can_update_lead. Se outro lead vivo NAO
--     compartilhado tem o mesmo principal, recusa com 23505 (idx_leads_org_phone_unique)
--     SEM devolver identidade de lead: o front busca o dono pelo RLS do usuario (#2331).
--  3. api_create_lead: unica mudanca e o lookup do 'conflict', que passa a ordenar
--     (ORDER BY phone_compartilhado, created_at, id) para devolver o DONO.
--  4. Gatilho tg_leads_phone_compartilhado_guarda, SECURITY DEFINER, em dois
--     triggers: BEFORE UPDATE OF phone_compartilhado (so quando a marca MUDA) e
--     BEFORE INSERT WHEN (NEW.phone_compartilhado):
--       - lead nasce nao compartilhado: INSERT com a marca e recusado (23514
--         phone_compartilhado_so_por_acao);
--       - garantia de dono: marcar um lead sem nenhum outro lead vivo nao
--         compartilhado com o mesmo principal (ou sem principal) e recusado
--         (23514 phone_compartilhado_sem_dono) para QUALQUER caminho de UPDATE;
--       - trilha: grava lead_history ('phone_shared' / 'phone_unshared', source
--         'manual', created_by = auth.uid(), metadata.phone = numero normalizado, sem
--         identidade do outro lead). Escolhido no lugar de tabela nova: lead_history e
--         a linha do tempo do lead e o gatilho (DEFINER) nao depende de RLS do chamador.
--
-- ORDEM DE APLICACAO: esta migration ANTES do merge do front (o front novo chama a
-- RPC com o parametro novo e lead_phone_descompartilhar). O front antigo segue
-- funcionando contra esta migration (chama com 2 argumentos).
--
-- LIMITES CONHECIDOS: o gatilho valida no momento de marcar; se depois o dono trocar
-- de numero, o lead compartilhado vira o unico detentor (e continua valido). Lead
-- compartilhado que troca para numero livre mantem a marca (inofensiva; use
-- "Deixar de compartilhar"). Corpo das funcoes copiado de pg_get_functiondef em prod
-- (19/10/2026; reconferido em 20/10/2026, diff so nas mudancas listadas acima).

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. salvar_telefones_do_lead (3 argumentos)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.salvar_telefones_do_lead(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.salvar_telefones_do_lead(p_lead_id uuid, p_phones jsonb, p_permitir_compartilhado boolean DEFAULT false)
 RETURNS SETOF lead_phones
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org        uuid;
  v_lead_phone text;
  v_item       jsonb;
  v_norm       text;
  v_label      text;
  v_row        public.lead_phones%ROWTYPE;
  v_keep       uuid[] := '{}';
  v_norms      text[] := '{}';
  v_primary    text;
  v_primaries  integer := 0;
  v_tinha      integer;
  v_constraint text;
BEGIN
  IF p_phones IS NULL OR jsonb_typeof(p_phones) <> 'array' THEN
    RAISE EXCEPTION 'phones_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT l.organization_id, l.phone INTO v_org, v_lead_phone
    FROM public.leads l WHERE l.id = p_lead_id AND l.deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Compartilhar o número é ação EXPLÍCITA do usuário (Chamado 99067f13), na org
  -- DO LEAD (não na do chamador). Poder editar o lead é a RLS de UPDATE quem diz:
  -- ver o UPDATE do principal mais abaixo.
  IF p_permitir_compartilhado THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'sem_permissao_lead' USING ERRCODE = '42501';
    END IF;
    PERFORM public.assert_org_access(v_org);
  END IF;

  SELECT count(*) INTO v_tinha FROM public.lead_phones
   WHERE lead_id = p_lead_id AND deleted_at IS NULL;

  -- Validação inteira ANTES de escrever.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
    v_norm := public.normalize_brazilian_phone(v_item->>'phone');
    IF v_norm IS NULL OR length(v_norm) < 10 THEN
      RAISE EXCEPTION 'phone_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_norm = ANY (v_norms) THEN
      RAISE EXCEPTION 'phone_duplicated' USING ERRCODE = 'unique_violation';
    END IF;
    v_norms := v_norms || v_norm;
    IF COALESCE((v_item->>'is_primary')::boolean, false) THEN
      v_primaries := v_primaries + 1;
      v_primary := btrim(v_item->>'phone');
    END IF;
  END LOOP;
  IF v_primaries > 1 THEN
    RAISE EXCEPTION 'primary_duplicated' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_primaries = 0 AND jsonb_array_length(p_phones) > 0 THEN
    RAISE EXCEPTION 'primary_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
    v_norm  := public.normalize_brazilian_phone(v_item->>'phone');
    v_label := NULLIF(btrim(COALESCE(v_item->>'label', '')), '');
    v_row   := NULL;

    IF v_item ? 'id' AND NULLIF(v_item->>'id', '') IS NOT NULL THEN
      SELECT * INTO v_row FROM public.lead_phones
       WHERE id = (v_item->>'id')::uuid AND lead_id = p_lead_id AND deleted_at IS NULL;
      IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      SELECT * INTO v_row FROM public.lead_phones
       WHERE lead_id = p_lead_id AND normalized_phone = v_norm AND deleted_at IS NULL;
    END IF;

    IF v_row.id IS NOT NULL THEN
      UPDATE public.lead_phones SET
        phone        = CASE WHEN normalized_phone IS DISTINCT FROM v_norm
                            THEN btrim(v_item->>'phone') ELSE phone END,
        label        = v_label,
        -- Nome alterado pelo usuário: o ERP não mexe mais.
        label_locked = label_locked OR (label IS DISTINCT FROM v_label)
       WHERE id = v_row.id;
      v_keep := v_keep || v_row.id;
    ELSE
      -- Telefone novo no CRM tem nome — é ele que diz com quem se fala. Exceção:
      -- o primeiro telefone de um lead que não tinha nenhum (é o do próprio lead).
      IF v_label IS NULL AND v_tinha > 0 THEN
        RAISE EXCEPTION 'label_required' USING ERRCODE = 'invalid_parameter_value';
      END IF;
      INSERT INTO public.lead_phones (organization_id, lead_id, phone, label, label_locked, source, created_by)
      VALUES (v_org, p_lead_id, btrim(v_item->>'phone'), v_label, v_label IS NOT NULL, 'crm', auth.uid())
      RETURNING * INTO v_row;
      v_keep := v_keep || v_row.id;
    END IF;
  END LOOP;

  -- O que saiu da lista é apagado (soft). Principal apagado deixa de ser principal.
  UPDATE public.lead_phones
     SET deleted_at = now(), deleted_by = auth.uid(), is_primary = false
   WHERE lead_id = p_lead_id AND deleted_at IS NULL AND NOT (id = ANY (v_keep));

  -- Principal: o espelho de leads.phone faz o resto. Comparação normalizada para
  -- não regravar leads.phone (21 gatilhos) só por formatação.
  IF v_primary IS NULL THEN
    IF v_lead_phone IS NOT NULL THEN
      UPDATE public.leads SET phone = NULL WHERE id = p_lead_id;
    END IF;
  ELSIF public.normalize_brazilian_phone(v_lead_phone) IS DISTINCT FROM public.normalize_brazilian_phone(v_primary) THEN
    IF NOT p_permitir_compartilhado THEN
      UPDATE public.leads SET phone = v_primary WHERE id = p_lead_id;
    ELSE
      -- Tenta o caminho normal. Só se o índice único recusar (outro lead vivo, NÃO
      -- compartilhado, já é o principal deste número) marca ESTE lead — nunca o
      -- dono. Detectar pelo próprio índice não depende do RLS do usuário: ele
      -- pode não enxergar o dono e o conflito existe igual. Número livre: não
      -- marca nada. A marca vai no mesmo UPDATE do telefone; o gatilho
      -- tg_leads_phone_compartilhado_guarda recusa se não houver dono e grava a
      -- trilha em lead_history. UPDATE sem linha = a RLS não deixa este usuário
      -- editar o lead: recusa em vez de devolver sucesso sem ter gravado.
      BEGIN
        UPDATE public.leads SET phone = v_primary WHERE id = p_lead_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'sem_permissao_lead' USING ERRCODE = '42501';
        END IF;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IS DISTINCT FROM 'idx_leads_org_phone_unique' THEN
          RAISE;
        END IF;
        UPDATE public.leads SET phone = v_primary, phone_compartilhado = true WHERE id = p_lead_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'sem_permissao_lead' USING ERRCODE = '42501';
        END IF;
      END;
    END IF;
  ELSE
    -- Mesmo número: garante a marca sem tocar em leads.
    UPDATE public.lead_phones SET is_primary = false
     WHERE lead_id = p_lead_id AND is_primary AND deleted_at IS NULL
       AND normalized_phone IS DISTINCT FROM public.normalize_brazilian_phone(v_primary);
    UPDATE public.lead_phones SET is_primary = true
     WHERE lead_id = p_lead_id AND deleted_at IS NULL
       AND normalized_phone = public.normalize_brazilian_phone(v_primary) AND NOT is_primary;
  END IF;

  RETURN QUERY SELECT * FROM public.lead_phones
                WHERE lead_id = p_lead_id AND deleted_at IS NULL
                ORDER BY is_primary DESC, label NULLS LAST, created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_telefones_do_lead(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_telefones_do_lead(uuid, jsonb, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. lead_phone_descompartilhar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_phone_descompartilhar(p_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_org    uuid;
  v_norm   text;
  v_marca  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sem_permissao_lead' USING ERRCODE = '42501';
  END IF;

  SELECT l.organization_id, l.normalized_phone, l.phone_compartilhado
    INTO v_org, v_norm, v_marca
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.assert_org_access(v_org);
  IF NOT (COALESCE(public.is_master_user(), false) OR public.can_update_lead(p_lead_id)) THEN
    RAISE EXCEPTION 'sem_permissao_lead' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: nada marcado, nada a desfazer.
  IF NOT v_marca THEN
    RETURN false;
  END IF;

  -- Serializa com quem mexe no mesmo numero na mesma org.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_phone:' || v_org::text || ':' || COALESCE(v_norm, ''), 0));

  -- Outro lead vivo, nao compartilhado, ja e dono do numero: voltar a ser
  -- "normal" duplicaria o principal. Recusa SEM dizer quem e (o chamador pode nao
  -- ver esse lead); o front consulta o dono com o RLS do usuario.
  IF v_norm IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.leads o
        WHERE o.organization_id = v_org
          AND o.id <> p_lead_id
          AND o.deleted_at IS NULL
          AND NOT o.phone_compartilhado
          AND o.normalized_phone = v_norm) THEN
    RAISE EXCEPTION 'principal_ocupado'
      USING ERRCODE = '23505', CONSTRAINT = 'idx_leads_org_phone_unique';
  END IF;

  UPDATE public.leads SET phone_compartilhado = false WHERE id = p_lead_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.lead_phone_descompartilhar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_phone_descompartilhar(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Gatilho: garantia de dono + trilha
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_leads_phone_compartilhado_guarda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_norm text := public.normalize_brazilian_phone(NEW.phone);
BEGIN
  -- Lead nasce NAO compartilhado: a marca so vem de salvar_telefones_do_lead (UPDATE).
  -- Sem isto um INSERT com a marca ligada furaria a garantia de dono abaixo.
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'phone_compartilhado_so_por_acao' USING ERRCODE = '23514';
  END IF;

  -- Garantia de dono: um numero compartilhado precisa ter ao menos um lead vivo
  -- NAO compartilhado segurando-o, senao o indice deixa de proteger o numero.
  IF NEW.phone_compartilhado AND NEW.deleted_at IS NULL THEN
    IF v_norm IS NULL
       OR NEW.organization_id IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM public.leads o
             WHERE o.organization_id = NEW.organization_id
               AND o.id <> NEW.id
               AND o.deleted_at IS NULL
               AND NOT o.phone_compartilhado
               AND o.normalized_phone = v_norm) THEN
      RAISE EXCEPTION 'phone_compartilhado_sem_dono' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
  VALUES (
    NEW.id,
    NEW.organization_id,
    CASE WHEN NEW.phone_compartilhado THEN 'phone_shared' ELSE 'phone_unshared' END,
    CASE WHEN NEW.phone_compartilhado THEN 'Número compartilhado com outro lead'
         ELSE 'Número deixou de ser compartilhado' END,
    'manual',
    jsonb_build_object('phone', v_norm),
    auth.uid()
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_leads_phone_compartilhado_guarda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leads_phone_compartilhado_guarda ON public.leads;
CREATE TRIGGER leads_phone_compartilhado_guarda
  BEFORE UPDATE OF phone_compartilhado ON public.leads
  FOR EACH ROW
  WHEN (NEW.phone_compartilhado IS DISTINCT FROM OLD.phone_compartilhado)
  EXECUTE FUNCTION public.tg_leads_phone_compartilhado_guarda();

-- O WHEN filtra antes de chamar a função: INSERT comum (marca false) não paga nada.
DROP TRIGGER IF EXISTS leads_phone_compartilhado_nasce_falso ON public.leads;
CREATE TRIGGER leads_phone_compartilhado_nasce_falso
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  WHEN (NEW.phone_compartilhado)
  EXECUTE FUNCTION public.tg_leads_phone_compartilhado_guarda();

-- ---------------------------------------------------------------------------
-- 4. api_create_lead: o 'conflict' devolve o DONO (deterministico)
--    CREATE OR REPLACE preserva a ACL (postgres + service_role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_create_lead(p_org uuid, p_lead jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_endpoint  constant text := 'POST /leads';
  v_existente uuid;
  v_novo      uuid;
  v_row       public.leads%ROWTYPE;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- 1. Replay. Só depois de confirmar que o recurso ainda existe: chave apontando
  --    para Lead apagado é chave morta, e devolver "replayed" com corpo vazio
  --    seria pior que criar de novo.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT k.resource_id INTO v_existente
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row FROM public.leads WHERE id = v_existente AND deleted_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'replayed',
          'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                                     'phone', v_row.phone, 'email', v_row.email));
      END IF;
    END IF;
  END IF;

  -- 2. Insere ou não insere — sem janela entre checar e escrever.
  --    O gatilho BEFORE normaliza o telefone antes da checagem de conflito, por
  --    isso o índice parcial casa.
  INSERT INTO public.leads (organization_id, name, phone, email, company, origin)
  VALUES (
    p_org,
    nullif(p_lead->>'name', ''),
    nullif(p_lead->>'phone', ''),
    nullif(p_lead->>'email', ''),
    nullif(p_lead->>'company', ''),
    coalesce(nullif(p_lead->>'origin', ''), 'api')
  )
  ON CONFLICT (organization_id, normalized_phone)
    WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL AND NOT phone_compartilhado
  DO NOTHING
  RETURNING id INTO v_novo;

  -- 3. Perdeu a corrida (ou já existia): devolve QUEM está lá, com o nome.
  --    Devolver o identificador é o que transforma a recusa em resposta útil —
  --    o chamador segue para abrir o Negócio sem uma chamada extra.
  IF v_novo IS NULL THEN
    -- Resolve pelo telefone recebido, normalizado pela MESMA função que o
    -- gatilho usa. Reescrever a normalização aqui seria garantir divergência, e
    -- a divergência apareceria como duplicata que "deveria" ter casado.
    SELECT * INTO v_row
      FROM public.leads
     WHERE organization_id = p_org
       AND deleted_at IS NULL
       AND normalized_phone = public.normalize_brazilian_phone(p_lead->>'phone')
     ORDER BY phone_compartilhado, created_at, id
     LIMIT 1;

    RETURN jsonb_build_object(
      'status', 'conflict',
      'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                                 'phone', v_row.phone, 'email', v_row.email));
  END IF;

  -- 4. Criou. Registra a chave; corrida na própria chave cai no ON CONFLICT.
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_novo)
    ON CONFLICT (organization_id, endpoint, idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.leads WHERE id = v_novo;
  RETURN jsonb_build_object(
    'status', 'created',
    'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                               'phone', v_row.phone, 'email', v_row.email));
END;
$function$;

COMMIT;
