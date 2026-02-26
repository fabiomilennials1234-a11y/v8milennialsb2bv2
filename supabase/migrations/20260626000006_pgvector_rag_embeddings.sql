-- Item #5: RAG real com vector search (pgvector)
-- Item #6: FAQ retrieval semântico
-- Habilita pgvector e adiciona embeddings em documentos e FAQs

-- Habilitar extensão pgvector (já disponível no Supabase)
CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────────────────────────
-- Documentos: adicionar coluna de embedding + chunk support
-- ────────────────────────────────────────────────────────────

-- Tabela de chunks de documentos para RAG
CREATE TABLE IF NOT EXISTS public.copilot_agent_document_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES public.copilot_agent_documents(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,
  embedding    vector(1536),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_chunks_document_id  ON public.copilot_agent_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_agent_id     ON public.copilot_agent_document_chunks(agent_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_org_id       ON public.copilot_agent_document_chunks(organization_id);

-- Índice HNSW para busca semântica rápida em chunks
CREATE INDEX IF NOT EXISTS idx_doc_chunks_embedding
  ON public.copilot_agent_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RLS em chunks
ALTER TABLE public.copilot_agent_document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_doc_chunks"
  ON public.copilot_agent_document_chunks FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "service_role_all_doc_chunks"
  ON public.copilot_agent_document_chunks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- FAQs: adicionar coluna de embedding para busca semântica
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.copilot_agent_faqs
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Índice HNSW para busca semântica em FAQs
CREATE INDEX IF NOT EXISTS idx_faqs_embedding
  ON public.copilot_agent_faqs
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ────────────────────────────────────────────────────────────
-- Funções de busca semântica
-- ────────────────────────────────────────────────────────────

-- Busca semântica em chunks de documentos
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding  vector(1536),
  agent_id_filter  UUID,
  match_count      INTEGER DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  content     TEXT,
  similarity  FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.copilot_agent_document_chunks c
  WHERE
    c.agent_id = agent_id_filter
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Busca semântica em FAQs
CREATE OR REPLACE FUNCTION match_faqs(
  query_embedding  vector(1536),
  agent_id_filter  UUID,
  match_count      INTEGER DEFAULT 3,
  similarity_threshold FLOAT DEFAULT 0.75
)
RETURNS TABLE (
  id         UUID,
  question   TEXT,
  answer     TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    f.id,
    f.question,
    f.answer,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM public.copilot_agent_faqs f
  WHERE
    f.agent_id = agent_id_filter
    AND f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON TABLE public.copilot_agent_document_chunks IS
  'Chunks de texto de documentos do agente com embeddings para RAG (Retrieval-Augmented Generation).';

COMMENT ON FUNCTION match_document_chunks IS
  'Busca semântica por similaridade de cosseno em chunks de documentos do agente.';

COMMENT ON FUNCTION match_faqs IS
  'Busca semântica por similaridade de cosseno em FAQs do agente.';
