-- Campaign templates: add support for image and document message types
-- Extends the existing text/audio support with image_url, document_url, and file_name
-- Date: 2026-03-24

-- 1. Drop the existing CHECK constraint on message_type and recreate with new values
ALTER TABLE public.campaign_templates
  DROP CONSTRAINT IF EXISTS campaign_templates_message_type_check;

ALTER TABLE public.campaign_templates
  ADD CONSTRAINT campaign_templates_message_type_check
    CHECK (message_type IN ('text', 'audio', 'image', 'document'));

-- 2. Add new columns for image and document URLs + custom filename
ALTER TABLE public.campaign_templates
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS document_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT;

-- 3. Comments
COMMENT ON COLUMN public.campaign_templates.image_url IS 'URL da imagem no storage (quando message_type = image). Evolution API envia esta imagem com caption para cada lead.';
COMMENT ON COLUMN public.campaign_templates.document_url IS 'URL do documento no storage (quando message_type = document). Evolution API envia este documento com caption para cada lead.';
COMMENT ON COLUMN public.campaign_templates.file_name IS 'Nome customizável do arquivo para documentos. Suporta variáveis como {empresa}. Ex: Proposta {empresa}.pdf';
