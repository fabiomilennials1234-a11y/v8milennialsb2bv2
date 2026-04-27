-- Dias sem interação no pipe de confirmação para considerar lead como "atrasado".
-- Só entram como atrasadas as reuniões/leads que não tiveram interação (updated_at) há pelo menos esse número de dias.
-- Assim, itens em "remarcar" com atividade recente não ficam como atrasados.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS confirmacao_overdue_days INTEGER NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.organizations.confirmacao_overdue_days IS 'Dias sem interação (updated_at) no pipe de confirmação para marcar como atrasado. Default 5.';
