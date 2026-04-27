-- Add confirmar_d2 to the pipe_confirmacao_status enum
ALTER TYPE pipe_confirmacao_status ADD VALUE IF NOT EXISTS 'confirmar_d2' AFTER 'confirmar_d3';