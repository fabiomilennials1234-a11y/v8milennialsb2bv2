---
title: "Slice 7 — Ingestão + RAG + auditoria de mídia inbound"
feature: copilot-v2-remodel
slice: "7"
phase: "B — Capabilities core"
status: ready
depends_on: ["[[slice-1H-harness-hardening]]"]
soft_depends_on: ["[[slice-03-tools-media]]", "[[slice-06-asset-stores]]", "[[slice-05-guardrails-handoff]]"]
branch: feat/copilot-v2/slice-7-ingestion-rag
handoff: "engenheiro"
security: true
tags: [copilot-v2, slice, execution-ready, rag, media, security]
---

# Slice 7 — Ingestão + RAG + audit inbound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-7-ingestion-rag` ← `develop`, PR → `develop`, **nunca main**. Deploy só no projeto **dev** (`bcfadphgsibjzivtbjvc`). Migration via **MCP `apply_migration`** (nunca `db push` — prod tem drift). TDD: incidente→regressão. QA com counts literais (output cru do vitest/lint/build, nunca "all green" parafraseado).
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` (§5 Slice 7, §9 apêndice) · ADR: `docs/adr/0002-copilot-v2-architecture.md` (decisões #6/#8/#12).

---

# Slice 7 — Ingestão + RAG + audit de mídia inbound (Copilot v2) 🔒

> 🔒 **Security-sensitive**: multi-tenant (RPCs `match_*` precisam de predicate `organization_id` — hoje confiam só em `agent_id`/`lead_id`, finding #40/#41), credencial de provider (validar `OPENROUTER_API_KEY` no entry, sem fallback silencioso que esconde a falta), custo de ingestão (OCR/transcrição no upload), e fail-NÃO-silencioso (falha de embedding/RAG aparece no trace, nunca some). Toda Task carrega nota de Segurança.

## Goal

Entregar o caminho de **conhecimento** do Copilot v2: ingestão de mídia→texto (PDF/doc extrai+chunk; imagem OCR/caption) → embed pgvector 1536d em `copilot_v2_knowledge_chunks` → busca híbrida (`copilot_v2_match_knowledge`, semântico + keyword) com **threshold centralizado** consumida pelo handler `search_knowledge`. Em paralelo, fechar dois buracos de auditoria: **(a)** as RPCs RAG `match_document_chunks`/`match_faqs`/`match_lead_memories` ganham predicate `organization_id` (#40/#41 — não confiar só no `agent_id`), e **(b)** o caminho de mídia inbound/ingestão é endurecido contra o incidente VitrineVET 2026-06-01 (#668/#670): validar a credencial no entry, retry+telemetria na extração (sem fallback silencioso), e **fix do doc travado em `processing`** via timeout-guard + transição de status determinística.

## Architecture

O pipeline tocado (ler de ponta a ponta antes de começar):

```
UPLOAD KB (org-level, Slice 6 popula copilot_v2_knowledge)
   → copilot-v2-ingest-knowledge/index.ts  (NOVA edge fn: I/O shell)
        → _shared/copilot-v2/ingestion.ts   (PURO: status FSM + decisão de extração + chunking)
        → _shared/embeddings.ts             (generateEmbedding / generateMultimodalEmbedding — 1536d via OpenRouter)
        → copilot_v2_knowledge_chunks       (pgvector 1536d, org-scoped)

BUSCA (turn do agente, Slice 2 cognition-loop)
   → tool-executor.ts search_knowledge handler  (hoje not_implemented)
        → _shared/copilot-v2/hybrid-search.ts    (PURO: rank-fusion semântico+keyword + threshold único)
        → copilot_v2_match_knowledge RPC          (NOVA: vetor + keyword, predicate organization_id)

