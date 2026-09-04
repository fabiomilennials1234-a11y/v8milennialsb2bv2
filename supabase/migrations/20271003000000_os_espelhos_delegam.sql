-- 20271003000000_os_espelhos_delegam.sql
--
-- SCRUM-674, passo 2 de 4. NÃO MUDA COMPORTAMENTO.
--
-- Os 8 INSTEAD OF de INSERT/UPDATE das entradas passam a DELEGAR às funções
-- compartilhadas criadas no passo 1 (20270930000000). Nenhuma regra é reescrita:
-- cada trigger vira um adaptador que traduz a forma legada da view para os
-- parâmetros da função.
--
-- ── POR QUE ESTE PASSO EXISTE ──────────────────────────────────────────────
-- Ele não entrega valor sozinho. Existe para que o passo 3 — as 5 escritoras SQL
-- deixarem de escrever pelas views — seja provavelmente correto em vez de
-- esperançosamente correto: a partir daqui, escrever PELA VIEW e escrever PELA
-- FUNÇÃO executam literalmente as mesmas linhas. A equivalência do passo 3 vira
-- propriedade de construção, não resultado de teste.
--
-- ── O QUE FICA NA VIEW, E POR QUÊ ──────────────────────────────────────────
-- `assigned_to` continua sendo derivado AQUI, por COALESCE, com a regra própria
-- de cada funil:
--     whatsapp     responsável, e na falta dele o SDR
--     confirmacao  responsável, e na falta dele o closer, e na falta dele o SDR
--     propostas    responsável, e na falta dele o closer
-- (a cadeia literal está no corpo de cada adaptador abaixo; escrevê-la aqui em
--  sintaxe SQL fazia o lint de métricas acusar o próprio comentário)
-- A função compartilhada NÃO deriva (decisão do CTO: derivar moveria de 2.800 a
-- 7.900 cards de dono, vazando card a card). Mantendo a derivação no adaptador,
-- o comportamento de hoje fica intacto E o vocabulário legado morre junto com a
-- view, em vez de contaminar o código que sobrevive.
--
-- Mesma lógica para o trio `responsible_id`/`sdr_id`/`closer_id`: ele continua
-- entrando no metadata, mas pela mão da VIEW, via `p_metadata`. A função
-- compartilhada só conhece o par `pre_sale`/`sale`.
--
-- ── ESCOPO ─────────────────────────────────────────────────────────────────
-- 8 dos 18 triggers: os de INSERT/UPDATE das ENTRADAS (3 funis de sistema +
-- custom_pipe_entries). Os 6 de DELETE já são repasse puro e não mudam. Os 4 de
-- `custom_pipelines` e `custom_pipeline_stages` ficam para depois: as 5
-- escritoras do passo 3 não passam por eles, e o front vai por RPC (SCRUM-673).

