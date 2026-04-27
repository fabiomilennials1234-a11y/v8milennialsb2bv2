-- First, update existing records to use new values
UPDATE public.pipe_whatsapp SET status = 'novo' WHERE status = 'em_contato';
UPDATE public.pipe_whatsapp SET status = 'novo' WHERE status = 'compareceu';

-- Drop the old enum and create new one with updated values
ALTER TYPE public.pipe_whatsapp_status RENAME TO pipe_whatsapp_status_old;

CREATE TYPE public.pipe_whatsapp_status AS ENUM ('novo', 'abordado', 'respondeu', 'esfriou', 'agendado');

-- Update the column to use the new enum
ALTER TABLE public.pipe_whatsapp 
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.pipe_whatsapp_status USING status::text::public.pipe_whatsapp_status,
  ALTER COLUMN status SET DEFAULT 'novo'::public.pipe_whatsapp_status;

-- Drop the old enum
DROP TYPE public.pipe_whatsapp_status_old;