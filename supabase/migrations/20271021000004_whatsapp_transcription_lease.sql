-- Lease for paid, on-demand transcription. No new read grants or policies.
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS transcription_requested_at timestamptz;
NOTIFY pgrst, 'reload schema';
