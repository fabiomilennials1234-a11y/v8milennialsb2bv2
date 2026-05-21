# Stage Auto-Checklist — Design Spec

**Date**: 2026-05-21
**Author**: Gabriel (CTO) + Claude
**Status**: Approved, ready for implementation plan

## Problem

Operadores configuram checklists templates por etapa do funil (ex: "Stage D3 deve ter checklist 'Ligação WhatsApp + 3 follow-ups'"), mas hoje precisam aplicar manualmente em cada lead que entra naquela stage. Workflow engine resolve via `stage_changed → apply_checklist`, mas:

- Não é descobrível (usuário precisa saber que existe a engine de automações).
- Curva alta pra um caso trivial.
- Quebra o mental model de "config da stage": o que define essa etapa fica fragmentado entre stage settings e workflows.

## Goal

Ao mover um lead para uma stage, se a stage tem checklist template associado, o sistema aplica o template ao lead automaticamente, **independente do caminho que originou o move**.

## Non-goals

- Condicionais ("só aplica se tag = X"). Quem precisa continua usando workflow engine.
- Múltiplos templates por stage. 1:1 no MVP. Reabrir se demanda real.
- Aplicação retroativa a leads já parados na stage. Só pra moves futuros.
- Remoção do checklist quando lead sai da stage. Histórico persiste.
- Botão "aplicar agora a todos leads desta stage". Follow-up se pedirem.

## Architecture decision: DB trigger, não código de aplicação

Stage move acontece em 6+ caminhos diferentes:

1. Drag-and-drop no kanban (`usePipeWhatsapp`, `usePipeConfirmacao`, `usePipePropostas`, `useCustomPipelines`).
2. Workflow action `move_stage` (`_shared/action-handlers/move-stage.ts`).
3. Cross-pipe move (`useCrossPipeMove`).
4. Webhook `lead-webhook` (`place_in_pipe`).
5. Auto-move por SLA (`auto_move_min_days`, `auto_move_max_days` em `pipeline_stages`).
6. n8n workflows externos.

Implementar o auto-apply em cada caller = N pontos de manutenção, bug garantido em algum dos paths em <6 meses. **Trigger DB no nível das tabelas de entries** garante invariante única.

Trade-off aceito: lógica em PL/pgSQL (mais difícil de testar/debug que TS), mas é a única forma de garantir consistência sem refatorar 6 callers.

## Schema

```sql
-- Stage aponta para template (1:1)
ALTER TABLE pipeline_stages
  ADD COLUMN checklist_template_id uuid REFERENCES checklists(id) ON DELETE SET NULL;
ALTER TABLE custom_pipeline_stages
  ADD COLUMN checklist_template_id uuid REFERENCES checklists(id) ON DELETE SET NULL;

-- Checklist criado guarda origem
ALTER TABLE checklists
  ADD COLUMN source_template_id uuid REFERENCES checklists(id) ON DELETE SET NULL;

-- Idempotência: 1 checklist por (lead, template)
CREATE UNIQUE INDEX uniq_checklists_lead_source
  ON checklists(lead_id, source_template_id)
  WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL;
```

### FK semantics

- `pipeline_stages.checklist_template_id` references `checklists(id)` (template = checklist com `lead_id IS NULL`).
- Template deletado → stage perde apontamento, mas mantém row. Auto-apply vira no-op.
- Auto-checklist deletado → `source_template_id` na própria row já é referência ao template (que pode ter sido deletado também). FK `ON DELETE SET NULL` evita órfão.

### Validações implícitas

- Template precisa ter `lead_id IS NULL` (já é convenção do schema atual de checklists). Trigger não revalida — confia no UI selecionar só templates.
- Template tem que ser da mesma org que a stage. **Validação no trigger** (defense-in-depth).

## Trigger logic

Função `apply_stage_checklist()`, language `plpgsql`, `SECURITY DEFINER` (bypassa RLS para inserts internos). Triggers `AFTER INSERT OR UPDATE OF stage_key|stage_id` nas duas tabelas de entries.

Pseudo-flow:

1. Se UPDATE e stage não mudou → return (no-op).
2. Lookup `checklist_template_id` + `organization_id` da stage de destino (consulta na tabela apropriada conforme `TG_TABLE_NAME`).
3. Se template id null → return.
4. Safety: stage.org ≠ entry.org → return (cross-org leak prevention).
5. INSERT checklist novo (`organization_id`, `lead_id`, `source_template_id`, `title`, `description`, `created_by = NULL`).
   - `ON CONFLICT (lead_id, source_template_id) DO NOTHING` → idempotência.
6. Se inseriu (RETURNING capturou id), copiar items do template ordenados por position.

Lookup tabelas:

| `TG_TABLE_NAME` | Tabela lookup | Match |
|---|---|---|
| `pipeline_entries` | `pipeline_stages` | `(org_id, pipeline_type, stage_key, is_active=true)` |
| `custom_pipe_entries` | `custom_pipeline_stages` | `id = NEW.stage_id` |

### `created_by = NULL`

Trigger DB não tem identidade do ator. Setar `created_by = auth.uid()` exigiria que cada caller setasse `SET LOCAL request.jwt.claims` (não é o caso de cron jobs ou triggers internos). Aceito NULL = "sistema". Audit via `created_at` + `source_template_id` (mostra que veio de auto-apply).

### Custo

- Lookup stage: 1 index hit (~0.5ms).
- INSERT checklist: ~1ms.
- INSERT items (N rows): ~0.5ms + 0.1ms/row. Template com 50 items = ~5ms.
- Total típico: <10ms. Não bloqueia move.
- Idempotência via ON CONFLICT = no-op se já existe (1 index lookup ~0.5ms).

## UI

### Pipes fixos — `ManagePipelineStagesModal.tsx`

Por linha de stage no modal de gerenciamento (whatsapp, confirmacao, propostas):

