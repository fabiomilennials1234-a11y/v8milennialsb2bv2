-- 20271104120000_org_interface_nova.sql
--
-- A organização escolhe a interface: a nova (V5) ou a clássica.
--
-- Decisão do CTO (2026-10-03): um switch em Configurações › Geral, por
-- organização. Ligado = interface nova; desligado = clássica. O front serve as
-- duas builds na mesma origem e escolhe pelo cookie `torque_ui`; quem decide o
-- cookie é esta coluna (ver docs/ui-v5/interface-por-organizacao.md).
--
-- ── O QUE MUDA ─────────────────────────────────────────────────────────────
-- 1. `organizations.ui_v5_enabled boolean NOT NULL DEFAULT false`. Todo mundo
--    nasce na clássica; o padrão é o que já está em produção.
-- 2. `set_org_settings` aceita a chave `ui_v5_enabled`, com o mesmo gate de
--    sempre (admin ATIVO da org ou master) e a mesma trilha em
--    `permission_audit_log`. O corpo abaixo é o da 20271002000000 — conferido
--    byte a byte contra prod em 2026-10-03 — mais a quarta chave.
--
-- ── POR QUE AQUI E NÃO EM `feature_flags` ──────────────────────────────────
-- `feature_flags` é do master (plano/entitlement) e `organizations` não tem
-- policy de UPDATE para admin — de propósito. A interface é escolha de operação
-- da própria org, então entra pela RPC estreita, como o prazo de confirmação.
--
-- ── SEM DML ────────────────────────────────────────────────────────────────
-- Milennials e TorqueCRM começam ligadas, mas isso é DADO: depois do apply, o
-- próprio switch liga as duas (ou o UPDATE de duas linhas, rodado à parte).
-- Migration aqui é só schema (guarda F4).
--
-- ── ORDEM DE DEPLOY ────────────────────────────────────────────────────────
-- O front trata coluna ausente como "clássica". Front antes da migration =
-- todo mundo na clássica; nada quebra.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ui_v5_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.ui_v5_enabled IS
  'Interface da organização: true = nova (V5), false = clássica. Escrita só por set_org_settings (admin da org ou master).';