-- ───────────────────────────────────────────────────────────────────────────
-- pipe_whatsapp
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.id := public.fn_entrada_sistema_criar(
    p_organization_id         => NEW.organization_id,
    p_slug                    => 'whatsapp',
    p_lead_id                 => NEW.lead_id,
    p_stage_key               => COALESCE(NEW.status, 'novo_lead'),
    -- A derivação legada mora aqui, não na função compartilhada.
    p_assigned_to             => COALESCE(NEW.responsible_id, NEW.sdr_id),  -- metric-lint-allow: cópia literal do COALESCE vigente; ver cabeçalho
    p_pre_sale_responsible_id => NEW.pre_sale_responsible_id,
    p_sale_responsible_id     => NEW.sale_responsible_id,
    p_metadata                => jsonb_build_object(
      'responsible_id', NEW.responsible_id,
      'sdr_id',         NEW.sdr_id,
      'scheduled_date', NEW.scheduled_date),
    p_notes                   => NEW.notes,
    p_id                      => NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_entrada_sistema_atualizar(OLD.id, jsonb_build_object(
    'stage_key',   NEW.status,
    'notes',       NEW.notes,
    'assigned_to', COALESCE(NEW.responsible_id, NEW.sdr_id),  -- metric-lint-allow: cópia literal do COALESCE vigente; ver cabeçalho
    'responsible_id',          NEW.responsible_id,
    'sdr_id',                  NEW.sdr_id,
    'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
    'sale_responsible_id',     NEW.sale_responsible_id,
    'scheduled_date',          NEW.scheduled_date));
  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- pipe_confirmacao
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.id := public.fn_entrada_sistema_criar(
    p_organization_id         => NEW.organization_id,
    p_slug                    => 'confirmacao',
    p_lead_id                 => NEW.lead_id,
    p_stage_key               => COALESCE(NEW.status, 'marcada'),
    p_assigned_to             => COALESCE(NEW.responsible_id, NEW.closer_id, NEW.sdr_id),  -- metric-lint-allow: cópia literal do COALESCE vigente; ver cabeçalho
    p_pre_sale_responsible_id => NEW.pre_sale_responsible_id,
    p_sale_responsible_id     => NEW.sale_responsible_id,
    p_metadata                => jsonb_build_object(
      'meeting_date',      NEW.meeting_date,
      -- COALESCE preservado: a view grava `false`, não nulo, quando não vem.
      'is_confirmed',      COALESCE(NEW.is_confirmed, false),
      'closer_id',         NEW.closer_id,
      'responsible_id',    NEW.responsible_id,
      'sdr_id',            NEW.sdr_id,
      'meet_link',         NEW.meet_link,
      'metrics_period_at', NEW.metrics_period_at),
    p_notes                   => NEW.notes,
    p_id                      => NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_entrada_sistema_atualizar(OLD.id, jsonb_build_object(
    'stage_key',   NEW.status,
    'notes',       NEW.notes,
    'assigned_to', COALESCE(NEW.responsible_id, NEW.closer_id, NEW.sdr_id),  -- metric-lint-allow: cópia literal do COALESCE vigente; ver cabeçalho
    'meeting_date',            NEW.meeting_date,
    -- No UPDATE a view NÃO faz COALESCE: grava o que veio, inclusive nulo.
    'is_confirmed',            NEW.is_confirmed,
    'closer_id',               NEW.closer_id,
    'responsible_id',          NEW.responsible_id,
    'sdr_id',                  NEW.sdr_id,
    'meet_link',               NEW.meet_link,
    'metrics_period_at',       NEW.metrics_period_at,
    'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
    'sale_responsible_id',     NEW.sale_responsible_id));
  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- pipe_propostas
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pipe_propostas_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.id := public.fn_entrada_sistema_criar(
    p_organization_id         => NEW.organization_id,
    p_slug                    => 'propostas',
    p_lead_id                 => NEW.lead_id,
    p_stage_key               => COALESCE(NEW.status, 'enviada'),
    p_assigned_to             => COALESCE(NEW.responsible_id, NEW.closer_id),  -- metric-lint-allow: cópia literal do COALESCE vigente; ver cabeçalho
    p_pre_sale_responsible_id => NEW.pre_sale_responsible_id,
    p_sale_responsible_id     => NEW.sale_responsible_id,
    p_metadata                => jsonb_build_object(
      'sale_value',        NEW.sale_value,
      'closer_id',         NEW.closer_id,
      'responsible_id',    NEW.responsible_id,
      'product_id',        NEW.product_id,
      'product_type',      NEW.product_type,
      'calor',             NEW.calor,
      'loss_reason',       NEW.loss_reason,
      'loss_reason_id',    NEW.loss_reason_id,
      'commitment_date',   NEW.commitment_date,
      'contract_duration', NEW.contract_duration,
      'metrics_period_at', NEW.metrics_period_at),
    p_notes                   => NEW.notes,
    p_closed_at               => NEW.closed_at,
    p_id                      => NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pipe_propostas_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_entrada_sistema_atualizar(OLD.id, jsonb_build_object(
    'stage_key',   NEW.status,
    'notes',       NEW.notes,
    'closed_at',   NEW.closed_at,
    'assigned_to', COALESCE(NEW.responsible_id, NEW.closer_id),  -- metric-lint-allow: cópia literal do COALESCE vigente; ver cabeçalho
    'sale_value',              NEW.sale_value,
    'closer_id',               NEW.closer_id,
    'responsible_id',          NEW.responsible_id,
    'product_id',              NEW.product_id,
    'product_type',            NEW.product_type,
    'calor',                   NEW.calor,
    'loss_reason',             NEW.loss_reason,
    'loss_reason_id',          NEW.loss_reason_id,
    'commitment_date',         NEW.commitment_date,
    'contract_duration',       NEW.contract_duration,
    'metrics_period_at',       NEW.metrics_period_at,
    'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
    'sale_responsible_id',     NEW.sale_responsible_id));
  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- custom_pipe_entries
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.custom_pipe_entries_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.id := public.fn_entrada_custom_criar(
    p_organization_id         => NEW.organization_id,
    p_pipeline_id             => NEW.pipeline_id,
    p_lead_id                 => NEW.lead_id,
    p_stage_id                => NEW.stage_id,
    p_assigned_to             => NEW.assigned_to,
    p_pre_sale_responsible_id => NEW.pre_sale_responsible_id,
    p_sale_responsible_id     => NEW.sale_responsible_id,
    p_deal_id                 => NEW.deal_id,
    p_notes                   => NEW.notes,
    p_entered_at              => NEW.entered_at,
    p_stage_changed_at        => NEW.stage_changed_at,
    p_id                      => NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_pipe_entries_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_entrada_custom_atualizar(OLD.id, jsonb_build_object(
    'pipeline_id',      NEW.pipeline_id,
    'lead_id',          NEW.lead_id,
    -- `stage_id` no patch é o que faz a função derivar `stage_key` junto, e é
    -- ele que mantém os AFTER ... OF stage_key elegíveis.
    'stage_id',         NEW.stage_id,
    'deal_id',          NEW.deal_id,
    'assigned_to',      NEW.assigned_to,
    'notes',            NEW.notes,
    'entered_at',       NEW.entered_at,
    'stage_changed_at', NEW.stage_changed_at,
    'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
    'sale_responsible_id',     NEW.sale_responsible_id));
  RETURN NEW;
END;
$$;
