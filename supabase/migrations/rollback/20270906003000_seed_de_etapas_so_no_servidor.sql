-- ROLLBACK de 20270906003000_seed_de_etapas_so_no_servidor.sql (SCRUM-618)
--
-- Restaura as DUAS funções às versões de prod capturadas em 2026-09-01
-- (pg_get_functiondef, jsjsmuncfkbsbzqzqhfq) — antes de o seed de etapas ser
-- movido para o servidor.
--
-- ⚠️ O que este rollback NÃO desfaz:
--   · Etapas inseridas pelo backfill de deriva do §3 (medição previa 0 orgs;
--     o NOTICE do apply diz quantas foram de fato). Elas são linhas default
--     legítimas — removê-las às cegas apagaria etapa em uso.
--   · O front: se o bundle sem `ensureDefaultStagesInDb` já estiver no ar,
--     reverter só o banco deixa funil recém-ativado nascer sem etapas.
--     Reverter aqui exige também segurar/reverter o deploy do front.

BEGIN;

-- Versão de prod (pré-SCRUM-618): semeia os 3 tipos incondicionalmente,
-- sem portão de registro e sem pipeline_id; propostas com 7 etapas.
CREATE OR REPLACE FUNCTION public.create_default_pipeline_stages(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Etapas do Pipeline WhatsApp/Qualificacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, target_pipe_type, target_stage_key) VALUES
    (org_id, 'whatsapp', 'novo', 'Novo', '#6366f1', 0, false, NULL, NULL),
    (org_id, 'whatsapp', 'abordado', 'Abordado', '#f59e0b', 1, false, NULL, NULL),
    (org_id, 'whatsapp', 'respondeu', 'Respondeu', '#3b82f6', 2, false, NULL, NULL),
    (org_id, 'whatsapp', 'esfriou', 'Esfriou', '#ef4444', 3, false, NULL, NULL),
    (org_id, 'whatsapp', 'agendado', 'Agendado', '#22c55e', 4, true, 'confirmacao', 'reuniao_marcada')
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Confirmacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative, target_pipe_type, target_stage_key) VALUES
    (org_id, 'confirmacao', 'reuniao_marcada', 'Reuniao Marcada', '#6366f1', 0, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d5', 'Confirmar D-5', '#8b5cf6', 1, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d3', 'Confirmar D-3', '#a855f7', 2, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d2', 'Confirmar D-2', '#f59e0b', 3, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d1', 'Confirmar D-1', '#f97316', 4, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmacao_no_dia', 'Confirmacao no Dia', '#ef4444', 5, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'remarcar', 'Remarcar', '#f97316', 6, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'compareceu', 'Compareceu', '#22c55e', 7, true, false, 'propostas', 'marcar_compromisso'),
    (org_id, 'confirmacao', 'perdido', 'Perdido', '#ef4444', 8, false, true, NULL, NULL)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Propostas
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'propostas', 'marcar_compromisso', 'Marcar Compromisso', '#F5C518', 0, false, false),
    (org_id, 'propostas', 'reativar', 'Reativar', '#F97316', 1, false, false),
    (org_id, 'propostas', 'compromisso_marcado', 'Compromisso Marcado', '#3B82F6', 2, false, false),
    (org_id, 'propostas', 'esfriou', 'Esfriou', '#64748B', 3, false, false),
    (org_id, 'propostas', 'futuro', 'Futuro', '#8B5CF6', 4, false, false),
    (org_id, 'propostas', 'vendido', 'Vendido', '#22C55E', 5, true, false),
    (org_id, 'propostas', 'perdido', 'Perdido', '#EF4444', 6, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- As etapas dos dois funis de Carteira saíram daqui em 20270805000010.
  -- Funil aposentado (ADR-0023 §8): org nova não nasce mais com ele.
  -- (Sem citar os nomes de propósito: a prova (d) lê o corpo desta função.)
END;
$function$;

COMMENT ON FUNCTION public.create_default_pipeline_stages(uuid) IS NULL;

-- Versão de prod (pré-SCRUM-618): não semeia etapas.
CREATE OR REPLACE FUNCTION public.enable_system_pipeline(p_org_id uuid, p_pipe_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text;
  v_pos  integer;
BEGIN
  -- SECURITY DEFINER bypassa RLS: a autorização é reimplementada aqui.
  -- `current_setting('role')` é a convenção do repo para a chave de serviço.
  -- Numa conexão direta (Management API) ela vale 'none', não 'service_role' —
  -- então SQL administrativo não passa por aqui de graça.
  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  SELECT d.nome, d.pos INTO v_nome, v_pos
    FROM (VALUES
      ('whatsapp',    'Oportunidades', 1),
      ('confirmacao', 'Agendamentos',  2),
      ('propostas',   'Orçamentos',    3),
      ('upsell',      'Carteira',      4)
    ) AS d(tipo, nome, pos)
   WHERE d.tipo = p_pipe_type;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: reativar algo que já existe só religa a visibilidade, sem
  -- reescrever o nome que a org tenha personalizado.
  INSERT INTO public.pipeline_display_config
    (organization_id, pipe_type, display_name, is_visible, position)
  VALUES
    (p_org_id, p_pipe_type, v_nome, true, v_pos)
  ON CONFLICT (organization_id, pipe_type)
  DO UPDATE SET is_visible = true, updated_at = now();

  -- Agora que o registro autoriza, o espelho pode nascer.
  PERFORM public.create_default_pipelines(p_org_id);

  RETURN jsonb_build_object(
    'pipe_type',    p_pipe_type,
    'display_name', v_nome,
    'pipeline_id',  (SELECT id FROM public.pipelines
                      WHERE organization_id = p_org_id
                        AND slug = p_pipe_type
                        AND type = 'system') -- metric-lint-allow: não é métrica — é a devolução do id da linha de REGISTRO que esta própria função acabou de garantir. O predicado `type='system'` aqui não cega funil custom: ele DESAMBIGUA, porque `pipelines` é a união dos dois modelos e um funil custom pode ter o mesmo slug (`whatsapp`) numa org. Sem ele a função devolveria o id do funil errado. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir.
  );
END;
$function$;

COMMIT;
