-- =================================================================
-- FIX: FK constraints sem ON DELETE SET NULL bloqueiam remoção de team_members
--
-- Problema:
--   follow_ups.assigned_to e campanha_leads.sdr_id referenciam
--   team_members(id) sem ON DELETE SET NULL. Ao tentar remover um
--   membro, o Postgres bloqueia com:
--   "update or delete on table team_members violates foreign key
--    constraint follow_ups_assigned_to_fkey on table follow_ups"
--
-- Solução:
--   Dropar as constraints antigas e recriar com ON DELETE SET NULL.
--   Quando o membro é removido, os campos ficam NULL (sem responsável).
-- =================================================================

-- 1. follow_ups.assigned_to → ON DELETE SET NULL
ALTER TABLE public.follow_ups
  DROP CONSTRAINT IF EXISTS follow_ups_assigned_to_fkey;

ALTER TABLE public.follow_ups
  ADD CONSTRAINT follow_ups_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.team_members(id) ON DELETE SET NULL;

-- 2. campanha_leads.sdr_id → ON DELETE SET NULL
ALTER TABLE public.campanha_leads
  DROP CONSTRAINT IF EXISTS campanha_leads_sdr_id_fkey;

ALTER TABLE public.campanha_leads
  ADD CONSTRAINT campanha_leads_sdr_id_fkey
  FOREIGN KEY (sdr_id) REFERENCES public.team_members(id) ON DELETE SET NULL;