CREATE OR REPLACE FUNCTION public.set_org_settings(
  p_org_id uuid,
  p_patch  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Allowlist EXPLÍCITA. Chave fora daqui é recusada com erro, nunca ignorada
  -- em silêncio: ignorar transformaria um patch com `subscription_plan` numa
  -- tentativa que "passou" sem efeito, e ninguém investiga o que passou.
  c_permitidas constant text[] := ARRAY[
    'confirmacao_overdue_days',
    'default_reorder_cycle_days',
    'default_pipeline_id',
    'ui_v5_enabled'
  ];
  v_chave      text;
  v_intrusas   text[] := '{}';
  v_old        jsonb;
  v_dias       int;
  v_ciclo      int;
  v_pipe       uuid;
BEGIN
  IF p_org_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'set_org_settings: argumentos obrigatórios' USING ERRCODE = '22023';
  END IF;

  FOR v_chave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_chave = ANY (c_permitidas)) THEN
      v_intrusas := v_intrusas || v_chave;
    END IF;
  END LOOP;
  IF array_length(v_intrusas, 1) > 0 THEN
    RAISE EXCEPTION 'set_org_settings: campo(s) não permitido(s): %. Esta função só ajusta configuração de operação; plano, cobrança, limites e flags não passam por aqui.',
      array_to_string(v_intrusas, ', ') USING ERRCODE = '42501';
  END IF;

  -- Autorização no molde de set_org_chat_restriction.
  IF NOT (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members
       WHERE user_id = auth.uid()
         AND organization_id = p_org_id
         AND role = 'admin'
         AND is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'forbidden: apenas admin da organização ajusta estas configurações'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'confirmacao_overdue_days',   o.confirmacao_overdue_days,
           'default_reorder_cycle_days', o.default_reorder_cycle_days,
           'default_pipeline_id',        o.default_pipeline_id,
           'ui_v5_enabled',              o.ui_v5_enabled)
    INTO v_old
    FROM public.organizations o WHERE o.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organização não encontrada' USING ERRCODE = '02000';
  END IF;

  -- Faixas validadas no SERVIDOR. O front já limita 1..365, mas limite que só
  -- existe no cliente não é limite.
  IF p_patch ? 'confirmacao_overdue_days' THEN
    v_dias := (p_patch->>'confirmacao_overdue_days')::int;
    IF v_dias IS NULL OR v_dias < 1 OR v_dias > 365 THEN
      RAISE EXCEPTION 'confirmacao_overdue_days fora da faixa (1..365): %', v_dias
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.organizations SET confirmacao_overdue_days = v_dias WHERE id = p_org_id;
  END IF;

  IF p_patch ? 'default_reorder_cycle_days' THEN
    v_ciclo := (p_patch->>'default_reorder_cycle_days')::int;
    IF v_ciclo IS NULL OR v_ciclo < 1 OR v_ciclo > 365 THEN
      RAISE EXCEPTION 'default_reorder_cycle_days fora da faixa (1..365): %', v_ciclo
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.organizations SET default_reorder_cycle_days = v_ciclo WHERE id = p_org_id;
  END IF;

  -- `null` explícito é escolha válida: org "sem funil padrão" (D4 — lead entra
  -- sem card). Presença da chave decide; ausência não encosta no valor.
  IF p_patch ? 'default_pipeline_id' THEN
    v_pipe := NULLIF(p_patch->>'default_pipeline_id', '')::uuid;
    IF v_pipe IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.pipelines
       WHERE id = v_pipe AND organization_id = p_org_id AND is_active
    ) THEN
      -- Sem esta guarda, um admin apontaria o padrão da própria org para um
      -- funil de OUTRA organização.
      RAISE EXCEPTION 'funil % não pertence a esta organização ou está inativo', v_pipe
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.organizations SET default_pipeline_id = v_pipe WHERE id = p_org_id;
  END IF;

  -- Booleano de verdade: `"true"` em string, `1` ou `null` são recusados — um
  -- `::boolean` frouxo aceitaria 'yes'/'on' e um null apagaria a escolha.
  IF p_patch ? 'ui_v5_enabled' THEN
    IF jsonb_typeof(p_patch->'ui_v5_enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'ui_v5_enabled precisa ser booleano: %', p_patch->'ui_v5_enabled'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.organizations
       SET ui_v5_enabled = (p_patch->>'ui_v5_enabled')::boolean
     WHERE id = p_org_id;
  END IF;

  INSERT INTO public.permission_audit_log
    (organization_id, changed_by_user_id, changed_by_role, table_name,
     permission_key, role, old_enabled, new_enabled)
  VALUES
    (p_org_id, auth.uid(),
     CASE WHEN public.is_master_user() THEN 'master' ELSE 'admin' END,
     'organizations', 'set_org_settings:' || array_to_string(ARRAY(SELECT jsonb_object_keys(p_patch)), ','),
     'admin', NULL, NULL);

  RETURN jsonb_build_object(
    'antes', v_old,
    'depois', (SELECT jsonb_build_object(
                 'confirmacao_overdue_days',   o.confirmacao_overdue_days,
                 'default_reorder_cycle_days', o.default_reorder_cycle_days,
                 'default_pipeline_id',        o.default_pipeline_id,
                 'ui_v5_enabled',              o.ui_v5_enabled)
                 FROM public.organizations o WHERE o.id = p_org_id));
END;
$$;

COMMENT ON FUNCTION public.set_org_settings(uuid, jsonb) IS
  'Ajusta as configurações de operação da org (prazo de confirmação, ciclo de recompra, funil padrão, interface nova/clássica). Allowlist explícita: plano, cobrança, limites e flags NÃO passam por aqui. organizations segue sem policy de UPDATE de propósito.';

-- CREATE OR REPLACE com a mesma assinatura preserva os grants, mas a
-- 20271002000000 mostrou que função DEFINER nasce executável por papel com
-- grant direto — repete o fecho para o arquivo valer sozinho.
REVOKE ALL ON FUNCTION public.set_org_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_settings(uuid, jsonb) TO authenticated;
