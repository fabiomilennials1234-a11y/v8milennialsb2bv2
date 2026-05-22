# Cleanup — Modal Lead v2 (Issue #317)

Runbook do PR final de housekeeping do PRD #284. Executar APENAS depois
de >= 2 semanas com `new_lead_modal_v2 = true` em 100% das orgs e
ausência de regressão na telemetria (`lead_modal_version_rendered`,
Sentry).

## Pré-condições (HITL — bloqueante)

- [ ] Migration `20261031000003_enable_new_lead_modal_v2_for_all_orgs.sql`
      aplicada em prod.
- [ ] >= 2 semanas decorridas pós-rollout 100%.
- [ ] Zero issues abertas com label `regression-modal-v2`.
- [ ] CTO sign-off explícito.

## Arquivos a deletar

Frontend legacy (modal antigo):

```
src/components/lead-detail/LeadDetailSheet.tsx
src/components/lead-detail/LeadDetailFunnelContext.tsx
src/components/lead-detail/LeadDetailHeader.tsx
src/components/lead-detail/LeadDetailProperties.tsx
src/components/lead-detail/LeadDetailFocus.tsx
src/components/lead-detail/LeadDetailNotes.tsx
src/components/lead-detail/LeadDetailTimeline.tsx
src/components/lead-detail/PropertyGroup.tsx
src/components/lead-detail/StageProgressBar.tsx
src/components/lead-detail/modal/LeadDetailDialogV1.tsx
src/components/leads/funnel-contexts/*
```

Tests órfãos:

```
src/components/lead-detail/__tests__/LeadDetailSheet.test.tsx
src/components/lead-detail/__tests__/PropertyGroup.test.tsx
src/components/lead-detail/__tests__/InlineField.test.tsx (se não usado fora)
src/components/lead-detail/__tests__/useInlineEdit.test.ts (se inlineEdit
  só era usado pelo V1)
```

`DrawerVariant` residual: grep no repo todo.

## Comandos de verificação

```bash
# 1. Grep zero imports dos arquivos a deletar
grep -rn "LeadDetailSheet\|LeadDetailFunnelContext\|funnel-contexts\|DrawerVariant\|LeadDetailDialogV1" src/ tests/

# 2. tsc + tests verdes pós cleanup
npx tsc --noEmit
npm run test:unit
npm run test:integration

# 3. Build verde
npm run build
```

## Passos do PR

1. Deletar arquivos da lista acima via `git rm`.
2. Atualizar `src/components/lead-detail/index.ts`:
   - Remover `export { LeadDetailDialog as LeadDetailSheet } from "./modal/LeadDetailDialog";`
   - Remover `export type { DrawerVariant } from "./hooks/useLeadSheet";`
3. Atualizar `useLeadSheet.ts` removendo `DrawerVariant` enum se não usado mais.
4. Atualizar `LeadDetailDialog.tsx` (router V1/V2) para retornar V2 sempre
   — pode deletar V1 component + simplificar router. Feature flag pode
   ficar 1 ciclo a mais (housekeeping separado).
5. Roda comandos de verificação acima.
6. Abrir PR cleanup com checklist no body. CTO sign-off no merge.

## Decisões registradas

- **Feature flag `new_lead_modal_v2`**: não é deletada nesta slice.
  Aguarda housekeeping geral de flags (não-bloqueante).
- **Linha de revert**: se algum cliente regredir pós-cleanup, restaura
  da branch tagged `lead-modal-v2-cleanup-checkpoint` (criar tag antes
  do PR).

## Sign-offs

- [ ] CTO — autorização para apply em prod da migration de rollout 100%.
- [ ] CTO — autorização para cleanup PR após observação.
