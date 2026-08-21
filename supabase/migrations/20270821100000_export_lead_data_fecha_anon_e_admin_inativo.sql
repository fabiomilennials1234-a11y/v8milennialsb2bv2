-- ===========================================================================
-- SCRUM-326 — export_lead_data: fecha anon, ex-admin e o LIMIT 1 multi-org
-- ===========================================================================
-- Migration: 20270821100000_export_lead_data_fecha_anon_e_admin_inativo.sql
--
-- MEDIDO EM PRODUÇÃO (leitura) em 2026-08-21, antes de escrever qualquer linha:
--
--   export_lead_data(uuid)  prosecdef = true
--   proacl = {=X/postgres, postgres=X/postgres, anon=X/postgres,
--             authenticated=X/postgres, service_role=X/postgres}
--
-- O `=X/postgres` (grantee vazio) é PUBLIC. Então os DOIS caminhos de grant
-- descritos no SCRUM-326 estão presentes ao mesmo tempo: o implícito por PUBLIC
-- e o nominal a `anon`. Revogar de um só lado deixa a função aberta pelo outro
-- — é o que fez `import_lead_into_custom_pipeline` ficar executável por anon em
-- prod por 40s em 2026-07-29. Aquela hoje está correta
-- (`{postgres=X/postgres, service_role=X/postgres}`) e serviu de alvo aqui.
--
-- 🟢 CORREÇÃO DE SEVERIDADE, e ela importa para quem for ler o cartão:
-- `anon` NÃO consegue extrair dado. O corpo resolve `auth.uid()`, que para anon
-- é NULL, não acha linha em `team_members` e levanta 'Unauthorized'. O grant
-- errado é falha de profundidade — perigosa no dia em que alguém editar o corpo,
-- não hoje. O cartão dizia "🔴 é executável por anon": verdade literal,
-- exploração não.
--
-- 🔴 O QUE O CARTÃO NÃO VIU, e é o dano real. O gate do corpo é:
--
--     WHERE tm.user_id = auth.uid() AND tm.role = 'admin' LIMIT 1
--
-- Sem `is_active`. Medido em prod: de 183 admins, **15 estão DESATIVADOS** — e
-- todos eles continuam podendo exportar o lead inteiro: linha do lead, tags,
-- histórico, CONVERSAS COM MENSAGENS e registros de consentimento. Ex-funcionário
-- com login vivo lê PII da carteira que administrava.
--
-- E o `LIMIT 1` escolhe uma organização ARBITRÁRIA entre as do admin. Medido:
-- **2 admins pertencem a mais de uma org**. Para eles, exportar lead da org que
-- o LIMIT não sorteou devolve NULL em silêncio — parece "lead não existe".
--
-- ===========================================================================
-- 1 — O CORPO
-- ===========================================================================
-- Duas mudanças, e a segunda conserta o multi-org de graça:
--
--   (a) a autorização passa a exigir admin ATIVO, via
--       `get_my_team_admin_organization_ids()`. Essa helper é `role = 'admin'
--       AND is_active = true`, e nada mais.
--
--       ⚠ NÃO usar `get_my_admin_organization_ids()`: os nomes não distinguem,
--       mas os corpos sim — a segunda inclui GESTOR DE PORTFÓLIO (ADR-0021),
--       papel escopado a funis, que não deve exportar PII de lead. Usar a
--       errada aqui ALARGARIA o acesso enquanto o commit diz que o fecha.
--
--   (b) a organização deixa de ser sorteada do usuário e passa a vir do LEAD.
--       Pergunta certa: "quem chama é admin ativo DESTA org?" — em vez de
--       "qual org do chamador eu pego primeiro?". Multi-org passa a funcionar,
--       e o escopo continua fechado.
--
-- Comportamento que MUDA de propósito: ex-admin passa a receber 'Unauthorized'
-- (antes exportava), e admin de duas orgs passa a exportar das duas (antes uma
-- delas devolvia NULL calado). Os dois são a correção, não efeito colateral.
CREATE OR REPLACE FUNCTION public.export_lead_data(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public, extensions'
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  -- A org vem do LEAD. Se o lead não existe, não há o que autorizar — e
  -- responder 'Unauthorized' aqui também evita virar oráculo de existência de
  -- id para quem ficar sondando.
  SELECT l.organization_id INTO v_org_id FROM public.leads l WHERE l.id = p_lead_id;

  IF v_org_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.get_my_team_admin_organization_ids() AS t(org_id)
       WHERE t.org_id = v_org_id
     )
  THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'lead', row_to_json(l),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name)
      FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lead_id = p_lead_id
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(row_to_json(lh) ORDER BY lh.created_at)
      FROM lead_history lh WHERE lh.lead_id = p_lead_id
    ), '[]'::jsonb),
    'conversations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversation', row_to_json(c),
        'messages', COALESCE((
          SELECT jsonb_agg(row_to_json(cm) ORDER BY cm.created_at)
          FROM conversation_messages cm WHERE cm.conversation_id = c.id
        ), '[]'::jsonb)
      ))
      FROM conversations c WHERE c.lead_id = p_lead_id
    ), '[]'::jsonb),
    'consents', COALESCE((
      SELECT jsonb_agg(row_to_json(cr))
      FROM consent_records cr WHERE cr.lead_id = p_lead_id
    ), '[]'::jsonb),
    'exported_at', now(),
    'exported_by', auth.uid()
  ) INTO v_result
  FROM leads l
  WHERE l.id = p_lead_id AND l.organization_id = v_org_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.export_lead_data(uuid) IS
  'Exportação LGPD do lead (SCRUM-326). Autorização: admin ATIVO da org DO LEAD, '
  'via get_my_team_admin_organization_ids() — nunca get_my_admin_organization_ids(), '
  'que inclui gestor de portfólio. Chamada pelo navegador em '
  'src/shared/hooks/useDataExport.ts (useExportLeadData), logo `authenticated` '
  'MANTÉM o grant de propósito.';

