---
type: changelog
date: 2026-07-13
domain: vendas
tags: [pipelines, kanban, custom-pipes, rpc, multi-tenancy]
---

# 2026-07-13 — Badge de contagem dos funis custom (cap 1000)

## Mudanças

- **pipelines/custom**: badge da coluna do kanban de funis **custom** travava em
  1000. Causa: `useCustomPipeEntries` busca entries sem `.range()` (PostgREST
  corta em 1000) e `CustomPipelineKanban` não setava `totalCount` → badge caía em
  `items.length`. Fix: count server-side via novo RPC. Real: "Prospecção CNAE"
  etapa "Novo" mostrava 1000, tinha 2543+ (e crescendo — funil de import ativo).

## Arquivos tocados

- `supabase/migrations/20270314000000_get_custom_pipeline_stage_counts.sql` — RPC
  novo `get_custom_pipeline_stage_counts(p_pipeline_id, p_org_id, p_search)`.
  `COUNT(*) FROM custom_pipe_entries GROUP BY stage_id`, filtrado por `pipeline_id`
  + `organization_id`. `SECURITY INVOKER` + `search_path=''` (RLS via
  `get_my_organization_ids()` mantém isolamento tenant). `GRANT EXECUTE TO authenticated`.
- `src/modules/pipelines/hooks/custom/useCustomPipelines.ts` — hook
  `useCustomPipeStageCounts(pipelineId, searchQuery)` → `Record<stage_id, count>`;
  invalidação de `["custom_pipe_stage_counts", pipelineId]` nas 3 mutations de entry.
- `src/modules/pipelines/components/custom/CustomPipelineKanban.tsx` — seta
  `totalCount: counts[stage.id] ?? items.length` nas colunas; passa `searchQuery` ao hook.
- `src/integrations/supabase/types.ts` — entry do RPC (ver Notas).
- `tests/unit/use-custom-pipelines.test.ts` — +3 testes do hook novo (map, search trim, disabled).

## Decisões

- Espelha o board canônico (`get_pipeline_stage_counts`, `20270101000400`), mas pro
  modelo custom (`custom_pipe_entries` por `stage_id`, filtrando por `pipeline_id`
  — **não** `type='system'`, que cegaria custom pipes; ADR-0017 R3). Count-only →
  sem anti-padrão de métrica.
- Parity: **sem busca** = exato (conta todas as entries por stage, incl. lead null,
  igual ao badge antigo). **Com busca** = aproximado (ILIKE nome/empresa/telefone,
  sem strip de acento NFD). Caso reportado é sem busca.

## QA

- `tests/unit/use-custom-pipelines.test.ts`: 36/36 verdes (inclui os 3 novos).
- `tsc --noEmit` (projeto): 0 erros. ESLint nos arquivos tocados: 0 erros.
- metric-lint (`check-metric-antipatterns.sh`): exit 0.
- Parity provada contra prod via SQL read-only (snapshot único): RPC-equiv ==
  `COUNT(*)` == 2838 na etapa "Novo" (org `38f3bea4…`), ambos > 1000.
- Suite completa continua baseline-red (224 fails pré-existentes em copilot/etc);
  0 fails em pipelines/custom/kanban → sem regressão.

## Follow-ups

- **Migration NÃO aplicada** ainda: DEV (`bcfadphgsibjzivtbjvc`) bloqueado por drift
  pré-existente do histórico de migrations (`db push` recusa; MCP Supabase sem
  permissão de escrita nesta sessão). PROD exige autorização CTO. Ordem de deploy:
  **migration → regen types → deploy front** (front novo contra RPC ausente quebra
  o `.rpc`). Ver [[project_migrations_fresh_apply_broken]].
- `src/integrations/supabase/types.ts`: entry do RPC adicionada **à mão** (regen
  automático indisponível — MCP/CLI bloqueados). Shape idêntico ao que o `gen types`
  produz → reconcilia sem diff no próximo regen pós-apply.
- Cards ainda capados em 1000 (só o badge foi corrigido). Paginação/virtualização:
  [[custom-pipe-cards-pagination-1000-cap]].
