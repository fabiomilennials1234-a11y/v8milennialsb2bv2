
-- Add is_confirmed boolean to pipe_confirmacao
ALTER TABLE public.pipe_confirmacao 
ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false;

-- Add new enum value "confirmar_d5"
ALTER TYPE public.pipe_confirmacao_status ADD VALUE IF NOT EXISTS 'confirmar_d5' AFTER 'reuniao_marcada';

-- Update existing records with pre_confirmada to appropriate status and set is_confirmed = true
UPDATE public.pipe_confirmacao 
SET is_confirmed = true 
WHERE status = 'pre_confirmada';

-- Update existing records with confirmada_no_dia to confirmacao_no_dia and set is_confirmed = true
UPDATE public.pipe_confirmacao 
SET status = 'confirmacao_no_dia', is_confirmed = true 
WHERE status = 'confirmada_no_dia';

-- Update pre_confirmada records to confirmar_d1 (keeping is_confirmed = true)
UPDATE public.pipe_confirmacao 
SET status = 'confirmar_d1' 
WHERE status = 'pre_confirmada';
