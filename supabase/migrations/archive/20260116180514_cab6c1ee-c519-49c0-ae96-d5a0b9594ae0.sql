-- Add 'reativar' status to pipe_propostas_status enum
ALTER TYPE public.pipe_propostas_status ADD VALUE 'reativar' AFTER 'marcar_compromisso';