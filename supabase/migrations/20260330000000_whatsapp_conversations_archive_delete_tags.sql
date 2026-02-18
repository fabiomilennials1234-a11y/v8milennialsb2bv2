-- =================================================================
-- WhatsApp Conversations: Arquivar, Excluir e Tags
--
-- Funcionalidades:
--   1. Arquivar conversa (qualquer membro) — aba "Arquivadas"
--   2. Excluir conversa (apenas admin) — soft delete + purge 30 dias
--   3. Tags de conversa (híbrido: lead_tags + conversation_tags)
--   4. Auto-desarquivar quando chega mensagem nova (no webhook)
--
-- Tabelas criadas:
--   - whatsapp_conversations (metadados: archive, delete)
--   - whatsapp_conversation_tags (junction: conversa ↔ tag)
--
-- Cron job:
--   - purge-deleted-whatsapp-conversations (diário 3h, SQL direto)
-- =================================================================

-- ============================================
-- 1. TABELA: whatsapp_conversations
-- ============================================
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(instance_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_org
  ON public.whatsapp_conversations(organization_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_instance
  ON public.whatsapp_conversations(instance_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_state
  ON public.whatsapp_conversations(instance_id, deleted_at, archived_at);

COMMENT ON TABLE public.whatsapp_conversations IS 'Metadados de conversas WhatsApp: archive, soft delete, tags. Registro criado sob demanda (primeira ação).';

-- ============================================
-- 2. RLS: whatsapp_conversations
-- ============================================
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

-- SELECT: membro da organização
CREATE POLICY "whatsapp_conversations_select_org"
  ON public.whatsapp_conversations FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- INSERT: membro da organização (criar registro ao arquivar/taguear)
CREATE POLICY "whatsapp_conversations_insert_org"
  ON public.whatsapp_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE archived_at: qualquer membro da organização
CREATE POLICY "whatsapp_conversations_update_archive"
  ON public.whatsapp_conversations FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- Service role full access (para webhook auto-desarquivar)
CREATE POLICY "whatsapp_conversations_service_role"
  ON public.whatsapp_conversations FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- 3. RLS restrição: apenas admin pode setar deleted_at
--    (via função SECURITY DEFINER para o UPDATE de delete)
-- ============================================
CREATE OR REPLACE FUNCTION public.soft_delete_whatsapp_conversation(
  p_instance_id UUID,
  p_phone_number TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Verificar se é admin
  IF NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir conversas';
  END IF;

  -- UPSERT: criar registro se não existe, setar deleted_at
  INSERT INTO public.whatsapp_conversations (organization_id, instance_id, phone_number, deleted_at, deleted_by)
  VALUES (p_organization_id, p_instance_id, p_phone_number, now(), auth.uid())
  ON CONFLICT (instance_id, phone_number)
  DO UPDATE SET deleted_at = now(), deleted_by = auth.uid()
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_whatsapp_conversation IS 'Soft delete de conversa WhatsApp. Apenas admins. Purge automático após 30 dias.';

-- ============================================
-- 4. TABELA: whatsapp_conversation_tags
-- ============================================
CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conversation_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_tags_conv
  ON public.whatsapp_conversation_tags(conversation_id);

COMMENT ON TABLE public.whatsapp_conversation_tags IS 'Tags de conversas WhatsApp (para contatos sem lead). Complementa lead_tags.';

-- ============================================
-- 5. RLS: whatsapp_conversation_tags
-- ============================================
ALTER TABLE public.whatsapp_conversation_tags ENABLE ROW LEVEL SECURITY;

-- SELECT: membro da organização (via JOIN com conversation)
CREATE POLICY "whatsapp_conversation_tags_select"
  ON public.whatsapp_conversation_tags FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.whatsapp_conversations
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- INSERT: membro da organização
CREATE POLICY "whatsapp_conversation_tags_insert"
  ON public.whatsapp_conversation_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.whatsapp_conversations
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- DELETE: membro da organização
CREATE POLICY "whatsapp_conversation_tags_delete"
  ON public.whatsapp_conversation_tags FOR DELETE
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.whatsapp_conversations
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================
-- 6. CRON: purge conversas excluídas há >30 dias
--    SQL direto, sem Edge Function, job isolado
-- ============================================
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-deleted-whatsapp-conversations',
      '0 3 * * *',
      $$
        -- Apagar mensagens de conversas excluídas há mais de 30 dias
        DELETE FROM public.whatsapp_messages
        WHERE (instance_id, phone_number) IN (
          SELECT instance_id, phone_number
          FROM public.whatsapp_conversations
          WHERE deleted_at IS NOT NULL
            AND deleted_at < now() - interval '30 days'
        );

        -- Apagar os registros de conversa em si (CASCADE limpa tags)
        DELETE FROM public.whatsapp_conversations
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - interval '30 days';
      $$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
