-- 20271002000000_org_ajusta_o_que_e_dela.sql
--
-- Admin de organização volta a conseguir mudar as configurações da PRÓPRIA org
-- — e só essas três.
--
-- ── O DEFEITO, MEDIDO ──────────────────────────────────────────────────────
-- `public.organizations` tem três policies: `master_all_organizations` (ALL, só
-- master), `Users can see their organization` (SELECT) e
-- `master_select_all_organizations` (SELECT). **Nenhuma de UPDATE para
-- não-master.**
--
-- Medido em prod 2026-09-04, como `authenticated` com claims reais:
--     admin  -> SELECT 1 linha, UPDATE 0 linhas
--     master -> SELECT 1 linha, UPDATE 1 linha
--
-- `useOrganizationSettings.updateSettings` escreve direto na tabela e fecha com
-- `.select(...).single()`. Com 0 linhas o `.single()` estoura PGRST116, e o
-- hook lança. Quebra os quatro caminhos que dependem dele: prazo de vencimento
-- da confirmação, ciclo de recompra, escolher o funil padrão, e excluir o funil
-- padrão (o diálogo troca o padrão ANTES do delete). Para todo admin das ~30
-- orgs. Reportado como "Erro ao excluir funil".
--
-- ── POR QUE **NÃO** É UMA POLICY DE UPDATE ─────────────────────────────────
-- A ausência da policy não é esquecimento, é proteção. `organizations` guarda
-- `subscription_plan`, `subscription_status`, `payment_customer_id`,
-- `billing_override`, `limit_overrides`, `whatsapp_rate_limit`,
-- `daily_blast_budget`, `feature_flags`, `user_creation_key` e
-- `elevenlabs_api_key`.
--
-- Uma policy `FOR UPDATE USING (admin da org)` deixaria qualquer admin de
-- cliente se dar plano ilimitado, subir o próprio teto de disparo, ligar feature
-- flag e reescrever a própria cobrança. Seria escalação de privilégio vestida de
-- correção de bug. A tabela continua fechada.
--
-- O caminho é uma RPC ESTREITA, no molde de `set_org_chat_restriction`
-- (DEFINER + autorização explícita + auditoria), que toca só o que é ajuste de
-- operação. O front passa a chamá-la em vez de escrever na tabela.

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
    'default_pipeline_id'
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
           'default_pipeline_id',        o.default_pipeline_id)
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
                 'default_pipeline_id',        o.default_pipeline_id)
                 FROM public.organizations o WHERE o.id = p_org_id));
END;
$$;

COMMENT ON FUNCTION public.set_org_settings(uuid, jsonb) IS
  'Ajusta as 3 configurações de operação da org (prazo de confirmação, ciclo de recompra, funil padrão). Allowlist explícita: plano, cobrança, limites e flags NÃO passam por aqui. organizations segue sem policy de UPDATE de propósito.';

-- Função nova NASCE executável por causa do ALTER DEFAULT PRIVILEGES do schema
-- public, e REVOKE FROM PUBLIC não alcança papel com grant direto.
REVOKE ALL ON FUNCTION public.set_org_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_settings(uuid, jsonb) TO authenticated;
