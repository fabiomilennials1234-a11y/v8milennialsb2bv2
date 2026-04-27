-- =============================================================
-- Migration: Agent Knowledge Base Documents
-- Tabela para armazenar documentos do agente e seus resumos LLM.
-- Approach B: upload → LLM summary → inject no prompt.
-- =============================================================

-- Tabela de documentos do agente
CREATE TABLE IF NOT EXISTS public.copilot_agent_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,          -- path no storage bucket
  file_size INTEGER DEFAULT 0,
  mime_type TEXT DEFAULT 'application/pdf',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),
  summary TEXT DEFAULT NULL,         -- resumo gerado pelo LLM
  error_message TEXT DEFAULT NULL,   -- mensagem de erro se falhar
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_agent_documents_agent_id ON public.copilot_agent_documents(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_documents_org_id ON public.copilot_agent_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_documents_status ON public.copilot_agent_documents(status);

-- RLS
ALTER TABLE public.copilot_agent_documents ENABLE ROW LEVEL SECURITY;

-- Policy: membros da organização podem ver documentos da sua org
CREATE POLICY "org_members_select_agent_documents"
ON public.copilot_agent_documents
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- Policy: membros da organização podem inserir documentos
CREATE POLICY "org_members_insert_agent_documents"
ON public.copilot_agent_documents
FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- Policy: membros da organização podem atualizar documentos
CREATE POLICY "org_members_update_agent_documents"
ON public.copilot_agent_documents
FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- Policy: membros da organização podem deletar documentos
CREATE POLICY "org_members_delete_agent_documents"
ON public.copilot_agent_documents
FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- Storage bucket para documentos dos agentes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agent-documents',
  'agent-documents',
  false,
  10485760,  -- 10MB limit
  ARRAY['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (sem SET ROLE para compatibilidade)

-- Storage policies
DO $$ BEGIN
CREATE POLICY "org_members_upload_agent_docs"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'agent-documents'
  AND auth.role() = 'authenticated'
);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
CREATE POLICY "org_members_read_agent_docs"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'agent-documents'
  AND auth.role() = 'authenticated'
);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
CREATE POLICY "org_members_delete_agent_docs"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'agent-documents'
  AND auth.role() = 'authenticated'
);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fim das políticas de storage
