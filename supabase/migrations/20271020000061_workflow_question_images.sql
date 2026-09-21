-- Fixed images for question_buttons are private, immutable snapshots.
-- Five MiB is our upload budget, not a claimed Uazapi/WhatsApp limit.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('workflow-question-images', 'workflow-question-images', false, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- The edge validates JWT, workflow/RLS, org permissions, feature flag, MIME
-- and binary content before a service-role append-only upload. No browser
-- may bypass that content validation, overwrite or delete historical assets.
-- Restrictive guards also survive any broader permissive legacy policies.
CREATE POLICY workflow_question_images_api_only ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'workflow-question-images')
  WITH CHECK (bucket_id <> 'workflow-question-images');
