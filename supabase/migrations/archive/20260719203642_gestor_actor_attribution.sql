-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260719203642  name: gestor_actor_attribution
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- S6 #1142 — atribuição do ator real em runtime_logs (ADR-0021 §7). Aditiva.
ALTER TABLE public.runtime_logs
  ADD COLUMN IF NOT EXISTS actor_type text,
  ADD COLUMN IF NOT EXISTS gestor_id uuid;

COMMENT ON COLUMN public.runtime_logs.actor_type IS
  'ADR-0021 §7: tipo do ator da ação. Vocabulário (gestor|master|member|system) garantido em compile time pelo union RuntimeActorType em _shared/logger.ts — deliberadamente sem CHECK. NULL = log legado / não-atribuído.';

COMMENT ON COLUMN public.runtime_logs.gestor_id IS
  'ADR-0021 §7: gestores.id do ator REAL quando actor_type = gestor. Sem FK de propósito (preserva o id no log mesmo após deleção do gestor; evita insert-fail silencioso). triggered_by continua sendo o auth.users.id real.';

CREATE INDEX IF NOT EXISTS idx_runtime_logs_gestor
  ON public.runtime_logs (gestor_id, created_at DESC)
  WHERE gestor_id IS NOT NULL;