-- ===========================================================================
-- 2 — GRANTS
-- ===========================================================================
-- ⚠ AQUI A RECEITA PADRÃO DOS "TRÊS REVOKES" NÃO SE APLICA INTEIRA, e seguir a
-- rubric ao pé da letra quebraria uma funcionalidade de usuário.
--
-- `authenticated` é o chamador LEGÍTIMO: `useExportLeadData` chama por
-- `supabase.rpc` a partir do navegador do admin logado. Revogar `authenticated`
-- não fecharia buraco nenhum (o corpo já gateia) e apagaria o botão de
-- exportação — inclusive a mensagem "Erro ao exportar dados — verifique
-- permissões de admin", que existe justamente porque o corpo é quem nega.
--
-- Fecham-se os dois caminhos que dão acesso a QUEM NÃO ESTÁ LOGADO:
REVOKE ALL     ON FUNCTION public.export_lead_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_lead_data(uuid) FROM anon;

-- E reafirma-se quem deve continuar podendo:
GRANT EXECUTE ON FUNCTION public.export_lead_data(uuid) TO authenticated, service_role;

-- ===========================================================================
-- 3 — GUARDA (aborta a transação)
-- ===========================================================================
-- O grant é concedido pelo BANCO no momento do CREATE, não por este SQL.
-- Migration verde não prova nada aqui — foi exatamente assim que a
-- import_lead_into_custom_pipeline subiu "corrigida" e ficou aberta.
DO $guard$
DECLARE
  v_fn regprocedure := 'public.export_lead_data(uuid)'::regprocedure;
  v_prosrc text;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon ainda executa % — o REVOKE não pegou pelos dois caminhos', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated NÃO executa % — a exportação do admin quebrou', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: service_role NÃO executa %', v_fn;
  END IF;

  -- O corpo tem de estar usando a helper ESTREITA. Trocar por
  -- get_my_admin_organization_ids() alargaria o acesso a gestor de portfólio
  -- sem que nada no diff parecesse errado.
  SELECT p.prosrc INTO v_prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'export_lead_data';

  IF position('get_my_team_admin_organization_ids' IN v_prosrc) = 0 THEN
    RAISE EXCEPTION 'GUARDA: o corpo não usa get_my_team_admin_organization_ids';
  END IF;
  IF position('LIMIT 1' IN v_prosrc) > 0 THEN
    RAISE EXCEPTION 'GUARDA: o LIMIT 1 do sorteio de org voltou ao corpo';
  END IF;
END
$guard$;
