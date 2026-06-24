-- Product tour (intro.js): marca quando o usuário concluiu/dispensou o tour guiado.
-- NULL = ainda não viu. Timestamp = já viu (auto-start não dispara mais).
-- Persistência por usuário (não por organização).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS product_tour_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.product_tour_completed_at IS
  'Quando o usuário concluiu ou dispensou o product tour (intro.js). NULL = nunca viu.';

-- RLS: as policies existentes de `profiles` já permitem o usuário ler/atualizar a
-- própria linha (id = auth.uid()), então nenhuma policy nova é necessária para
-- o UPDATE feito pelo cliente em useTourState.ts.
