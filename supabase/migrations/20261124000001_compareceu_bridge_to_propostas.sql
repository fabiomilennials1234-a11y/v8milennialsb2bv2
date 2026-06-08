-- 20261124000001_compareceu_bridge_to_propostas.sql
--
-- Slice 5 do merge Agendamentos → Oportunidades (ADR-0004, issue #718).
--
-- Aponta o stage `compareceu` (final positivo do funil mergeado) para Orçamentos.
-- Com target_pipe_type='propostas', o handler de move existente
-- (PipeWhatsapp.handleStatusChange) auto-cria a entry em pipe_propostas — a ponte
-- Compareceu→Orçamentos sai de graça via config, sem trigger novo.
--
-- Também corrige o bug latente da Slice 1: sem target, `compareceu` caía no
-- fallback 'confirmacao' e abria o modal de confirmacao legacy ao mover o card.
--
-- Scoped Milennials. Idempotente (UPDATE).

UPDATE public.pipeline_stages
SET target_pipe_type = 'propostas',
    target_stage_key = 'marcar_compromisso',
    updated_at       = NOW()
WHERE organization_id = '6030520a-2ca7-477d-be89-55758e2cd808'
  AND pipeline_type = 'whatsapp'
  AND stage_key = 'compareceu';
