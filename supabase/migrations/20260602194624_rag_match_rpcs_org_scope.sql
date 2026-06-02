-- ============================================================================
-- RAG match_* RPCs — org-scope (#40/#41). Adiciona predicate organization_id
-- (defesa-em-profundidade multi-tenant) às 3 funções de busca semântica v1.
-- Supersede as assinaturas de 20260626000006 / 20260626000008 (imutáveis).
-- committed-not-applied: dev pode não ter as migrations base — validar antes.
-- NÃO aplicar em prod neste slice (CTO-gated).
--
-- NOTA DE SCHEMA (divergência registrada): copilot_agent_faqs NÃO tem coluna
-- organization_id (só agent_id — ver 20260125000000_create_copilot_agents.sql
-- linhas 88-98). O predicate org das FAQs usa a subquery via copilot_agents
-- (a coluna NÃO foi inventada, conforme nota inline da Task 1 do plano).
-- ============================================================================
do $guard$
begin
  perform 'vector'::regtype;

  -- Drop das assinaturas antigas (4 args) pra não deixar overload órfão.
  drop function if exists public.match_document_chunks(vector, uuid, integer, double precision);
  drop function if exists public.match_faqs(vector, uuid, integer, double precision);
  drop function if exists public.match_lead_memories(vector, uuid, integer, double precision);

  execute $fn$
    create function public.match_document_chunks(
      query_embedding  vector(1536),
      agent_id_filter  uuid,
      p_org_id         uuid,
      match_count      integer default 5,
      similarity_threshold float default 0.55
    )
    returns table (id uuid, document_id uuid, content text, similarity float)
    language sql stable security definer set search_path = public
    as $body$
      select c.id, c.document_id, c.content, 1 - (c.embedding <=> query_embedding) as similarity
      from public.copilot_agent_document_chunks c
      where c.agent_id = agent_id_filter
        and c.organization_id = p_org_id
        and c.embedding is not null
        and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
      order by c.embedding <=> query_embedding
      limit match_count;
    $body$;
  $fn$;

  execute $fn$
    create function public.match_faqs(
      query_embedding  vector(1536),
      agent_id_filter  uuid,
      p_org_id         uuid,
      match_count      integer default 3,
      similarity_threshold float default 0.5
    )
    returns table (id uuid, question text, answer text, similarity float)
    language sql stable security definer set search_path = public
    as $body$
      select f.id, f.question, f.answer, 1 - (f.embedding <=> query_embedding) as similarity
      from public.copilot_agent_faqs f
      where f.agent_id = agent_id_filter
        -- copilot_agent_faqs herda org via agent_id (sem coluna organization_id):
        -- predicate org pela subquery em copilot_agents (fail-CLOSED).
        and f.agent_id in (
          select a.id from public.copilot_agents a
          where a.id = agent_id_filter and a.organization_id = p_org_id
        )
        and f.embedding is not null
        and 1 - (f.embedding <=> query_embedding) >= similarity_threshold
      order by f.embedding <=> query_embedding
      limit match_count;
    $body$;
  $fn$;

  execute $fn$
    create function public.match_lead_memories(
      query_embedding  vector(1536),
      lead_id_filter   uuid,
      p_org_id         uuid,
      match_count      integer default 5,
      similarity_threshold float default 0.70
    )
    returns table (id uuid, memory_type text, content text, importance integer, similarity float)
    language sql stable security definer set search_path = public
    as $body$
      select m.id, m.memory_type, m.content, m.importance, 1 - (m.embedding <=> query_embedding) as similarity
      from public.lead_memories m
      where m.lead_id = lead_id_filter
        and m.organization_id = p_org_id
        and m.embedding is not null
        and 1 - (m.embedding <=> query_embedding) >= similarity_threshold
      order by m.embedding <=> query_embedding
      limit match_count;
    $body$;
  $fn$;

  revoke all on function public.match_document_chunks(vector, uuid, uuid, integer, double precision) from public, anon, authenticated;
  revoke all on function public.match_faqs(vector, uuid, uuid, integer, double precision) from public, anon, authenticated;
  revoke all on function public.match_lead_memories(vector, uuid, uuid, integer, double precision) from public, anon, authenticated;
  grant execute on function public.match_document_chunks(vector, uuid, uuid, integer, double precision) to service_role;
  grant execute on function public.match_faqs(vector, uuid, uuid, integer, double precision) to service_role;
  grant execute on function public.match_lead_memories(vector, uuid, uuid, integer, double precision) to service_role;

exception when undefined_object or undefined_table then
  raise notice 'pgvector/tabelas RAG ausentes — skip org-scope das match_* (baseline divergente)';
end $guard$;
