-- Item #19: Memória de longo prazo inter-conversas
-- Armazena fatos chave sobre o lead que persistem entre conversas
-- Guarded: skips vector-dependent parts if pgvector is not available

DO $migration$
BEGIN
  -- Check if vector type is available
  PERFORM 'vector'::regtype;

  CREATE TABLE IF NOT EXISTS public.lead_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_id        UUID REFERENCES public.copilot_agents(id) ON DELETE SET NULL,
    memory_type     TEXT NOT NULL DEFAULT 'fact'
                    CHECK (memory_type IN ('fact', 'preference', 'pain_point', 'objection', 'context')),
    content         TEXT NOT NULL,
    embedding       vector(1536),
    importance      INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    turn_count      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_accessed   TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_lead_memories_lead_id    ON public.lead_memories(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lead_memories_org_id     ON public.lead_memories(organization_id);
  CREATE INDEX IF NOT EXISTS idx_lead_memories_type       ON public.lead_memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_lead_memories_importance ON public.lead_memories(importance DESC);

  CREATE INDEX IF NOT EXISTS idx_lead_memories_embedding
    ON public.lead_memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

  ALTER TABLE public.lead_memories ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "org_members_select_lead_memories"
    ON public.lead_memories FOR SELECT
    USING (organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    ));

  CREATE POLICY "service_role_all_lead_memories"
    ON public.lead_memories FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION match_lead_memories(
      query_embedding   vector(1536),
      lead_id_filter    UUID,
      match_count       INTEGER DEFAULT 5,
      similarity_threshold FLOAT DEFAULT 0.70
    )
    RETURNS TABLE (id UUID, memory_type TEXT, content TEXT, importance INTEGER, similarity FLOAT)
    LANGUAGE sql STABLE
    AS $body$
      SELECT m.id, m.memory_type, m.content, m.importance,
             1 - (m.embedding <=> query_embedding) AS similarity
      FROM public.lead_memories m
      WHERE m.lead_id = lead_id_filter
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> query_embedding) >= similarity_threshold
      ORDER BY m.embedding <=> query_embedding
      LIMIT match_count;
    $body$;
  $fn$;

EXCEPTION WHEN undefined_object OR OTHERS THEN
  -- pgvector not available: create table without vector column
  CREATE TABLE IF NOT EXISTS public.lead_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_id        UUID REFERENCES public.copilot_agents(id) ON DELETE SET NULL,
    memory_type     TEXT NOT NULL DEFAULT 'fact'
                    CHECK (memory_type IN ('fact', 'preference', 'pain_point', 'objection', 'context')),
    content         TEXT NOT NULL,
    importance      INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    turn_count      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_accessed   TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_lead_memories_lead_id    ON public.lead_memories(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lead_memories_org_id     ON public.lead_memories(organization_id);
  CREATE INDEX IF NOT EXISTS idx_lead_memories_type       ON public.lead_memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_lead_memories_importance ON public.lead_memories(importance DESC);

  ALTER TABLE public.lead_memories ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "org_members_select_lead_memories"
    ON public.lead_memories FOR SELECT
    USING (organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    ));

  CREATE POLICY "service_role_all_lead_memories"
    ON public.lead_memories FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

  RAISE NOTICE 'pgvector not available — lead_memories created without embedding column';
END;
$migration$;

COMMENT ON TABLE public.lead_memories IS
  'Memória de longo prazo do lead: fatos, preferências, dores e objeções que persistem entre conversas.';
