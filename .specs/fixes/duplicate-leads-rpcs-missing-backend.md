# fix: página /duplicados quebrada — RPCs find_duplicate_leads / merge_leads nunca existiram

**Tipo:** bug (definition-of-done gap) — frontend shipado sem backend
**Área frágil:** multi-tenant + PII + workflows + conversations (merge destrutivo)
**Data:** 2026-07-22

## Problema

`src/modules/leads/hooks/useDuplicateLeads.ts` chamava duas RPCs que NUNCA
foram escritas:

- `find_duplicate_leads()` (`useDuplicateLeads.ts:24`)
- `merge_leads(p_keep_lead_id, p_merge_lead_id)` (`useDuplicateLeads.ts:36`)

Ambas com `as any` no nome, o que mascarou a ausência em tempo de compilação.
As funções não existem em prod, não estavam em migrations, não estavam em
`types.ts`. Resultado: PostgREST devolvia 404 (function not found), a página
`Duplicates.tsx` engolia o erro como "Nenhuma duplicata encontrada" e ~245
leads duplicados ficaram invisíveis em TODAS as orgs.

## Solução

### DB — migration `20270725000000_duplicate_leads_rpcs.sql`

- **Índice** `idx_leads_name_trgm` — GIN `gin_trgm_ops` em `leads(name)`,
  parcial `WHERE deleted_at IS NULL`. Necessário para o match por nome não virar
  nested-loop N² (maior org: 3906 leads ativos → ~7,6M avaliações → timeout).

- `find_duplicate_leads(p_organization_id uuid)` — SECURITY DEFINER, plpgsql
  STABLE, `search_path = public, extensions`, `SET pg_trgm.similarity_threshold
  = '0.6'`. Recebe a org **explícita** e valida com `assert_org_access()` (não
  confia no body — valida). Retorna `TABLE(lead_a_*, lead_b_*, match_type,
  similarity)` casando self-join em `public.leads` da org por:
  - `normalized_phone` idêntico (`match_type='phone'`, similarity 1.0)
  - `lower(email)` idêntico (`match_type='email'`, similarity 1.0)
  - `a.name % b.name` (operador trigram indexável; threshold 0.6 no nível da
    função) — `match_type='name'`; `round(similarity(...),2)` só na projeção

  Filtro `organization_id = p_organization_id` (escopo de UMA org — mata o
  firehose de master ver ~30 orgs e a mistura em membro multi-org, e reduz o
  blast-radius de perf). `deleted_at IS NULL`. Só pares `a.id < b.id`, 1 linha
  por par (DISTINCT ON, prioridade phone > email > name).

- `merge_leads(p_keep_lead_id, p_merge_lead_id)` — SECURITY DEFINER,
  `search_path` pinado. Guard `p_keep <> p_merge`; resolve org dos dois leads;
  guard cross-org (mesma org obrigatório); `assert_org_access(org)` (IDOR guard).
  **Pre-dedupe DATA-DRIVEN** (passo 4): em vez da lista estática de 8 tabelas
  (que defasa quando o schema cresce — faltavam 7, incl. `pipeline_entries`
  UNIQUE(pipeline_id, lead_id) → colisão garantida no caso comum → merge
  ABORTAVA com unique_violation), descobre via catálogo (`pg_constraint` +
  `pg_index`) todos os índices UNIQUE que incluem a coluna FK→`leads.id` e deleta
  as linhas colidentes do `p_merge_lead_id`. Trata índices **parciais**
  (`indpred` via `pg_get_expr`, aplicado aos dois lados). Depois: re-aponta
  TODAS as FKs de `leads.id` via `information_schema` (`%I` + USING — sem
  injeção); cancela `workflow_executions` pendentes duplicadas; deleta o lead
  absorvido. Atômico na transação da RPC.

- Grants: `REVOKE ALL … FROM PUBLIC` (anon herda EXECUTE via PUBLIC — revogar de
  PUBLIC, não de anon) + `GRANT EXECUTE … TO authenticated`.

### Frontend

- `useDuplicateLeads.ts` — removidos os 2 `as any`; nome da RPC castado com
  `as never` (padrão do repo p/ RPC fora dos types gerados), args tipados
  (`FindDuplicateLeadsArgs` / `MergeLeadsArgs`) e retorno tipado
  (`DuplicateGroup`). `find` passa `p_organization_id` do contexto (validado
  server-side). `useMergeLeads` não retorna `data` (void) e o `onSuccess`
  invalida também as chaves de kanban (`pipeline-page`, `pipeline-stage-counts`,
  `pipeline_entries`, `custom_pipe_entries`, `custom_pipe_stage_counts`) — o
  merge re-aponta essas entries, o card do absorvido precisa sumir do board.
- `Duplicates.tsx` — novo branch de ERRO real (`isError`) com ícone,
  mensagem da RPC e botão "Tentar novamente", antes engolido como estado vazio.

## Segurança (modelo de ameaça)

- **IDOR cross-tenant no merge** — mitigado: `assert_org_access` + guard
  same-org antes de qualquer mutação. Membro de outra org → `access_denied`.
- **Scoping (find)** — org explícita `p_organization_id` VALIDADA por
  `assert_org_access` (não confia no body). Master/multi-org veem só a org
  pedida, não o firehose.
- **PII no retorno** — `find_duplicate_leads` só authenticated; anon revogado.
- **search_path** — pinado `public, extensions` nas duas (evita hijack).
- **SQL injection** — re-aponta FK e pre-dedupe dinâmico usam `%I`
  (quote_ident) + `USING`; predicado parcial vem de `pg_get_expr` (catálogo, não
  input do usuário).

## Testes

- `src/modules/leads/hooks/useDuplicateLeads.test.ts` (vitest, 5 casos):
  `find` passa `p_organization_id` do contexto, mapeamento keep/merge →
  p_keep/p_merge, normalização de data nula, propagação REAL de erro (query e
  mutation).
- `supabase/tests/duplicate_leads_rpcs_test.sql` (pgTAP, plan 22): estrutura +
  grants (anon revogado), match phone/email/name, `a.id < b.id`, exclusão de
  soft-deleted, isolamento multi-tenant (org B não vê org A; membro B pedindo
  org A → `access_denied`), guards do merge (self, cross-org, IDOR), happy path
  (delete + re-aponta FK via `lead_history` ON DELETE CASCADE) e **pre-dedupe
  data-driven** com `pipeline_entries` compartilhada (mesmo pipeline_id nos 2
  leads → merge CONCLUI, entry deduplicada). Registrado em `supabase/tests/run.sh`.

## BLOQUEADO (requer OK / DB)

- **Apply da migration** em dev (`bcfadphgsibjzivtbjvc`) e prod
  (`jsjsmuncfkbsbzqzqhfq`) — NÃO aplicado (dev inacessível via MCP; prod só com
  OK explícito do CTO). Nota de apply: `CREATE INDEX idx_leads_name_trgm` é
  não-concorrente; se o CTO quiser evitar o lock breve na `leads` em prod,
  criar `CONCURRENTLY` out-of-band antes do apply (o `IF NOT EXISTS` torna a
  linha da migration no-op).
- **Regen de `src/integrations/supabase/types.ts`** pós-apply — enquanto não
  rodar, os `as never` permanecem (documentado no hook). Remover os `as never`
  após o regen.
