-- 20270211000003_gestor_actor_attribution.sql
-- NÃO APLICADO — lote de prod pendente CTO
--
-- S6 #1142 — Gestor de Portfólio: atribuição do ator real (ADR-0021 §7).
--
-- Problema: o Gestor de Portfólio (scoped master — ADR-0021) escreve como admin
-- DENTRO de dados de clientes diferentes. Quando o admin do cliente perguntar
-- "quem fez isso?", a resposta tem que ser o ATOR REAL (o gestor), nunca um
-- membro genérico nem o virtual member (`gestor-virtual-<userId>` — UI-only,
-- jamais persistido em FK). `runtime_logs` (ADR-0017) já grava `triggered_by`
-- (o auth.users.id real), mas NÃO distingue "este triggered_by é um Gestor
-- atuando cross-org" de "é um membro/admin normal da própria org". Um ator
-- cross-org escrevendo em dados de vários clientes sem trilha forense é buraco
-- de confiança (§7).
--
-- Trilhas por-ator existentes JÁ atribuem ao ator real e NÃO precisam de DDL:
--   • lead_history.created_by = auth.uid() → já é o gestor real (nunca anonimizado).
--   • master_audit_logs → só para master_users; Gestor não escreve lá.
--   • channel_messages.sender_name → S3 (carteira-bulk-message) já atribui ao
--     user.id real quando member é null (gestor).
-- Sobra só `runtime_logs`, que precisa de um marcador de TIPO de ator + o id
-- real do gestor para a consulta forense "tudo que o Gestor X fez, em qualquer
-- org que ele alcança".
--
-- Delta (mínimo): 2 colunas + 1 índice parcial. Sem CHECK — `runtime_logs`
-- deliberadamente não tem CHECK (ver 20270115000000): `logRuntime` engole a
-- falha do insert por design, então um constraint de runtime destruiria em
-- silêncio exatamente a linha que deveria proteger. O vocabulário de
-- `actor_type` é garantido em compile time pelo union `RuntimeActorType` em
-- `_shared/logger.ts`. Sem FK em `gestor_id`: (1) preserva o id no log mesmo
-- se o gestor for deletado (mais forense que SET NULL); (2) evita insert-fail
-- silencioso num caminho de erro engolido.
--
-- Ordenação (importante): o código em `_shared/logger.ts` só referencia estas
-- colunas quando `actorType` está setado — isto é, SÓ para escrita de gestor.
-- Log normal mantém a mesma forma de insert → zero regressão antes do apply.
-- Como o Gestor ainda não está live (fundação em slices), nenhuma escrita de
-- gestor ocorre antes deste lote entrar. ESTA MIGRATION DEVE SER APLICADA ANTES
-- de o Gestor ir a produção — caso contrário logs de gestor cairiam em silêncio.

ALTER TABLE public.runtime_logs
  ADD COLUMN IF NOT EXISTS actor_type text,
  ADD COLUMN IF NOT EXISTS gestor_id uuid;

COMMENT ON COLUMN public.runtime_logs.actor_type IS
  'ADR-0021 §7: tipo do ator da ação. Vocabulário (gestor|master|member|system) '
  'garantido em compile time pelo union RuntimeActorType em _shared/logger.ts — '
  'deliberadamente sem CHECK (mesma razão de module, migration 20270115). '
  'NULL = log legado / não-atribuído.';

COMMENT ON COLUMN public.runtime_logs.gestor_id IS
  'ADR-0021 §7: gestores.id do ator REAL quando actor_type = gestor. Sem FK de '
  'propósito (preserva o id no log mesmo após deleção do gestor; evita '
  'insert-fail silencioso). triggered_by continua sendo o auth.users.id real.';

-- Consulta forense: "tudo que o Gestor X fez, em qualquer org vinculada".
CREATE INDEX IF NOT EXISTS idx_runtime_logs_gestor
  ON public.runtime_logs (gestor_id, created_at DESC)
  WHERE gestor_id IS NOT NULL;
