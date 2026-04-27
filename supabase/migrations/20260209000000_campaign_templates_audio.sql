-- Templates de campanha: suporte a mensagem em áudio (disparo por áudio)
-- message_type: 'text' (padrão) ou 'audio'; se 'audio', audio_url deve estar preenchido.
-- Data: 2026-02-09

ALTER TABLE public.campaign_templates
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'audio'));

ALTER TABLE public.campaign_templates
  ADD COLUMN IF NOT EXISTS audio_url TEXT;

COMMENT ON COLUMN public.campaign_templates.message_type IS 'Tipo da mensagem: text (template de texto) ou audio (áudio gravado/enviado para disparo)';
COMMENT ON COLUMN public.campaign_templates.audio_url IS 'URL do áudio no storage (quando message_type = audio). Evolution API envia este áudio para cada lead.';