```tsx
<Select 
  value={stage.checklist_template_id ?? "__none__"}
  onValueChange={(v) => updateStage({ 
    id: stage.id, 
    checklist_template_id: v === "__none__" ? null : v 
  })}
>
  <SelectTrigger className="h-8 text-xs">
    <SelectValue placeholder="Sem checklist automático" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="__none__">Sem checklist</SelectItem>
    {templates.map(t => (
      <SelectItem key={t.id} value={t.id}>
        {t.title} <span className="text-muted-foreground">({t.total_items})</span>
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

Posicionamento: linha de cada stage, ao lado de cor/SLA. Label: "Auto checklist:".

### Custom pipes — `CustomPipeSettingsDialog.tsx`

Mesmo controle, dentro da config de stage do custom pipeline.

### Hook

`useChecklistTemplates()` já existe. Lista checklists com `lead_id IS NULL` da org. Reutilizado.

### Permissions

Edit de stage já é restrito a admin/master (regra atual de `ManagePipelineStagesModal`). Auto-checklist herda mesma gate.

## Multi-tenant & RLS

- Trigger `SECURITY DEFINER` bypassa RLS — necessário porque INSERT acontece em transação de qualquer caller (admin, membro, cron, master).
- Safety check no trigger (`stage.org_id = entry.org_id`) previne cross-org.
- Template selector no UI filtra por `organization_id = current org`. Master não consegue selecionar template de outra org (UI guard).

## Realtime

- `useChecklists` (`["checklists", "lead", leadId]`) já usa `useRealtimeSubscription("checklists", ...)`. Novo checklist criado pelo trigger dispara INSERT no `checklists`, broadcast pro modal aberto, query invalida, lista renderiza com novo item.
- `checklists` precisa estar em publication realtime. Confirmar antes do deploy.

## Edge cases tratados

| Caso | Comportamento |
|---|---|
| Stage sem template | No-op (early return) |
| Template deletado entre config e move | No-op (FK SET NULL) |
| Lead movido 5x pra mesma stage | 1 checklist (unique index) |
| Lead movido stage A→B→A | 1 checklist (idempotência por template, não por entrada) |
| Stage trocada de template após leads já criados | Leads antigos mantêm checklist anterior; novos leads recebem o novo |
| Cross-org via master | Trigger valida `stage.org = entry.org` → cria pra org do lead, não do master |
| Re-INSERT em `pipeline_entries` (mesma stage) | Trigger dispara em INSERT, idempotência protege |
| Custom pipeline copy | Cópia herda `checklist_template_id`. Decisão: aceitar; é o comportamento esperado de duplicação. |
| Template sem items | Cria checklist vazio. Não é erro. |
| Trigger falha (template removido em race condition) | `RAISE EXCEPTION` cancela o move. **Aceito**: melhor falhar visível do que ter inconsistência silenciosa. |

## Não tratado (intencional)

- Lead movido por API key terceiro fora do schema padrão → se for INSERT em `pipeline_entries`/`custom_pipe_entries`, dispara. Se for update em outras colunas (ex: trigger antigo `pipe_whatsapp` em `leads`), **não dispara**. Aceito: views compat já normalizam pra `pipeline_entries`.
- Auto-checklist sem possibilidade de ser distinguido visualmente do manual no UI. Pode ser melhorado com badge "Auto" se feedback aparecer.

## Telemetria

Não adicionar telemetria nova nessa fase. `pg_stat_user_functions` já tracka calls do trigger. Sentry captura exceptions automaticamente.

## Risco e rollback

| Risco | Mitigação |
|---|---|
| Trigger causa lock excessivo em moves em massa | INSERT é leve, lookup é index hit. Stress-test em dev com 1000 leads. |
| Template inválido (org diferente) escapa do UI guard | Safety check no trigger previne. |
| Custom pipeline copy duplica auto-apply config indesejado | Aceito; usuário pode limpar manualmente. |
| Realtime não inscrito em `checklists` | Pre-flight check + add to publication se necessário. |
| Migration aplicada antes do code → UI quebra | Aplicar migration depois do merge do code (frontend lê coluna nova só se existe). Ordem: deploy frontend → apply migration. |

Rollback: drop colunas + drop função + drop triggers + drop unique index. Migration de revert simples. Checklists já criados ficam (não destrutivo).

## Testes

### Integration (Supabase local)

`tests/integration/rls-stage-auto-checklist.test.ts`:

1. Cria template org A.
2. Cria stage org A com template_id.
3. Cria lead org A, INSERT em pipeline_entries com stage_key da stage configurada → assert checklist criado (+ items copiados, mesma ordem).
4. Re-INSERT mesma stage → assert ainda 1 checklist.
5. UPDATE stage_key pra outra stage sem template → no checklist novo.
6. UPDATE stage_key de volta pra original → no checklist novo (idempotência).
7. Cross-org: stage org A, lead org B → no checklist criado (org safety).
8. Custom pipeline análogo.
9. Template deletado → stage continua, próximo move = no-op.

### Unit (vitest)

- Hook `useUpdatePipelineStage` aceita `checklist_template_id` na mutation.
- UI render select com lista de templates.

### Manual (UAT)

1. Admin: configurar template "Onboarding 3 itens" em stage "novo_lead" do whatsapp.
2. Criar lead, drag pra "novo_lead" → checklist aparece no modal do lead.
3. Mover pra outra stage e voltar → ainda 1 checklist.
4. Membro: drag também dispara (não é só admin que dispara o trigger).
5. Workflow `move_stage` → também dispara (testa unificação dos paths).

## Migrations / files affected

### Backend

- Nova migration: `supabase/migrations/<timestamp>_stage_auto_checklist.sql`
- Regen types: `src/integrations/supabase/types.ts`

### Frontend

- `src/components/pipelines/ManagePipelineStagesModal.tsx` — UI select.
- `src/components/custom-pipelines/CustomPipeSettingsDialog.tsx` — UI select (análogo).
- `src/hooks/usePipelineStages.ts` — incluir campo no `useUpdatePipelineStage`.
- `src/hooks/useCustomPipelines.ts` — análogo.

### Testes

- `tests/integration/rls-stage-auto-checklist.test.ts` (novo).

## Documentação

- Atualizar `Obsidian/.../06 — Features/Vendas/` com nota de auto-checklist por stage.
- Atualizar `Obsidian/.../03 — Reference/Schema.md` com colunas novas.
- ADR? Não, decisão pequena e reversível. Skip.

## Plano de entrega

1. Branch `feat/stage-auto-checklist`.
2. Migration + types regen.
3. Frontend UI (2 modais).
4. Integration test.
5. PR.
6. Apply migration em dev → smoke test.
7. UAT manual em dev.
8. CTO aprova apply prod.
9. Apply migration prod.
10. Verificar Realtime publication inclui `checklists` em prod.
