-- =============================================================================
-- Migration: conversations.ai_state FSM — Takeover IA↔Humano
--
-- Propósito:
--   Adiciona FSM explícita de controle de takeover humano/IA em conversations.
--   Coluna distinta de conversations.state (FSM do copilot — IDLE/ACTIVE/etc).
--   ai_state controla QUEM está no controle da conversa: IA ou humano.
--
-- Enum: ai_takeover_state_enum
--   AI_ACTIVE        — IA controla, responde automaticamente
--   AI_PAUSED_MANUAL — Humano pausou a IA manualmente
--   WAITING_HUMAN    — IA pediu intervenção humana
--   HUMAN_ACTIVE     — Humano assumiu e está respondendo
--   HANDOFF_BACK     — Humano liberando controle de volta pra IA
--
-- Transições permitidas (enforced por trigger):
--   AI_ACTIVE        → AI_PAUSED_MANUAL  (humano pausa)
--   AI_ACTIVE        → WAITING_HUMAN     (IA pede humano)
--   AI_PAUSED_MANUAL → AI_ACTIVE         (humano retoma IA)
--   AI_PAUSED_MANUAL → HUMAN_ACTIVE      (humano respondeu enquanto pausado)
--   WAITING_HUMAN    → HUMAN_ACTIVE      (humano assumiu)
--   WAITING_HUMAN    → AI_ACTIVE         (humano cancela espera, retorna pra IA)
--   HUMAN_ACTIVE     → HANDOFF_BACK      (humano libera pra IA)
--   HUMAN_ACTIVE     → AI_PAUSED_MANUAL  (humano decide manter pausa sem handoff)
--   HANDOFF_BACK     → AI_ACTIVE         (IA retomou de fato)
--
-- Segurança:
--   SECURITY DEFINER na função de trigger para validação de transições.
--   RLS existente em conversations (conversations_update_by_responsibility)
--   já garante que só membros da org + admins fazem UPDATE. Não alterada.
--
-- Reversão (DOWN):
--   DROP TRIGGER IF EXISTS trg_enforce_ai_state_transition ON public.conversations;
--   DROP FUNCTION IF EXISTS public.enforce_ai_state_transition();
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS ai_state_updated_by;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS ai_state_updated_at;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS ai_state_resume_mode;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS ai_state;
--   DROP INDEX IF EXISTS idx_conversations_ai_state_org;
--   DROP TYPE IF EXISTS public.ai_takeover_state_enum;
--
-- Autor: DBA (agent-dba) — Onda 2b Chat
-- Data: 2026-04-22
-- Branch: feat/chat-ux-ui-redesign
-- =============================================================================

-- ============================================================
-- PARTE 1: ENUM TYPE
-- Idempotente — ignora se já existe.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.ai_takeover_state_enum AS ENUM (
    'AI_ACTIVE',
    'AI_PAUSED_MANUAL',
    'WAITING_HUMAN',
    'HUMAN_ACTIVE',
    'HANDOFF_BACK'
  );
EXCEPTION WHEN duplicate_object THEN
  -- Enum já existe. Não falhar — migration é idempotente.
  NULL;
END $$;

-- ============================================================
-- PARTE 2: COLUNAS EM conversations
-- ADD COLUMN IF NOT EXISTS — safe em produção.
-- Não trava tabela para ADD com DEFAULT estático no Postgres 11+.
-- ============================================================

-- Coluna principal: estado atual de controle
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_state public.ai_takeover_state_enum
    NOT NULL
    DEFAULT 'AI_ACTIVE';

-- Modo de retomada quando IA for pausada manualmente
-- 'immediate'       — IA retoma imediatamente quando humano liberar
-- 'after_response'  — IA retoma somente após a próxima resposta do lead
-- 'dont_resume'     — IA não retoma automaticamente (membro precisa acionar)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_state_resume_mode TEXT
    DEFAULT NULL
    CHECK (
      ai_state_resume_mode IS NULL
      OR ai_state_resume_mode IN ('immediate', 'after_response', 'dont_resume')
    );

-- Timestamp da última transição de estado
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_state_updated_at TIMESTAMPTZ
    DEFAULT now();

-- Rastreamento de quem alterou o ai_state (humano que pausou/retomou)
-- NULL = alterado por processo automático (IA ou sistema)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_state_updated_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- PARTE 3: BACKFILL
--
-- ai_disabled está em leads (não em conversations). Precisamos
-- fazer JOIN via conversations.lead_id para ler leads.ai_disabled.
--
-- Lógica:
--   lead.ai_disabled = true  → AI_PAUSED_MANUAL (IA foi desabilitada para esse lead)
--   lead.ai_disabled = false → AI_ACTIVE (estado padrão)
--   lead não encontrado      → mantém AI_ACTIVE (DEFAULT já aplicado)
--
-- UPDATE condicional: só toca rows onde ai_state ainda está no DEFAULT
-- e o lead tem ai_disabled = true. Idempotente: se rodar 2x não muda nada.
-- ============================================================

UPDATE public.conversations c
SET
  ai_state = 'AI_PAUSED_MANUAL'::public.ai_takeover_state_enum,
  ai_state_updated_at = now()
FROM public.leads l
WHERE c.lead_id = l.id
  AND l.ai_disabled = true
  AND c.ai_state = 'AI_ACTIVE';

-- Confirmar: rows sem lead associado ou lead.ai_disabled = false já estão em
-- AI_ACTIVE por DEFAULT — nenhuma ação necessária.

