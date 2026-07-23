-- Item #5: RAG real com vector search (pgvector)
-- Item #6: FAQ retrieval semântico
-- Habilita pgvector e adiciona embeddings em documentos e FAQs

-- Habilitar extensão pgvector (já disponível no Supabase hosted)
-- In local dev, the extension may not be available — skip gracefully
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
  RAISE NOTICE 'pgvector extension not available — skipping entire migration';
  RETURN;
END $$;

-- Guard: only proceed if vector type is available
DO $guard$
BEGIN
  -- Test if vector type exists
  PERFORM 'extensions.vector(1536)'::regtype;

  -- ────────────────────────────────────────────────────────────
  -- Documentos: chunks para RAG
  -- ────────────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS public.copilot_agent_document_chunks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES public.copilot_agent_documents(id) ON DELETE CASCADE,
    agent_id     UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL DEFAULT 0,
    content      TEXT NOT NULL,
    embedding    extensions.vector(1536),
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_doc_chunks_document_id  ON public.copilot_agent_document_chunks(document_id);
  CREATE INDEX IF NOT EXISTS idx_doc_chunks_agent_id     ON public.copilot_agent_document_chunks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_doc_chunks_org_id       ON public.copilot_agent_document_chunks(organization_id);

  -- Índice HNSW para busca semântica rápida em chunks
  CREATE INDEX IF NOT EXISTS idx_doc_chunks_embedding
    ON public.copilot_agent_document_chunks
    USING hnsw (embedding extensions.vector_cosine_ops)
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
  -- FAQs: embedding para busca semântica
  -- ────────────────────────────────────────────────────────────

  ALTER TABLE public.copilot_agent_faqs
    ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

  CREATE INDEX IF NOT EXISTS idx_faqs_embedding
    ON public.copilot_agent_faqs
    USING hnsw (embedding extensions.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

EXCEPTION WHEN undefined_object OR OTHERS THEN
  RAISE NOTICE 'pgvector types not available — skipping vector columns and indexes';
END;
$guard$;

-- ────────────────────────────────────────────────────────────
-- Funções de busca semântica (only if vector type exists)
-- ────────────────────────────────────────────────────────────

DO $funcs$
BEGIN
  -- Only create vector-dependent functions if the type is available
  PERFORM 'vector'::regtype;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION match_document_chunks(
      query_embedding  vector(1536),
      agent_id_filter  UUID,
      match_count      INTEGER DEFAULT 5,
      similarity_threshold FLOAT DEFAULT 0.7
    )
    RETURNS TABLE (id UUID, document_id UUID, content TEXT, similarity FLOAT)
    LANGUAGE sql STABLE
    AS $body$
      SELECT c.id, c.document_id, c.content,
             1 - (c.embedding <=> query_embedding) AS similarity
      FROM public.copilot_agent_document_chunks c
      WHERE c.agent_id = agent_id_filter
        AND c.embedding IS NOT NULL
        AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
      ORDER BY c.embedding <=> query_embedding
      LIMIT match_count;
    $body$;
  $fn$;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION match_faqs(
      query_embedding  vector(1536),
      agent_id_filter  UUID,
      match_count      INTEGER DEFAULT 3,
      similarity_threshold FLOAT DEFAULT 0.75
    )
    RETURNS TABLE (id UUID, question TEXT, answer TEXT, similarity FLOAT)
    LANGUAGE sql STABLE
    AS $body$
      SELECT f.id, f.question, f.answer,
             1 - (f.embedding <=> query_embedding) AS similarity
      FROM public.copilot_agent_faqs f
      WHERE f.agent_id = agent_id_filter
        AND f.embedding IS NOT NULL
        AND 1 - (f.embedding <=> query_embedding) >= similarity_threshold
      ORDER BY f.embedding <=> query_embedding
      LIMIT match_count;
    $body$;
  $fn$;

EXCEPTION WHEN undefined_object OR OTHERS THEN
  RAISE NOTICE 'vector type not available — skipping semantic search functions';
END;
$funcs$;