RPCs RAG v1 (#40/#41 — org-scope)
   → match_document_chunks / match_faqs / match_lead_memories  (NOVA migration: + p_org_id predicate)
```

Decisão segue o padrão da fundação: **lógica pura** em módulos testáveis sem DB (`ingestion.ts` status-FSM/chunk-decision, `hybrid-search.ts` rank-fusion, `rag-threshold.ts` constante única); a edge fn e o handler de tool são **shells de I/O finos**. `organization_id` NUNCA vem do LLM/payload — vem do `ctx` do tool-executor (resolvido pelo worker da instância) ou da row de `copilot_v2_knowledge` (org-scoped). RPCs são `SECURITY DEFINER set search_path = public` com `revoke all from public, anon, authenticated` + `grant execute to service_role`.

> **Caveat de threshold (decisão técnica, não de produto — resolvida abaixo):** a v1 tinha 3 thresholds divergentes — `rag.ts` doc=0.6/faq=0.65, `search-knowledge.ts` doc=0.55/faq=0.5, `knowledge-retriever.ts` doc(initial)=0.5/doc(tool)=0.55. Consolidamos num módulo único `rag-threshold.ts` com **default doc=0.55, faq=0.5** (o ponto médio empírico do caminho mais usado — `search-knowledge` em modo tool — favorecendo recall pra catálogo B2B; o LLM-as-judge da Slice 5 filtra ruído downstream). Ajustável por arg da RPC sem editar o módulo. NÃO é decisão de produto; está parametrizada.

## Tech Stack

- **Deno edge functions** (`supabase/functions/**`, `import ... from "./x.ts"` com `.ts` explícito). Padrão: `serve(withSentry(...))` + `withSecurityHeaders(getCorsHeaders(...))` + OPTIONS early return.
- **Supabase Postgres** RPCs (`SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`, `grant execute to service_role`); **pgvector 1536d** (`copilot_v2_knowledge_chunks.embedding vector(1536)`).
- **Embeddings**: OpenRouter → `google/gemini-embedding-2` 1536d (`_shared/embeddings.ts`). `OPENROUTER_API_KEY` (Deno.env / Supabase secret).
- **Tests: Vitest** (NÃO `deno test`). Os specs copilot-v2 vivem em `tests/unit/copilot-v2/*.test.ts` e importam os fontes `.ts` Deno via path relativo (`../../../supabase/functions/_shared/copilot-v2/x.ts`); o Vite transform do Vitest resolve a extensão `.ts`.
  - Arquivo único: `npx vitest run tests/unit/copilot-v2/<file>.test.ts`
  - Suíte copilot-v2 inteira: `npx vitest run tests/unit/copilot-v2/`
  - Verificado funcionando no 1-H: `npx vitest run tests/unit/copilot-v2/loop-detector.test.ts` → **10 passed**.
  - **NÃO** passar `--reporter=basic` (falha ao carregar o reporter neste repo — usar o reporter default).

## Setup

- [ ] Criar a branch a partir de `develop`:

```bash
git checkout develop && git pull && git checkout -b feat/copilot-v2/slice-7-ingestion-rag
```

- [ ] Baseline verde da suíte copilot-v2 antes de tocar nada (anotar counts literais pra comparar no fim):

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os files verdes (o 1-H deixou ~23 files / ~150 tests). Anotar `Test Files` / `Tests`.

**Migration policy do slice**: Tasks 2, 3 e 5 criam NOVAS migrations. Migrations são **imutáveis** — nunca editar `20260626000006`/`20260626000008`/`20260531214954`/`20260531174908`; sempre uma migration nova com timestamp real (`date -u +%Y%m%d%H%M%S`). Default target = **dev** (`bcfadphgsibjzivtbjvc`); **PROD PROIBIDO neste slice**. As migrations são marcadas **committed-not-applied**: dev tem drift (28+ migrations não-aplicadas, ver memória `project_dev_baseline_divergent`) — a fundação copilot-v2 (`20260531174908`, `20260531214954`) pode faltar em dev. **O executor valida o que existe em dev (`supabase migration list --project-ref bcfadphgsibjzivtbjvc`) ANTES de aplicar**, e aplica a cadeia faltante via MCP `apply_migration` na ordem do timestamp. Se a fundação faltar e não puder ser aplicada limpa → **parar e sinalizar** (sessão separada de reset de dev, não inventar).

---

## Task 1 — #40/#41 RPCs `match_*` org-scoped (predicate `organization_id`)

**Problem** (auditoria #40/#41): as 3 RPCs RAG da v1 filtram só por `agent_id`/`lead_id`, NUNCA por `organization_id`:

- `match_document_chunks` (`20260626000006_pgvector_rag_embeddings.sql` linhas 86–104): `WHERE c.agent_id = agent_id_filter`.
- `match_faqs` (mesma migration, linhas 107–125): `WHERE f.agent_id = agent_id_filter`.
- `match_lead_memories` (`20260626000008_lead_long_term_memory.sql` linhas 50–68): `WHERE m.lead_id = lead_id_filter`.

`agent_id`/`lead_id` são UUIDs não-adivinháveis, então o vazamento cross-org exige um id válido de outra org — mas a defesa-em-profundidade do projeto exige que **toda** query de dados de cliente filtre `organization_id` (CLAUDE.md raiz: "Toda query filtra organization_id"). Um caller com o `agent_id` errado-mas-válido (bug de roteamento, id reaproveitado) leria chunks/FAQs/memórias de outra org. As funções são `LANGUAGE sql STABLE` **sem** `SECURITY DEFINER` e sem revoke — qualquer role com EXECUTE as chama.

**Fix** — NOVA migration que recria as 3 funções adicionando um parâmetro `p_org_id uuid` e o predicate `AND <t>.organization_id = p_org_id`. Mantém os params existentes (default-compatível: o novo param entra no fim com... não — pgvector RPCs são chamadas por nome de arg no supabase-js, então a posição não importa; adicionamos `p_org_id` SEM default pra forçar todo caller a passá-lo, fail-CLOSED). Adiciona `revoke all ... grant execute to service_role` (essas RPCs só são chamadas pelo backend). `match_lead_memories` ganha o predicate sobre `m.organization_id` (a coluna já existe na tabela, linha 13 da migration original).

> Migrations são imutáveis — esta é uma NOVA migration que faz `create or replace function` das 3 (a assinatura muda porque adicionamos `p_org_id`, então também `drop function` da assinatura antiga pra não deixar overload órfão). **committed-not-applied** (dev pode não ter `20260626000006`/`...8` — validar antes).

### Files

- **Create** `supabase/migrations/<TS>_rag_match_rpcs_org_scope.sql`.
- **Modify** `supabase/functions/_shared/copilot/rag.ts` — passar `p_org_id` nas 3 chamadas RPC (linhas 41–46, 55–60, 94–99).
- **Modify** `supabase/functions/_shared/copilot/search-knowledge.ts` — passar `p_org_id` em `match_document_chunks`/`match_faqs` (linhas 54–59, 69–74) + assinatura da função recebe `organizationId`.
- **Modify** `supabase/functions/_shared/copilot/knowledge-retriever.ts` — idem (as 2 chamadas doc/faq + a memory).
- **Create** test `tests/unit/copilot-v2/rag-rpc-org-scope.test.ts` (prova, via mock que captura args de RPC, que toda chamada `match_*` carrega `p_org_id`).

### Steps

- [ ] Ler as 3 assinaturas atuais. `match_document_chunks` (`20260626000006` 86–104):

```sql
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding  vector(1536),
  agent_id_filter  UUID,
  match_count      INTEGER DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, document_id UUID, content TEXT, similarity FLOAT)
LANGUAGE sql STABLE AS $body$
  SELECT c.id, c.document_id, c.content, 1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.copilot_agent_document_chunks c
  WHERE c.agent_id = agent_id_filter
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$body$;
```

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/rag-rpc-org-scope.test.ts`. Ele exercita os 3 callers v1 com um supabase mock que grava os args de cada `rpc()`, e exige `p_org_id` presente em toda chamada `match_*`:

```ts
/**
 * Slice 7 #40/#41 — toda RPC match_* RAG é org-scoped (Copilot v2)
 *
 * match_document_chunks/match_faqs/match_lead_memories filtravam só por
 * agent_id/lead_id (sem organization_id). Defesa-em-profundidade do projeto
 * exige predicate org em TODA query de dados de cliente. Provamos no nível
 * dos callers: nenhuma chamada match_* sai sem p_org_id (fail-CLOSED — sem
 * default no SQL, então omitir é erro).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { retrieveSemanticContext, retrieveLongTermMemories } from '../../../supabase/functions/_shared/copilot/rag.ts';
import { executeSearchKnowledge } from '../../../supabase/functions/_shared/copilot/search-knowledge.ts';

// Embeddings precisa de OPENROUTER_API_KEY; stubamos Deno.env + fetch.
const g = globalThis as any;
beforeEach(() => {
  g.Deno = { env: { get: (k: string) => (k === 'OPENROUTER_API_KEY' ? 'test-key' : undefined) } };
  g.fetch = async () => ({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.01), index: 0 }] }) });
});

function mockSupabase() {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const rpc = async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: [], error: null }; };
  const from = () => {
    const b: any = { select: () => b, eq: () => b, then: (r: any) => r({ data: [], error: null }) };
    return b;
  };
  return { rpc, from, rpcCalls };
}

const MATCH_RPCS = ['match_document_chunks', 'match_faqs', 'match_lead_memories'];

describe('RAG match_* RPCs — org-scoped', () => {
  it('retrieveSemanticContext passes p_org_id to match_document_chunks and match_faqs', async () => {
    const sb = mockSupabase();
    await retrieveSemanticContext(sb as any, 'catálogo de aços', 'agent-1', 'org-1');
    const matchCalls = sb.rpcCalls.filter((c) => MATCH_RPCS.includes(c.name));
    expect(matchCalls.length).toBeGreaterThan(0);
    for (const c of matchCalls) expect(c.args.p_org_id).toBe('org-1');
  });

  it('retrieveLongTermMemories passes p_org_id to match_lead_memories', async () => {
    const sb = mockSupabase();
    await retrieveLongTermMemories(sb as any, 'dor do lead', 'lead-1', 'org-1');
    const c = sb.rpcCalls.find((x) => x.name === 'match_lead_memories');
    expect(c!.args.p_org_id).toBe('org-1');
  });

  it('executeSearchKnowledge passes p_org_id to every match_* call', async () => {
    const sb = mockSupabase();
    await executeSearchKnowledge(sb as any, 'tabela de preços', 'agent-1', 'org-1');
    const matchCalls = sb.rpcCalls.filter((c) => MATCH_RPCS.includes(c.name));
    expect(matchCalls.length).toBeGreaterThan(0);
    for (const c of matchCalls) expect(c.args.p_org_id).toBe('org-1');
  });
});
```

- [ ] Rodar — esperar FALHAR (os callers não passam `p_org_id`, e a assinatura de `retrieveSemanticContext`/`executeSearchKnowledge` ainda não tem o param `organizationId`):

```bash
npx vitest run tests/unit/copilot-v2/rag-rpc-org-scope.test.ts
```

Esperado: `Test Files 1 failed` — `c.args.p_org_id` é `undefined`, ou erro de aridade na chamada.

- [ ] Criar a migration com timestamp real:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_rag_match_rpcs_org_scope.sql"
echo "$TS"
```

- [ ] Escrever o SQL da migration (`supabase/migrations/<TS>_rag_match_rpcs_org_scope.sql`). `drop` da assinatura antiga + `create` com `p_org_id` + revoke/grant:

```sql
-- ============================================================================
-- RAG match_* RPCs — org-scope (#40/#41). Adiciona predicate organization_id
-- (defesa-em-profundidade multi-tenant) às 3 funções de busca semântica v1.
-- Supersede as assinaturas de 20260626000006 / 20260626000008 (imutáveis).
-- committed-not-applied: dev pode não ter as migrations base — validar antes.
-- NÃO aplicar em prod neste slice (CTO-gated).
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
        and f.organization_id = p_org_id
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
```

> **Nota pro executor:** `copilot_agent_faqs.organization_id` precisa existir. Confirmar com `\d copilot_agent_faqs` em dev; se a coluna não existir (faqs herdam org só via agent), troque o predicate por `and f.agent_id in (select id from public.copilot_agents where id = agent_id_filter and organization_id = p_org_id)` — registre a escolha no commit. Não inventar coluna.

- [ ] Atualizar os 3 callers v1 pra passar `p_org_id`. Em `rag.ts retrieveSemanticContext` (adicionar param `organizationId: string` na assinatura, linha 26–30) e nas RPCs:

```ts
    const { data: chunks, error: chunksErr } = await (supabase as any).rpc("match_document_chunks", {
      query_embedding: embeddingStr,
      agent_id_filter: agentId,
      p_org_id: organizationId,
      match_count: 6,
      similarity_threshold: DOC_THRESHOLD,
    });
```

```ts
    const { data: faqs, error: faqsErr } = await (supabase as any).rpc("match_faqs", {
      query_embedding: embeddingStr,
      agent_id_filter: agentId,
      p_org_id: organizationId,
      match_count: 4,
      similarity_threshold: FAQ_THRESHOLD,
    });
```

  Em `rag.ts retrieveLongTermMemories` (adicionar param `organizationId: string`):

```ts
    const { data: memories, error } = await (supabase as any).rpc("match_lead_memories", {
      query_embedding: embeddingStr,
      lead_id_filter: leadId,
      p_org_id: organizationId,
      match_count: 5,
      similarity_threshold: MEMORY_THRESHOLD,
    });
```

  (`DOC_THRESHOLD`/`FAQ_THRESHOLD`/`MEMORY_THRESHOLD` vêm de `rag-threshold.ts` — criado na Task 4. Por ora, importar dali; se a Task 4 ainda não rodou nesta sessão, usar os literais `0.55`/`0.5`/`0.7` e trocar pelo import na Task 4.) Replicar a mesma adição de `p_org_id` + param `organizationId` em `search-knowledge.ts executeSearchKnowledge` (as 2 chamadas) e nas 3 chamadas de `knowledge-retriever.ts`.

> **Soft-dep / ordering**: estes callers v1 (`_shared/copilot/*`) são deletados no **Slice 12** (decommission GEN-1). O Slice 0-C já removeu o `knowledge-retriever.ts`? **Confirmar com grep** — o brief 0-C lista `knowledge-retriever.ts` como deletado. Se já foi deletado em develop, **omitir** as edições de `knowledge-retriever.ts` (não recriar arquivo morto) e marcar só `rag.ts`/`search-knowledge.ts`. Ajustar `Files` conforme o estado real de develop. O ganho de segurança real do slice é a migration (RPC org-scoped); os callers só precisam passar o arg novo enquanto vivos.

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/rag-rpc-org-scope.test.ts
```

Esperado: `Tests 3 passed (3)`.

- [ ] **Segurança** 🔒: predicate `organization_id` adicionado às 3 RPCs (defesa-em-profundidade — `agent_id`/`lead_id` deixam de ser a única fronteira). `security definer set search_path = public` + `revoke all from public/anon/authenticated` + `grant execute to service_role` (só o backend chama). `p_org_id` SEM default no SQL → omitir é erro de compilação/aridade, não um silent-open (fail-CLOSED). O `organizationId` passado pelos callers vem do contexto do agente/lead, nunca do LLM.

- [ ] Commit:

```bash
git add supabase/migrations/*_rag_match_rpcs_org_scope.sql \
        supabase/functions/_shared/copilot/rag.ts \
        supabase/functions/_shared/copilot/search-knowledge.ts \
        tests/unit/copilot-v2/rag-rpc-org-scope.test.ts
git commit -m "$(cat <<'EOF'
fix(copilot): RPCs match_* RAG org-scoped (predicate organization_id)

match_document_chunks/match_faqs/match_lead_memories filtravam só por
agent_id/lead_id. Defesa-em-profundidade multi-tenant exige predicate org
em toda query de dados de cliente (#40/#41). Nova migration recria as 3
com p_org_id obrigatório (sem default = fail-closed) + security definer +
revoke/grant service_role. Callers v1 passam o org do contexto.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Schema de ingestão determinístico (status FSM + colunas de auditoria)

**Problem**: `copilot_v2_knowledge` (`20260531214954` linhas 40–48) tem `status copilot_v2_knowledge_status` (enum `pending|ingesting|ready|failed`) mas **nenhuma** coluna pra (a) registrar a mensagem de erro, (b) detectar travamento (`updated_at`/`ingesting_started_at`), ou (c) marcar `ingested_at`. Sem `updated_at` num `ingesting`, é impossível um reaper saber que a row travou — exatamente a classe do incidente VitrineVET 2026-06-01: o `process-agent-document` v1 marcava `processing` e, quando o embedding falhava (OPENROUTER_API_KEY errada → 401), o erro propagava pro outer catch que **não resetava o status** → doc preso em `processing` pra sempre, sem `error_message`, e a tool nunca o oferecia. A tabela v2 herda o mesmo gap.

**Fix** — NOVA migration: adiciona `error_message text`, `updated_at timestamptz default now()`, `ingesting_started_at timestamptz`, `ingested_at timestamptz` em `copilot_v2_knowledge`. Adiciona uma RPC `copilot_v2_reap_stale_ingestion(p_timeout_minutes int default 10)` que devolve rows presas em `ingesting` (`ingesting_started_at < now() - interval`) pra `failed` com `error_message` determinístico (visibility-timeout, espelha o reaper de fila do 1-H Task 4). Sem isso o doc trava silencioso.

> Migration imutável — NOVA. **committed-not-applied** (dev pode não ter `20260531214954`).

### Files

- **Create** `supabase/migrations/<TS>_copilot_v2_knowledge_ingestion_audit.sql`.
- **Create** `supabase/migrations/<TS+1>_schedule_copilot_v2_ingestion_reaper.sql` (cron do reaper).

### Steps

- [ ] Ler o schema atual de `copilot_v2_knowledge` (`20260531214954` 40–48) — confirmar que NÃO há `updated_at`/`error_message`.

- [ ] Criar as migrations com timestamps reais:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_copilot_v2_knowledge_ingestion_audit.sql"
echo "$TS"   # anotar
```

- [ ] Escrever o SQL (`supabase/migrations/<TS>_copilot_v2_knowledge_ingestion_audit.sql`):

```sql
-- ============================================================================
-- Copilot v2 — ingestão determinística (audit inbound, incidente VitrineVET
-- 2026-06-01 / #668/#670). copilot_v2_knowledge ganha colunas de auditoria +
-- um reaper de visibility-timeout pra rows presas em 'ingesting'.
-- committed-not-applied: dev pode não ter 20260531214954 — validar antes.
-- NÃO aplicar em prod neste slice.
-- ============================================================================
alter table public.copilot_v2_knowledge
  add column if not exists error_message        text,
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists ingesting_started_at timestamptz,
  add column if not exists ingested_at          timestamptz;

create index if not exists idx_copilot_v2_knowledge_status_started
  on public.copilot_v2_knowledge (status, ingesting_started_at);

-- Reaper: rows presas em 'ingesting' além do visibility-timeout (worker morto
-- / timeout de extração) viram 'failed' com motivo determinístico, NUNCA ficam
-- presas. Espelha copilot_v2_reap_stale_processing do 1-H. Retorna count.
create or replace function public.copilot_v2_reap_stale_ingestion(p_timeout_minutes int default 10)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with reaped as (
    update public.copilot_v2_knowledge
       set status = 'failed', updated_at = now(),
           error_message = coalesce(error_message, 'reaped: ingestão travada além do visibility-timeout')
     where status = 'ingesting'
       and ingesting_started_at is not null
       and ingesting_started_at < now() - make_interval(mins => p_timeout_minutes)
    returning 1
  )
  select count(*) into v_count from reaped;
  return v_count;
end $$;

revoke all on function public.copilot_v2_reap_stale_ingestion(int) from public, anon, authenticated;
grant execute on function public.copilot_v2_reap_stale_ingestion(int) to service_role;
```

- [ ] Criar o schedule do reaper (`supabase/migrations/<TS+1>_schedule_copilot_v2_ingestion_reaper.sql`), espelhando `20260602151331_schedule_copilot_v2_reaper.sql` — roda 1/min, chama o reaper direto em SQL (op pura de DB, sem pg_net):

```sql
-- Agenda o reaper de ingestão travada (visibility-timeout 10min) a cada minuto.
-- NÃO aplicar em prod neste slice.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron ausente — skip schedule copilot_v2_ingestion_reaper'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_ingestion_reaper') then
    perform cron.unschedule('copilot_v2_ingestion_reaper');
  end if;
  perform cron.schedule('copilot_v2_ingestion_reaper', '* * * * *',
    'SELECT public.copilot_v2_reap_stale_ingestion(10)');
end $outer$;
```

- [ ] **Segurança** 🔒: reaper é `SECURITY DEFINER` org-agnóstico por design (queue-wide de uma tabela só), mas só faz transição de status em `copilot_v2_knowledge` (não retorna conteúdo de outra org — devolve um count). `revoke all from public/anon/authenticated`, `grant execute to service_role`. Sem `updated_at` num `ingesting` não havia como detectar travamento → o fix é estruturalmente o que mata o doc-preso-em-processing.

- [ ] Commit (não há red/green de Vitest pra SQL puro — a prova roda no nível DB na Task 6 e o caminho FSM é testado na Task 3; este commit entrega só o schema):

```bash
git add supabase/migrations/*_copilot_v2_knowledge_ingestion_audit.sql \
        supabase/migrations/*_schedule_copilot_v2_ingestion_reaper.sql
git commit -m "$(cat <<'EOF'
feat(copilot-v2): schema de ingestão determinístico + reaper de travada

copilot_v2_knowledge não tinha error_message/updated_at/ingesting_started_at,
então um 'ingesting' que falhava ficava preso pra sempre (classe do incidente
VitrineVET 2026-06-01 / #668/#670). Adiciona colunas de auditoria + RPC
copilot_v2_reap_stale_ingestion (visibility-timeout 10min -> failed com motivo)
agendada em cron próprio. Não aplicado em prod.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Pipeline de ingestão media→texto (FSM pura + edge fn) com audit inbound

**Problem**: não existe ingestão pro acervo de conhecimento v2. A KB (`copilot_v2_knowledge`, Slice 6 popula) precisa virar texto buscável: PDF/doc extrai+chunk, imagem OCR/caption → embed 1536d → `copilot_v2_knowledge_chunks`. E o caminho herdado (`process-agent-document/index.ts`) tem 3 lições do incidente VitrineVET (memória `project_copilot_media_send_incident`): (1) passava `GEMINI_API_KEY` onde o OpenRouter espera `OPENROUTER_API_KEY` → 401 silencioso; (2) media path travava em `processing` no erro; (3) o erro de embedding sumia. A nova ingestão v2 nasce com a credencial **validada no entry**, transições de status **determinísticas** (sempre sai de `ingesting`), e **falha não-silenciosa** (status `failed` + `error_message` + trace step).

**Fix**: módulo PURO `ingestion.ts` decide a transição de status e a estratégia de extração (decisão sem I/O, unit-testável); a edge fn `copilot-v2-ingest-knowledge` é o shell I/O que valida `OPENROUTER_API_KEY` no topo, marca `ingesting` + `ingesting_started_at`, extrai (multimodal via OpenAI pra OCR/PDF, reusando `extractViaMultimodal` do v1), chunka via `chunkText`, embeda via `generateEmbedding` (com retry), grava chunks org-scoped, e **sempre** transiciona pra `ready` (com `ingested_at`) ou `failed` (com `error_message`). Nenhum catch externo deixa a row em `ingesting`.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/ingestion.ts` — PURO: `decideIngestionExtractor(sourceKind, mime)` + `nextIngestionStatus(outcome)` + `chunkForEmbedding(text)` (re-export de `chunkText`).
- **Create** `supabase/functions/copilot-v2-ingest-knowledge/index.ts` — edge fn shell (valida key, FSM de status, extração, embed+retry, grava chunks).
- **Modify** `supabase/config.toml` — registrar `[functions.copilot-v2-ingest-knowledge]` `verify_jwt = false` (auth via x-cron-secret/service — chamada pelo backend após upload).
- **Create** test `tests/unit/copilot-v2/ingestion.test.ts` (FSM + decisão de extrator, puro).

### Steps

- [ ] Ler o entry-validation pattern do v1 (`process-agent-document/index.ts` 181–200): `OPENAI_API_KEY` E `OPENROUTER_API_KEY` validadas no topo, retornando 500 explícito quando faltam (a correção do bug 401-silencioso). Ler `extractViaMultimodal` (97–140) e `chunkText` (`embeddings.ts` 122–166).

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/ingestion.test.ts` (módulo puro — sem DB/fetch):

```ts
/**
 * Slice 7 — FSM de ingestão pura (Copilot v2)
 *
 * A transição de status é determinística e SEMPRE sai de 'ingesting': sucesso
 * com chunks -> 'ready'; qualquer falha (extração vazia / embedding) -> 'failed'
 * com motivo. Nunca fica preso em 'ingesting' (lição VitrineVET). A escolha do
 * extrator é por source_kind/mime.
 */
import { describe, it, expect } from 'vitest';
import {
  decideIngestionExtractor,
  nextIngestionStatus,
  type IngestionOutcome,
} from '../../../supabase/functions/_shared/copilot-v2/ingestion.ts';

describe('decideIngestionExtractor', () => {
  it('rota pdf/doc para extração multimodal de texto', () => {
    expect(decideIngestionExtractor('pdf', 'application/pdf')).toBe('multimodal_text');
    expect(decideIngestionExtractor('doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx_text');
  });
  it('rota imagem para OCR/caption multimodal', () => {
    expect(decideIngestionExtractor('image', 'image/png')).toBe('multimodal_ocr');
  });
  it('rota vídeo para transcrição', () => {
    expect(decideIngestionExtractor('video', 'video/mp4')).toBe('transcript');
  });
});

describe('nextIngestionStatus — determinístico, nunca preso em ingesting', () => {
  it('sucesso com chunks -> ready', () => {
    const out: IngestionOutcome = { chunksStored: 4, error: null };
    expect(nextIngestionStatus(out)).toEqual({ status: 'ready', error_message: null });
  });
  it('extração vazia -> failed (não silencioso)', () => {
    const out: IngestionOutcome = { chunksStored: 0, error: 'texto extraído vazio' };
    expect(nextIngestionStatus(out)).toEqual({ status: 'failed', error_message: 'texto extraído vazio' });
  });
  it('falha de embedding -> failed com motivo (não silencioso)', () => {
    const out: IngestionOutcome = { chunksStored: 0, error: 'embedding 401: missing OPENROUTER_API_KEY' };
    expect(nextIngestionStatus(out)).toMatchObject({ status: 'failed' });
    expect(nextIngestionStatus(out).error_message).toContain('401');
  });
  it('zero chunks SEM erro explícito ainda é failed (fail-closed)', () => {
    const out: IngestionOutcome = { chunksStored: 0, error: null };
    expect(nextIngestionStatus(out)).toMatchObject({ status: 'failed' });
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo não existe):

```bash
npx vitest run tests/unit/copilot-v2/ingestion.test.ts
```

Esperado: `Test Files 1 failed` — erro de import.

- [ ] Implementar o módulo puro `supabase/functions/_shared/copilot-v2/ingestion.ts`:

```ts
/**
 * ingestion — Copilot v2 KB ingestion decision core (Slice 7, PURE).
 *
 * Sem I/O. Decide (a) qual extrator usar por source_kind/mime e (b) a transição
 * de status determinística do registro de conhecimento. INVARIANTE: a ingestão
 * SEMPRE sai de 'ingesting' — sucesso -> 'ready', qualquer falha -> 'failed'
 * com error_message. Nunca fica presa (lição do incidente VitrineVET 2026-06-01).
 */

import { chunkText } from "../embeddings.ts";

export type Extractor = "multimodal_text" | "docx_text" | "multimodal_ocr" | "transcript";

const DOCX_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function decideIngestionExtractor(
  sourceKind: "pdf" | "doc" | "image" | "video",
  mime: string,
): Extractor {
  if (sourceKind === "image") return "multimodal_ocr";
  if (sourceKind === "video") return "transcript";
  if (sourceKind === "doc" && DOCX_MIMES.has(mime)) return "docx_text";
  return "multimodal_text"; // pdf + doc genérico
}

export interface IngestionOutcome {
  chunksStored: number;
  /** mensagem de erro determinística, ou null no sucesso */
  error: string | null;
}

export function nextIngestionStatus(
  outcome: IngestionOutcome,
): { status: "ready" | "failed"; error_message: string | null } {
  if (outcome.error) return { status: "failed", error_message: outcome.error };
  if (outcome.chunksStored > 0) return { status: "ready", error_message: null };
  // zero chunks sem erro explícito → ainda é falha (fail-CLOSED, nunca 'ready' vazio)
  return { status: "failed", error_message: "ingestão produziu 0 chunks" };
}

/** Re-export do chunker compartilhado (1800 char, overlap 50) pra a edge fn. */
export function chunkForEmbedding(text: string): string[] {
  return chunkText(text);
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/ingestion.test.ts
```

Esperado: `Tests 8 passed (8)`.

- [ ] Implementar a edge fn shell `supabase/functions/copilot-v2-ingest-knowledge/index.ts` (validação de credencial no entry; FSM de status; embed com retry; falha não-silenciosa). Bloco literal:

```ts
/**
 * copilot-v2-ingest-knowledge — Copilot v2 KB ingestion worker (Slice 7).
 *
 * Recebe { knowledgeId }. Marca 'ingesting' + ingesting_started_at, extrai
 * texto (multimodal OCR/PDF), chunka, embeda 1536d (com retry), grava chunks
 * org-scoped, e SEMPRE transiciona pra 'ready' (com ingested_at) ou 'failed'
 * (com error_message + trace). NUNCA deixa preso em 'ingesting'.
 *
 * Auth: x-cron-secret (chamada pelo backend após upload). config.toml: verify_jwt=false.
 * org_id vem da row de copilot_v2_knowledge (org-scoped), NUNCA do payload.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { generateEmbeddingsBatch } from "../_shared/embeddings.ts";
import { decideIngestionExtractor, nextIngestionStatus, chunkForEmbedding } from "../_shared/copilot-v2/ingestion.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const VISION_MODEL = "gpt-4o";
const EMBED_RETRIES = 2;

serve(withSentry("copilot-v2-ingest-knowledge", async (req: Request) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "unauthorized" }, 401);

  // ── Validar credenciais NO ENTRY (lição VitrineVET: sem fallback silencioso) ──
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY não configurada" }, 500);
  if (!OPENROUTER_API_KEY) return json({ error: "OPENROUTER_API_KEY não configurada" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let knowledgeId: string;
  try { knowledgeId = (await req.json()).knowledgeId; } catch { return json({ error: "invalid_schema" }, 400); }
  if (!knowledgeId) return json({ error: "knowledgeId obrigatório" }, 400);

  const { data: kn, error: knErr } = await supabase
    .from("copilot_v2_knowledge")
    .select("id, organization_id, storage_path, source_kind, status")
    .eq("id", knowledgeId).maybeSingle();
  if (knErr || !kn) return json({ error: "knowledge não encontrado" }, 404);

  // Marca 'ingesting' + timestamp (o reaper da Task 2 desbloqueia se travar).
  await supabase.from("copilot_v2_knowledge")
    .update({ status: "ingesting", ingesting_started_at: new Date().toISOString(), updated_at: new Date().toISOString(), error_message: null })
    .eq("id", knowledgeId);

  let chunksStored = 0;
  let error: string | null = null;
  try {
    // Download org-scoped (bucket de KB; storage_path da row, não do payload).
    const { data: signed, error: signErr } = await supabase.storage.from("copilot-v2-knowledge").createSignedUrl(kn.storage_path, 600);
    if (signErr || !signed?.signedUrl) throw new Error(`signed url: ${signErr?.message ?? "vazio"}`);
    const fileRes = await fetch(signed.signedUrl);
    if (!fileRes.ok) throw new Error(`download ${fileRes.status}`);
    const bytes = new Uint8Array(await fileRes.arrayBuffer());

    const mime = (kn as any).mime_type ?? (kn.source_kind === "pdf" ? "application/pdf" : "application/octet-stream");
    const extractor = decideIngestionExtractor(kn.source_kind as any, mime);

    let text = "";
    if (extractor === "multimodal_text" || extractor === "multimodal_ocr") {
      const base64 = encodeBase64(bytes);
      const isPdf = extractor === "multimodal_text" && kn.source_kind === "pdf";
      const prompt = isPdf
        ? "Extraia TODO o texto deste PDF de forma fiel. Transcreva tabelas em markdown. NÃO resuma."
        : "Descreva e transcreva TODO o texto visível desta imagem (preços, produtos, specs). Tabelas em markdown.";
      const contentPart = isPdf
        ? { type: "file", file: { filename: kn.storage_path, file_data: `data:${mime};base64,${base64}` } }
        : { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } };
      const res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: VISION_MODEL, messages: [{ role: "user", content: [{ type: "text", text: prompt }, contentPart] }], temperature: 0.1, max_tokens: 16000 }),
      });
      if (!res.ok) throw new Error(`multimodal ${res.status}: ${(await res.text()).slice(0, 200)}`);
      text = (await res.json()).choices?.[0]?.message?.content ?? "";
    } else if (extractor === "docx_text") {
      text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else {
      // 'transcript' (vídeo) — provider de transcrição é decisão aberta (ver Decisões abertas).
      throw new Error("transcrição de vídeo ainda não suportada (decisão de provider pendente)");
    }

    if (!text || text.trim().length < 10) throw new Error(`texto extraído vazio (${text?.length ?? 0} chars)`);

    const chunks = chunkForEmbedding(text.substring(0, 500000).replace(/\x00/g, ""));
    if (chunks.length === 0) throw new Error("0 chunks após chunking");

    // Embedding com retry (sem fallback silencioso — falha propaga p/ 'failed').
    let embeddings: number[][] | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt <= EMBED_RETRIES; attempt++) {
      try { embeddings = await generateEmbeddingsBatch(chunks, OPENROUTER_API_KEY); break; }
      catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    }
    if (!embeddings) throw new Error(`embedding falhou após ${EMBED_RETRIES + 1} tentativas: ${lastErr}`);

    await supabase.from("copilot_v2_knowledge_chunks").delete().eq("knowledge_id", knowledgeId);
    const rows = chunks.map((content, i) => ({
      knowledge_id: knowledgeId,
      organization_id: kn.organization_id, // org da ROW, nunca do payload
      content,
      embedding: `[${embeddings![i].join(",")}]`,
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error: insErr } = await supabase.from("copilot_v2_knowledge_chunks").insert(rows.slice(i, i + 50));
      if (insErr) throw new Error(`insert chunks: ${insErr.message}`);
    }
    chunksStored = rows.length;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Transição determinística — SEMPRE sai de 'ingesting'.
  const next = nextIngestionStatus({ chunksStored, error });
  await supabase.from("copilot_v2_knowledge").update({
    status: next.status,
    error_message: next.error_message,
    extracted_text: error ? null : undefined,
    ingested_at: next.status === "ready" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", knowledgeId);

  // Falha NÃO-silenciosa: trace step (metadata only, sem PII).
  await supabase.from("copilot_v2_trace_steps").insert({
    trace_id: null, step: "ingestion", reason: next.status,
    meta: { knowledge_id: knowledgeId, organization_id: kn.organization_id, chunks: chunksStored, error: error ?? undefined },
  }).then(() => {}, () => {});

  return json({ status: next.status, chunks: chunksStored, error });
}));
```

> **Nota pro executor:** `copilot_v2_trace_steps.trace_id` é `not null references copilot_v2_traces(trace_id)` (foundation 135–137). A ingestão não tem um turn-trace; **não** insira com `trace_id: null` (viola FK). Em vez disso, logue a falha de ingestão via `logRuntime` (`_shared/logger.ts`, igual ao `process-agent-document`) OU em `copilot_v2_knowledge.error_message` (já feito) — a row `failed` + `error_message` JÁ é o "não-silencioso". Remova o insert em `trace_steps` se a FK reclamar; mantenha o `logRuntime`. Confirmar a FK em dev antes.

- [ ] Registrar no `supabase/config.toml` (após o bloco `[functions.copilot-v2-worker]`, linha ~289):

```toml
# copilot-v2-ingest-knowledge: ingere KB (media->texto->embed); auth x-cron-secret; org da row
[functions.copilot-v2-ingest-knowledge]
verify_jwt = false
```

- [ ] **Segurança** 🔒: `OPENROUTER_API_KEY` + `OPENAI_API_KEY` validadas no entry (mata o 401-silencioso). `organization_id` vem da row `copilot_v2_knowledge` (org-scoped), NUNCA do payload — o caller só passa `knowledgeId`. Storage via signed URL no bucket de KB org-scoped. Falha de embedding propaga → status `failed` + `error_message` (não-silenciosa). Transição determinística (FSM pura) → nunca preso em `ingesting`; o reaper da Task 2 é a rede de segurança. Custo de ingestão (OCR/multimodal) acontece no upload, não no turn (ADR consequence "Media→text ingestion adds OCR cost at upload time").

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/ingestion.ts \
        supabase/functions/copilot-v2-ingest-knowledge/index.ts \
        supabase/config.toml \
        tests/unit/copilot-v2/ingestion.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): ingestão KB media->texto com FSM determinística

Nova edge fn copilot-v2-ingest-knowledge + módulo puro ingestion.ts:
valida OPENROUTER/OPENAI key no entry (mata 401-silencioso do VitrineVET),
extrai texto (multimodal OCR/PDF), chunka, embeda 1536d com retry, grava
chunks org-scoped. Status SEMPRE sai de 'ingesting' (ready/failed+motivo).
Falha de embedding nunca silenciosa.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Threshold RAG centralizado (consolidar os 3 divergentes)

**Problem**: a v1 tem **3 thresholds divergentes** pro mesmo conceito (similaridade mínima de chunk de doc):
- `rag.ts:45` → `0.6` (doc), `:59` → `0.65` (faq), `:98` → `0.7` (memory).
- `search-knowledge.ts:58` → `0.55` (doc), `:73` → `0.5` (faq); constantes exportadas `:14-15` → faq `0.65`/doc `0.6` (nem batem com o uso inline!).
- `knowledge-retriever.ts:14-15` → doc `0.5`(initial)/`0.55`(tool), faq `0.65`/`0.5`.

Mesma query, threshold diferente por caminho → comportamento de recall inconsistente e impossível de tunar (a v1 nunca soube qual valor estava em vigor).

**Fix**: módulo único `rag-threshold.ts` com as constantes consolidadas + helper. Os 3 callers importam dali; nenhum literal solto. Default justificado: **doc=0.55, faq=0.5, memory=0.7** (o caminho `search-knowledge` em modo tool é o mais exercitado em prod; favorece recall pra catálogo B2B; o LLM-judge da Slice 5 filtra ruído). **Ajustável** num lugar só. NÃO é decisão de produto — é tuning técnico parametrizado.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/rag-threshold.ts`.
- **Modify** `supabase/functions/_shared/copilot/rag.ts`, `search-knowledge.ts`, (`knowledge-retriever.ts` se ainda vivo) — substituir literais pelos imports.
- **Create** test `tests/unit/copilot-v2/rag-threshold.test.ts`.

### Steps

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/rag-threshold.test.ts`:

```ts
/**
 * Slice 7 — threshold RAG centralizado (Copilot v2)
 *
 * A v1 tinha 3 thresholds divergentes pro mesmo conceito (doc 0.5/0.55/0.6).
 * Consolidado num módulo único, ajustável num lugar só, com defaults expostos.
 */
import { describe, it, expect } from 'vitest';
import { RAG_THRESHOLDS, resolveThreshold } from '../../../supabase/functions/_shared/copilot-v2/rag-threshold.ts';

describe('RAG_THRESHOLDS — fonte única', () => {
  it('expõe os 3 thresholds consolidados', () => {
    expect(RAG_THRESHOLDS).toEqual({ doc: 0.55, faq: 0.5, memory: 0.7 });
  });
  it('resolveThreshold devolve o default por kind', () => {
    expect(resolveThreshold('doc')).toBe(0.55);
    expect(resolveThreshold('faq')).toBe(0.5);
    expect(resolveThreshold('memory')).toBe(0.7);
  });
  it('resolveThreshold respeita um override válido (tuning sem editar o módulo)', () => {
    expect(resolveThreshold('doc', 0.7)).toBe(0.7);
  });
  it('ignora override fora de [0,1] (fail-safe pro default)', () => {
    expect(resolveThreshold('doc', 1.5)).toBe(0.55);
    expect(resolveThreshold('doc', -1)).toBe(0.55);
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo não existe):

```bash
npx vitest run tests/unit/copilot-v2/rag-threshold.test.ts
```

Esperado: `Test Files 1 failed`.

- [ ] Implementar `supabase/functions/_shared/copilot-v2/rag-threshold.ts`:

```ts
/**
 * rag-threshold — Copilot v2 single source of truth pro threshold de similaridade
 * RAG (Slice 7). A v1 espalhou 3 valores divergentes (doc 0.5/0.55/0.6); aqui
 * vive um só, ajustável num lugar. Default favorece recall (catálogo B2B); o
 * LLM-judge da Slice 5 filtra ruído downstream.
 */
export type RagKind = "doc" | "faq" | "memory";

export const RAG_THRESHOLDS: Record<RagKind, number> = {
  doc: 0.55,
  faq: 0.5,
  memory: 0.7,
};

/** Resolve o threshold por kind, aceitando um override válido em [0,1]. */
export function resolveThreshold(kind: RagKind, override?: number): number {
  if (typeof override === "number" && override >= 0 && override <= 1) return override;
  return RAG_THRESHOLDS[kind];
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/rag-threshold.test.ts
```

Esperado: `Tests 4 passed (4)`.

- [ ] Substituir os literais nos callers v1 (e fechar a divergência da Task 1). Em `rag.ts`: importar `import { RAG_THRESHOLDS } from "../copilot-v2/rag-threshold.ts";` e usar `RAG_THRESHOLDS.doc`/`.faq`/`.memory` nas 3 RPCs (substituindo `0.6`/`0.65`/`0.7`). Em `search-knowledge.ts`: substituir os inline `0.55`/`0.5` e as constantes exportadas `FAQ_SIMILARITY_THRESHOLD`/`DOC_SIMILARITY_THRESHOLD` por re-exports de `RAG_THRESHOLDS` (manter os nomes exportados pra não quebrar importadores: `export const DOC_SIMILARITY_THRESHOLD = RAG_THRESHOLDS.doc;`).

> **Soft-dep / ordering**: estes callers v1 morrem no Slice 12. O ganho durável é o módulo `rag-threshold.ts`, que o handler `search_knowledge` v2 (Task 5) consome. Se `knowledge-retriever.ts` já foi deletado pelo Slice 0-C, omitir; não recriar.

- [ ] Rodar os vizinhos de regressão (o teste de rag-tuning ancora `executeSearchKnowledge`):

```bash
npx vitest run tests/unit/copilot-v2/rag-threshold.test.ts tests/unit/copilot-v2/rag-rpc-org-scope.test.ts tests/unit/copilot-rag-tuning.test.ts
```

Esperado: os 3 files verdes (rag-tuning preserva os casos LIVE de `executeSearchKnowledge`/`buildDynamicPrompt`).

- [ ] **Segurança** 🔒: nenhuma superfície nova — é tuning. Threshold menor = mais recall (mais ruído passa pro LLM), nunca um bypass de org (o predicate org da Task 1 é independente do threshold). Documentar o default + a justificativa no módulo (feito).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/rag-threshold.ts \
        supabase/functions/_shared/copilot/rag.ts \
        supabase/functions/_shared/copilot/search-knowledge.ts \
        tests/unit/copilot-v2/rag-threshold.test.ts
git commit -m "$(cat <<'EOF'
refactor(copilot-v2): threshold RAG centralizado (1 fonte vs 3 divergentes)

v1 tinha doc 0.5/0.55/0.6 espalhados por rag/search-knowledge/retriever.
Novo rag-threshold.ts consolida (doc=0.55, faq=0.5, memory=0.7), ajustável
num lugar, com resolveThreshold(kind, override). Callers v1 deixam de ter
literais soltos. Tuning técnico, não decisão de produto.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Hybrid search (semântico + keyword) + RPC `copilot_v2_match_knowledge` + handler `search_knowledge`

**Problem**: `tool-executor.ts` (`search_knowledge` está só no `TOOL_REGISTRY` linha 40 mas NÃO em `HANDLERS` 217–227) → hoje a tool retorna `not_implemented` (`createToolExecutor` 239: `if (!handler) throw new ToolError("not_implemented", name)`). Sem ela, o Qualificador/Vendedor não consultam a KB ingerida. Além disso, busca puramente semântica perde match de termo exato (SKU, código de peça) — o ADR #6 pede "hybrid search, not stuffed".

**Fix**: (a) NOVA RPC `copilot_v2_match_knowledge(query_embedding, p_org_id, query_text, match_count, similarity_threshold)` que combina similaridade vetorial em `copilot_v2_knowledge_chunks` com keyword match (`content ILIKE`/`websearch_to_tsquery`) e devolve linhas org-scoped; (b) módulo PURO `hybrid-search.ts` que faz rank-fusion (reciprocal-rank-fusion simples) dos dois conjuntos e aplica o threshold centralizado; (c) handler `search_knowledge` no `tool-executor.ts` que gera o embedding da query, chama a RPC org-scoped (org do `ctx`, nunca do LLM), funde via `hybrid-search.ts`, e devolve texto formatado. Falha de embedding/RAG → throw (não-silenciosa; o cognition-loop registra como tool error no trace).

### Files

- **Create** `supabase/migrations/<TS>_copilot_v2_match_knowledge_rpc.sql`.
- **Create** `supabase/functions/_shared/copilot-v2/hybrid-search.ts` — PURO: `fuseHybridResults(semantic, keyword, opts)`.
- **Modify** `supabase/functions/_shared/copilot-v2/tool-executor.ts` — adicionar handler `search_knowledge` (import de embeddings + hybrid-search + rag-threshold; registrar em `HANDLERS`).
- **Create** test `tests/unit/copilot-v2/hybrid-search.test.ts` (rank-fusion puro).
- **Modify** `tests/unit/copilot-v2/tool-executor.test.ts` — trocar o caso que assume `search_knowledge` = `not_implemented` por um que prova o handler chamando a RPC org-scoped.

### Steps

- [ ] Ler o dispatch do executor (`tool-executor.ts` 234–245) e o caso de teste atual que prova `not_implemented` (`tool-executor.test.ts` 46–51 — usa `send_media`, NÃO `search_knowledge`; confirmar que nenhum caso ainda exercita `search_knowledge`). Ler a invariante org-do-ctx (`tool-executor.ts` 5–13, e o caso `IGNORES an organization_id passed in args`, `tool-executor.test.ts` 72–78).

- [ ] Escrever o teste que falha do módulo puro `tests/unit/copilot-v2/hybrid-search.test.ts`:

```ts
/**
 * Slice 7 — rank-fusion híbrido (Copilot v2, PURE)
 *
 * Funde resultados semânticos (pgvector) + keyword (ILIKE/tsquery) via
 * reciprocal-rank-fusion, deduplica por chunk id, aplica o threshold único,
 * e ordena por score fundido. Sem I/O.
 */
import { describe, it, expect } from 'vitest';
import { fuseHybridResults, type KnowledgeHit } from '../../../supabase/functions/_shared/copilot-v2/hybrid-search.ts';

const sem: KnowledgeHit[] = [
  { id: 1, content: 'Aço SAE 1045 — preço sob consulta', similarity: 0.82 },
  { id: 2, content: 'Catálogo geral de perfis', similarity: 0.58 },
  { id: 3, content: 'Política de frete', similarity: 0.40 },
];
const kw: KnowledgeHit[] = [
  { id: 4, content: 'SKU 1045 ficha técnica', similarity: 1 },
  { id: 1, content: 'Aço SAE 1045 — preço sob consulta', similarity: 1 },
];

describe('fuseHybridResults', () => {
  it('funde e deduplica por id, item presente nos dois sobe no rank', () => {
    const out = fuseHybridResults(sem, kw, { docThreshold: 0.55, limit: 5 });
    const ids = out.map((h) => h.id);
    expect(ids[0]).toBe(1);            // aparece em ambos -> maior RRF
    expect(new Set(ids).size).toBe(ids.length); // sem duplicata
    expect(ids).toContain(4);          // keyword-only entra
  });

  it('aplica o threshold no lado semântico (descarta abaixo do corte)', () => {
    const out = fuseHybridResults(sem, [], { docThreshold: 0.55, limit: 5 });
    expect(out.map((h) => h.id)).not.toContain(3); // 0.40 < 0.55
    expect(out.map((h) => h.id)).toContain(1);
  });

  it('respeita o limit', () => {
    const out = fuseHybridResults(sem, kw, { docThreshold: 0, limit: 2 });
    expect(out.length).toBe(2);
  });

  it('retorna [] quando ambos vazios (sem throw)', () => {
    expect(fuseHybridResults([], [], { docThreshold: 0.55, limit: 5 })).toEqual([]);
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo não existe):

```bash
npx vitest run tests/unit/copilot-v2/hybrid-search.test.ts
```

Esperado: `Test Files 1 failed`.

- [ ] Implementar `supabase/functions/_shared/copilot-v2/hybrid-search.ts`:

```ts
/**
 * hybrid-search — Copilot v2 rank-fusion de busca de conhecimento (Slice 7, PURE).
 *
 * Funde candidatos semânticos (pgvector) + keyword (ILIKE/tsquery) via
 * reciprocal-rank-fusion (RRF, k=60). Aplica o threshold de doc no lado
 * semântico (keyword já é match exato). Deduplica por id, ordena por score
 * fundido, corta no limit. Sem I/O — testável puro.
 */
export interface KnowledgeHit {
  id: number;
  content: string;
  /** similaridade vetorial [0,1] no lado semântico; 1 no lado keyword. */
  similarity: number;
}

export interface FuseOpts {
  docThreshold: number;
  limit: number;
  /** constante RRF (suaviza o peso por rank). */
  rrfK?: number;
}

export function fuseHybridResults(
  semantic: KnowledgeHit[],
  keyword: KnowledgeHit[],
  opts: FuseOpts,
): KnowledgeHit[] {
  const k = opts.rrfK ?? 60;
  const scores = new Map<number, { hit: KnowledgeHit; score: number }>();

  const add = (list: KnowledgeHit[], gate: (h: KnowledgeHit) => boolean) => {
    list.filter(gate).forEach((hit, rank) => {
      const prev = scores.get(hit.id);
      const inc = 1 / (k + rank + 1);
      if (prev) prev.score += inc;
      else scores.set(hit.id, { hit, score: inc });
    });
  };

  // Semântico passa pelo threshold; keyword é match exato (não filtra por similaridade).
  add([...semantic].sort((a, b) => b.similarity - a.similarity), (h) => h.similarity >= opts.docThreshold);
  add(keyword, () => true);

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map((s) => s.hit);
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/hybrid-search.test.ts
```

Esperado: `Tests 4 passed (4)`.

- [ ] Criar a RPC `copilot_v2_match_knowledge`:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_copilot_v2_match_knowledge_rpc.sql"
echo "$TS"
```

  SQL (`supabase/migrations/<TS>_copilot_v2_match_knowledge_rpc.sql`):

```sql
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
```

- [ ] Atualizar `tool-executor.test.ts` — adicionar o caso que prova o handler `search_knowledge` é org-scoped e chama a RPC (substitui a expectativa implícita de `not_implemented`). Estender o `mockSupabase` pra devolver linhas da RPC e stubar embeddings (Deno.env + fetch) no topo do arquivo se ainda não estiver. Adicionar:

```ts
describe('search_knowledge', () => {
  const g = globalThis as any;
  const restore = { Deno: g.Deno, fetch: g.fetch };
  beforeEach(() => {
    g.Deno = { env: { get: (k: string) => (k === 'OPENROUTER_API_KEY' ? 'test-key' : undefined) } };
    g.fetch = async () => ({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.01), index: 0 }] }) });
  });
  afterEach(() => { g.Deno = restore.Deno; g.fetch = restore.fetch; });

  it('chama copilot_v2_match_knowledge com p_org_id do ctx, NUNCA dos args', async () => {
    const sb = mockSupabase({ 'rpc:copilot_v2_match_knowledge': [{ id: 1, content: 'Aço 1045', similarity: 0.8, source: 'semantic' }] });
    const out = await createToolExecutor(sb, ctx)('search_knowledge', { query: 'aço 1045', organization_id: 'EVIL-ORG' });
    const call = sb.rpcCalls.find((c: any) => c.name === 'copilot_v2_match_knowledge');
    expect(call!.args.p_org_id).toBe('org-1');
    expect(call!.args.p_org_id).not.toBe('EVIL-ORG');
    expect(String(out)).toContain('Aço 1045');
  });

  it('throw (não silencioso) quando OPENROUTER_API_KEY falta', async () => {
    g.Deno = { env: { get: () => undefined } };
    const sb = mockSupabase();
    await expect(createToolExecutor(sb, ctx)('search_knowledge', { query: 'x' })).rejects.toThrow();
  });
});
```

  (Importar `beforeEach, afterEach` do `vitest` no topo do arquivo se faltar; o `mockSupabase` já devolve `results['rpc:<name>']` via `rpc()` — ver `tool-executor.test.ts` 31–34.)

- [ ] Rodar — esperar FALHAR (handler não existe → `not_implemented`):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts
```

Esperado: o novo `describe('search_knowledge')` falha (`ToolError not_implemented` em vez de chamar a RPC).

- [ ] Implementar o handler em `supabase/functions/_shared/copilot-v2/tool-executor.ts`. Adicionar imports no topo (após linha 16):

```ts
import { generateEmbedding } from "../embeddings.ts";
import { fuseHybridResults, type KnowledgeHit } from "./hybrid-search.ts";
import { RAG_THRESHOLDS } from "./rag-threshold.ts";
```

  Adicionar o handler (entre `getConversationHistory` e os write handlers, ~linha 88):

```ts
const searchKnowledge: Handler = async (supabase, ctx, args) => {
  const query = String(args.query ?? "").trim();
  if (!query) throw new ToolError("missing_context", "search_knowledge:query");

  // Falha de credencial/embedding é NÃO-silenciosa: throw -> o cognition-loop
  // registra como tool error no trace (nunca um "nenhum resultado" enganoso).
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("search_knowledge: OPENROUTER_API_KEY ausente");
  const embedding = await generateEmbedding(query, apiKey);
  if (!embedding || embedding.length === 0) throw new Error("search_knowledge: embedding vazio");

  // RPC org-scoped — org SEMPRE do ctx, nunca dos args do LLM.
  const { data, error } = await supabase.rpc("copilot_v2_match_knowledge", {
    query_embedding: `[${embedding.join(",")}]`,
    p_org_id: ctx.organizationId,
    query_text: query,
    match_count: 8,
    similarity_threshold: RAG_THRESHOLDS.doc,
  });
  if (error) throw new Error(`search_knowledge: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: number; content: string; similarity: number; source: string }>;
  const semantic: KnowledgeHit[] = rows.filter((r) => r.source === "semantic");
  const keyword: KnowledgeHit[] = rows.filter((r) => r.source === "keyword");
  const fused = fuseHybridResults(semantic, keyword, { docThreshold: RAG_THRESHOLDS.doc, limit: 5 });

  if (fused.length === 0) return `Nenhuma informação encontrada na base para: "${query}"`;
  return ["=== BASE DE CONHECIMENTO ===", ...fused.map((h) => h.content)].join("\n\n");
};
```

  Registrar em `HANDLERS` (objeto 217–227, junto dos reads):

```ts
  get_contact_status: getContactStatus,
  list_custom_fields: listCustomFields,
  search_knowledge: searchKnowledge,
  move_lead_stage: moveLeadStage,
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts tests/unit/copilot-v2/hybrid-search.test.ts
```

Esperado: ambos verdes (os casos existentes do tool-executor continuam — `send_media` ainda é `not_implemented`, só `search_knowledge` saiu da lista).

> **Soft-dep / ordering (Slice 3)**: o handler `search_knowledge` é nominalmente escopo do Slice 3 (catálogo de tools). Este slice o entrega porque produz as RPCs/chunks que ele consome — sem isso, o Slice 3 não conseguiria deixá-lo verde. **Ordering**: Slice 7 antes do `search_knowledge` do Slice 3 ficar verde. Se o Slice 3 rodar primeiro e já tiver stubado o handler, esta Task vira "completar o handler real"; coordenar no PR (não há conflito de invariante — ambos respeitam org-do-ctx).

- [ ] **Segurança** 🔒: `p_org_id` da RPC vem de `ctx.organizationId` (resolvido pelo worker da instância), NUNCA dos args do LLM — provado pelo caso `EVIL-ORG`. RPC `security definer` org-scoped (predicate `c.organization_id = p_org_id`). Falha de credencial/embedding → throw (não-silenciosa, vira tool error no trace, igual à lição VitrineVET de não esconder a key faltando). Keyword search via `websearch_to_tsquery` (parametrizado, sem SQL injection — a query do lead é só texto de busca).

- [ ] Commit:

```bash
git add supabase/migrations/*_copilot_v2_match_knowledge_rpc.sql \
        supabase/functions/_shared/copilot-v2/hybrid-search.ts \
        supabase/functions/_shared/copilot-v2/tool-executor.ts \
        tests/unit/copilot-v2/hybrid-search.test.ts \
        tests/unit/copilot-v2/tool-executor.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): hybrid search + handler search_knowledge org-scoped

Nova RPC copilot_v2_match_knowledge (vetor + keyword tsquery, predicate
organization_id) + módulo puro hybrid-search.ts (reciprocal-rank-fusion,
threshold único). Handler search_knowledge sai de not_implemented: gera
embedding, chama a RPC com org do ctx (nunca do LLM), funde, formata.
Falha de embedding/RAG é não-silenciosa (throw -> tool error no trace).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Regressão completa: suíte copilot-v2 + integração (RLS cross-org + reaper) + build

**Goal**: provar que os specs existentes + os ~19 casos novos passam juntos, adicionar a regressão DB org-scope/reaper na suíte `.skip` de integração (roda contra prod com service key, por convenção do repo — fica `.skip` até migration aplicada), e confirmar que o build/typecheck não quebraram (CI não tem gate `tsc` no edge — memória `project_ci_no_typecheck_gate` — então verificamos local).

### Files

- **Modify** `tests/integration/copilot-v2/border-regression.test.ts` — adicionar bloco `.skip` provando (a) `match_document_chunks` cross-org devolve 0 linhas com `p_org_id` errado, e (b) `copilot_v2_reap_stale_ingestion` devolve uma row `ingesting` travada pra `failed`.

### Steps

- [ ] Ler a suíte `.skip` de integração existente (`tests/integration/copilot-v2/border-regression.test.ts`) pra reusar o `getAdmin()`/`ORG` helpers. Adicionar o bloco (manter `.skip`):

```ts
  it('RLS cross-org: match_document_chunks com p_org_id errado devolve 0 (#40/#41)', async () => {
    const emb = `[${new Array(1536).fill(0).join(',')}]`;
    // org real do chunk vs org forjada — a forjada não pode ler.
    const { data: foreign } = await getAdmin().rpc('match_document_chunks', {
      query_embedding: emb, agent_id_filter: KNOWN_AGENT, p_org_id: '00000000-0000-0000-0000-000000000000',
      match_count: 5, similarity_threshold: 0,
    });
    expect((foreign ?? []).length).toBe(0);
  });

  it('reaper de ingestão: row presa em ingesting -> failed (#668/#670)', async () => {
    const { data: kn } = await getAdmin().from('copilot_v2_knowledge').insert({
      organization_id: ORG, storage_path: `test/reap-${Date.now()}.pdf`, source_kind: 'pdf', status: 'ingesting',
      ingesting_started_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    }).select('id').single();
    const { data: reaped } = await getAdmin().rpc('copilot_v2_reap_stale_ingestion', { p_timeout_minutes: 10 });
    expect((reaped as number) >= 1).toBe(true);
    const { data: row } = await getAdmin().from('copilot_v2_knowledge').select('status, error_message').eq('id', kn!.id).single();
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBeTruthy();
    await getAdmin().from('copilot_v2_knowledge').delete().eq('id', kn!.id);
  });
```

  (Deixar `.skip` — exige as migrations das Tasks 1/2/5 aplicadas. `KNOWN_AGENT`/`ORG` são as constantes já usadas na suíte; se `KNOWN_AGENT` não existir, usar `crypto.randomUUID()` como agent forjado — o ponto é que `p_org_id` errado retorna 0.)

- [ ] Rodar a suíte copilot-v2 unit COMPLETA:

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os files verdes. **Capturar a linha literal** (ex.: `Test Files  27 passed (27)` / `Tests  165 passed (165)`) no QA report — NÃO parafrasear como "all green" (memória `feedback_qa_raw_output`).

- [ ] Rodar a suíte de integração (o skip-sentinel mantém verde sem service key):

```bash
npx vitest run tests/integration/copilot-v2/
```

Esperado: `1 passed` (sentinel), bloco skipado reportado como skipped.

- [ ] Typecheck + build (sem gate `tsc` no edge em CI — verificar local que o frontend ainda typecheck/builda; o edge `.ts` fica fora do `tsconfig.app.json` mas o build não pode regredir):

```bash
npm run typecheck
npm run build
```

Esperado: `typecheck` exit 0 (ou ratchet inalterado via `npm run typecheck:ratchet`); `build` conclui.

- [ ] `deno check` dos arquivos edge tocados (pega import relativo quebrado que o `tsc` não pega — memória Fase 9):

```bash
cd supabase/functions && deno check copilot-v2-ingest-knowledge/index.ts _shared/copilot-v2/ingestion.ts _shared/copilot-v2/hybrid-search.ts _shared/copilot-v2/rag-threshold.ts _shared/copilot-v2/tool-executor.ts
```

Esperado: sem diagnostics.

- [ ] **Segurança** 🔒: a regressão `.skip` prova o predicate org (cross-org → 0 linhas) e o reaper (nunca preso). Não aplicar as migrations das Tasks 1/2/5 em prod neste slice — push da branch só; PROD apply + EasyPanel deploy exigem autorização explícita do CTO (memórias `feedback_never_deploy_prod`, `feedback_push_new_branch`).

- [ ] Commit:

```bash
git add tests/integration/copilot-v2/border-regression.test.ts
git commit -m "$(cat <<'EOF'
test(copilot-v2): regressão DB de org-scope RAG + reaper de ingestão

Suíte .skip de integração: (a) match_document_chunks com p_org_id errado
devolve 0 linhas (#40/#41) e (b) copilot_v2_reap_stale_ingestion devolve
row presa em ingesting -> failed (#668/#670). Roda contra prod com service
key (convenção do repo), permanece .skip até migration aplicada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] Portão final de verificação (colar counts literais no QA report do slice):

```bash
npx vitest run tests/unit/copilot-v2/ tests/integration/copilot-v2/
npm run typecheck && npm run build
```

Tudo deve passar antes de abrir o PR. **Não deployar edge functions nem aplicar as migrations das Tasks 1/2/5** — push da branch só; PR pra `develop`, nunca `main`.

---

## 🔒 Segurança

Resumo das invariantes (todas com 🔒, validadas Task a Task):

- **org sempre do ctx/border/row** 🔒: o handler `search_knowledge` usa `ctx.organizationId` (resolvido pelo worker da instância), NUNCA os args do LLM (caso `EVIL-ORG` na Task 5). A edge fn de ingestão usa `organization_id` da row `copilot_v2_knowledge`, nunca do payload (que só carrega `knowledgeId`). As RPCs `match_*` ganham predicate `organization_id` obrigatório (#40/#41).
- **gates fail-CLOSED** 🔒: `p_org_id` SEM default no SQL (omitir = erro de aridade, não silent-open). `nextIngestionStatus` é fail-CLOSED (0 chunks sem erro explícito → `failed`, nunca `ready` vazio). `resolveThreshold` cai pro default se o override for inválido. Falha de embedding/credencial → throw/`failed`, nunca um "nenhum resultado" enganoso que esconde a key faltando (lição VitrineVET).
- **PII** 🔒: trace de ingestão registra só metadata (knowledge_id/org/count/erro), nunca conteúdo do documento ou da mensagem. Os chunks de KB são conhecimento da org (não PII de lead), mas seguem RLS deny-all (service_role only — `copilot_v2_knowledge_chunks` não tem policy `authenticated`).
- **storage/RLS/RPC org-scope** 🔒: bucket de KB org-scoped + signed URL de 600s. RPCs novas (`copilot_v2_match_knowledge`, `copilot_v2_reap_stale_ingestion`, as 3 `match_*` recriadas) são `SECURITY DEFINER set search_path = public` + `revoke all from public, anon, authenticated` + `grant execute to service_role`. `copilot_v2_knowledge`/`_chunks` mantêm RLS deny-all (só leitura org-scoped no `knowledge`, chunks são service_role only).
- **Exit do slice (verificável)**: PDF de catálogo ingerido responde via `search_knowledge`; imagem de ficha técnica vira texto buscável (OCR multimodal); doc nunca trava em `ingesting` (FSM determinística + reaper); falha de embedding aparece no trace/`error_message`; RPC cross-org devolve 0 linhas (teste RLS `.skip`).

## ⚠️ Decisões abertas

Sinalizadas pro CTO — o plano NÃO as inventa; deixa o slot parametrizado.

1. **Provider/custo de transcrição de vídeo (decisão de produto — tradeoff de custo).** O ADR #12 lista vídeo como `image|video|doc|PDF` na KB com "video: transcript". O Slice 7 entrega PDF/doc (multimodal text) e imagem (OCR/caption multimodal), mas **transcrição de vídeo exige escolher um provider** (Whisper via OpenAI? Gemini multimodal direto? ElevenLabs STT — já temos integração?) com tradeoff de **custo por minuto** e latência de ingestão. O `decideIngestionExtractor` já roteia vídeo pra `'transcript'`, mas a edge fn lança "transcrição de vídeo ainda não suportada (decisão de provider pendente)" — o slot está explícito e fail-CLOSED (vídeo → `failed` com motivo claro, nunca trava). **CTO decide o provider**; a Task 3 fica estruturada pra plugar o extrator `transcript` sem retocar a FSM. NÃO foi inventada uma regra de custo.

2. **Threshold consolidado = decisão técnica, NÃO bloqueante (resolvida com default justificado).** Os 3 valores divergentes (0.5/0.55/0.6) viraram um só (`doc=0.55, faq=0.5, memory=0.7`) em `rag-threshold.ts`, ajustável via `resolveThreshold(kind, override)` sem editar o módulo. Registrada aqui por transparência; não exige decisão de produto.

3. **`copilot_agent_faqs.organization_id` (confirmação de schema, não decisão).** A migration da Task 1 assume que a coluna existe. Se em dev as FAQs herdarem org só via `agent_id`, o executor troca o predicate pela subquery `agent_id in (select id from copilot_agents where ... and organization_id = p_org_id)` e registra no commit — **não inventar coluna**. Sinalizado como nota inline na Task 1.