-- ============================================================
-- PARTE 4: INDEX PARCIAL
--
-- Queries de inbox "aguardando humano" / "humano ativo" são o caso
-- de uso crítico. AI_ACTIVE é o estado 99% do tempo — excluir do index.
-- Partial index cobre exatamente as conversas que precisam de atenção.
--
-- Selectividade esperada: < 5% das rows em produção.
-- Justificativa: filtros por org + ai_state IN (...) em tela de inbox.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_conversations_ai_state_org
  ON public.conversations (organization_id, ai_state)
  WHERE ai_state <> 'AI_ACTIVE';

-- ============================================================
-- PARTE 5: TRIGGER DE VALIDAÇÃO DE TRANSIÇÕES FSM
--
-- SECURITY DEFINER: necessário para que a função leia a tabela de
-- conversas sem interferência de RLS durante a validação. A função
-- não acessa dados além do próprio row sendo atualizado (OLD/NEW).
-- search_path fixado em public para evitar search_path injection.
--
-- BEFORE UPDATE OF ai_state: só dispara quando ai_state muda.
-- WHEN (OLD.ai_state IS DISTINCT FROM NEW.ai_state): guard extra —
-- se trigger disparar com ai_state igual, retorna sem validar.
--
-- Transições ilegais → RAISE EXCEPTION com mensagem descritiva.
-- O cliente (hook useTakeover) deve tratar PG exception e exibir erro.
--
-- ANTÍDOTO: Para desativar o guard temporariamente em emergência,
-- executar como superuser:
--   ALTER TABLE public.conversations DISABLE TRIGGER trg_enforce_ai_state_transition;
-- (Reativar imediatamente após a operação de emergência.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_ai_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- Guard: se o estado não mudou, não validar (ex: UPDATE de outro campo)
  IF NEW.ai_state = OLD.ai_state THEN
    RETURN NEW;
  END IF;

  -- Tabela de transições permitidas
  -- Qualquer par (OLD, NEW) fora dessa lista é rejeitado
  v_allowed := (OLD.ai_state::TEXT, NEW.ai_state::TEXT) IN (
    -- Humano pausa a IA
    ('AI_ACTIVE',        'AI_PAUSED_MANUAL'),
    -- IA pede intervenção humana
    ('AI_ACTIVE',        'WAITING_HUMAN'),
    -- Humano retoma a IA (de pausa manual)
    ('AI_PAUSED_MANUAL', 'AI_ACTIVE'),
    -- Humano começou a responder enquanto IA estava pausada
    ('AI_PAUSED_MANUAL', 'HUMAN_ACTIVE'),
    -- Humano assumiu conversa que estava esperando
    ('WAITING_HUMAN',    'HUMAN_ACTIVE'),
    -- Humano cancelou a espera, retorna direto pra IA
    ('WAITING_HUMAN',    'AI_ACTIVE'),
    -- Humano finaliza atendimento e inicia handoff
    ('HUMAN_ACTIVE',     'HANDOFF_BACK'),
    -- Humano decide manter pausa sem handoff completo
    ('HUMAN_ACTIVE',     'AI_PAUSED_MANUAL'),
    -- IA retomou após handoff
    ('HANDOFF_BACK',     'AI_ACTIVE')
  );

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'ai_state transition not allowed: % -> %. Valid transitions from % are defined in enforce_ai_state_transition().',
      OLD.ai_state,
      NEW.ai_state,
      OLD.ai_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Atualizar timestamp da transição automaticamente
  -- (mesmo que o caller não inclua ai_state_updated_at no SET)
  NEW.ai_state_updated_at := now();

  RETURN NEW;
END;
$$;

-- Remover trigger antigo se existir (idempotência)
DROP TRIGGER IF EXISTS trg_enforce_ai_state_transition ON public.conversations;

CREATE TRIGGER trg_enforce_ai_state_transition
  BEFORE UPDATE OF ai_state ON public.conversations
  FOR EACH ROW
  WHEN (OLD.ai_state IS DISTINCT FROM NEW.ai_state)
  EXECUTE FUNCTION public.enforce_ai_state_transition();

-- ============================================================
-- PARTE 6: COMENTÁRIOS
-- ============================================================

COMMENT ON COLUMN public.conversations.ai_state IS
  'FSM de controle takeover IA↔humano. Distinto de conversations.state (FSM copilot). '
  'Valores: AI_ACTIVE | AI_PAUSED_MANUAL | WAITING_HUMAN | HUMAN_ACTIVE | HANDOFF_BACK. '
  'Transições enforced por trigger trg_enforce_ai_state_transition.';

COMMENT ON COLUMN public.conversations.ai_state_resume_mode IS
  'Modo de retomada da IA quando pausada manualmente. '
  'immediate = retoma ao liberar | after_response = retoma após resposta do lead | dont_resume = não retoma automaticamente.';

COMMENT ON COLUMN public.conversations.ai_state_updated_at IS
  'Timestamp da última transição de ai_state. Atualizado automaticamente pelo trigger.';

COMMENT ON COLUMN public.conversations.ai_state_updated_by IS
  'UUID do auth.user que realizou a última transição. NULL = alteração por processo automático (IA/sistema).';

COMMENT ON FUNCTION public.enforce_ai_state_transition() IS
  'SECURITY DEFINER. Valida transições de ai_state em conversations. '
  'Rejeita transições ilegais com RAISE EXCEPTION (check_violation). '
  'Atualiza ai_state_updated_at automaticamente em transições válidas.';
