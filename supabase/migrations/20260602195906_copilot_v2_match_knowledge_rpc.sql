-- ============================================================================
-- Copilot v2 — RPC de busca híbrida de conhecimento (Slice 7). Vetor (pgvector)
-- + keyword (websearch_to_tsquery), org-scoped (#40/#41). Devolve as colunas
-- pro rank-fusion puro (hybrid-search.ts). committed-not-applied (validar dev).
-- NÃO aplicar em prod neste slice.
-- ============================================================================
do $guard$
begin
  perform 'vector'::regtype;

  execute $fn$
    create or replace function public.copilot_v2_match_knowledge(
      query_embedding  vector(1536),
      p_org_id         uuid,
      query_text       text default '',
      match_count      integer default 8,
      similarity_threshold float default 0.55
    )
    returns table (id bigint, content text, similarity float, source text)
    language sql stable security definer set search_path = public
    as $body$
      -- lado semântico
      (select c.id, c.content, 1 - (c.embedding <=> query_embedding) as similarity, 'semantic'::text as source
         from public.copilot_v2_knowledge_chunks c
        where c.organization_id = p_org_id
          and c.embedding is not null
          and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
        order by c.embedding <=> query_embedding
        limit match_count)
      union
      -- lado keyword (só quando há query_text)
      (select c.id, c.content, 1.0::float as similarity, 'keyword'::text as source
         from public.copilot_v2_knowledge_chunks c
        where c.organization_id = p_org_id
          and query_text <> ''
          and to_tsvector('portuguese', c.content) @@ websearch_to_tsquery('portuguese', query_text)
        limit match_count);
    $body$;
  $fn$;

  revoke all on function public.copilot_v2_match_knowledge(vector, uuid, text, integer, double precision) from public, anon, authenticated;
  grant execute on function public.copilot_v2_match_knowledge(vector, uuid, text, integer, double precision) to service_role;

exception when undefined_object or undefined_table then
  raise notice 'pgvector/copilot_v2_knowledge_chunks ausentes — skip copilot_v2_match_knowledge';
end $guard$;
