-- Add 'remarcar' status to pipe_confirmacao_status enum
ALTER TYPE pipe_confirmacao_status ADD VALUE 'remarcar' AFTER 'confirmada_no_dia';