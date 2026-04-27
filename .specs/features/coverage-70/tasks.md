# Coverage 70% — Tasks

## Sprint 0: Completar o que já começou (hoje)
**Meta: src/lib 80%, contexts 80%**

- [x] T0.1: Tests para src/lib/ pure functions (whatsapp, feature-registry, pricing-calculator, etc.)
- [x] T0.2: Tests para _shared/ pure functions (validation, response, security-headers, webhook-utils)
- [x] T0.3: Tests para src/lib/copilot/ (prompt-quality, templates, template-prompts, step-tips, custom-instructions)
- [x] T0.4: Tests para api-docs/code-generators
- [x] T0.5: Tests para template-variables, import templates
- [x] T0.6: Tests para _shared/ com Deno mock (cors, workflow-trigger matchesTriggerConfig)
- [x] T0.7: Tests para _shared/ com Supabase mock (workflow-executor, lead-service)
- [x] T0.8: Tests para src/lib/ com Supabase mock (logger, subscription)
- [x] T0.9: Integration tests contra produção (lead-service-prod)
- [x] T0.10: Finish src/lib/copilot/ — cobrir prompt-utils, templates, followupSchedule → 95.96%
- [x] T0.11: Tests para src/contexts/ — OrgFeaturesContext e ThemeTransitionContext → 97%
**Linhas a cobrir: +74 | Após: ~10%**

### Sprint 0 EXTRA (feito na sessão):
- [x] T0.12: _shared/message-humanizer (Deno mock + fetch mock) → 89.65%
- [x] T0.13: _shared/sentry (Deno mock + fetch mock) → 87.5%
- [x] T0.14: _shared/embeddings (fetch mock) → 38.98%
- [x] T0.15: _shared/natural-messaging (smartSplitMessage) → 68.18%
- [x] T0.16: _shared/followupSchedule (getNextSendTime) → 98.18%
- [x] T0.17: _shared/auth (validateEvolutionWebhook, checkRateLimit, etc.) → 37.23%
- [x] T0.18: _shared/track, logger, ai-queue → 85%, 88%, 56%
- [x] T0.19: _shared/tts-elevenlabs (truncateForTts) → 25%
- [x] T0.20: _shared/workflow-action-handler (executeWorkflowAction) → 9.54%
- [x] T0.21: _shared/ai-action-executor (immediateTransferHuman, executeAiAction) → 2.8%
- [x] T0.22: _shared/outbound-sender (sendOutboundDispatch) → 11.82%
- [x] T0.23: Hooks batch 1-7 (60+ hooks via renderHook + describe.each) → hooks 12.7%
- [x] T0.24: Deep hook tests (useCampaignTemplates, useCustomPipelines, useImportLeads, useCopilotPromptBuilder, useChannelChat pure exports)

---

## Sprint 1: Continuar hooks (os maiores com baixo coverage)
**Meta: src/hooks/ de 12.7% → ~35%**

Os hooks com batch initialization estão em ~5-15%. Pra subir pra 35%, precisa de testes com renderHook + waitFor que exercitam as query functions reais.

Hooks prioritários (maior LOC, menor coverage):
- [x] T1.1: `useCampanhas.ts` — 97.85% lines (110 tests via renderHook + act)
- [x] T1.2: `useImportLeads.ts` — pure functions + hook (61 tests)
- [x] T1.3: `useWhatsAppChat.ts` — 48% (26 tests)
- [x] T1.4: `useCopilotAgents.ts` — renderHook tests
- [x] T1.5: `useCustomPipelines.ts` — renderHook tests
- [x] T1.6-T1.7: Merged with T1.1 and T1.5
- [x] T1.8: `useFollowUps.ts` — 21 tests (hooks-batch-8)
- [x] T1.9: Merged with T1.2
- [x] T1.10: `useCheckout.ts` — 14 tests (hooks-batch-8)
- [x] T1.11: `useChannelChat.ts` — 10 tests (hooks-batch-8)
- [x] T1.12: `useCommissions.ts` — 10 tests (hooks-batch-8)
- [x] T1.13: `useGoals.ts` — 8 tests (hooks-batch-8)
- [x] T1.14: `useWorkflows.ts` — 12 tests (hooks-batch-8)
- [x] T1.15: `useWhatsAppInstances.ts` — partial
- [x] T1.16: `useProducts.ts` — 6 tests (hooks-batch-8)
- [x] T1.17: `useTags.ts` — 5 tests (hooks-batch-8)
- [ ] T1.18-T1.20: In progress via Sprint 2 agents

**Linhas a cobrir: ~2,500 | Após: ~32%**

### Como rodar Sprint 1

```bash
# Template pra cada hook:
# 1. Ler o hook: cat src/hooks/useNomeDoHook.ts
# 2. Criar teste seguindo o template da spec.md
# 3. Rodar: npx vitest run tests/unit/use-nome-do-hook.test.ts
# 4. Fix failures
# 5. Próximo hook

# Verificar progresso:
npm run test:coverage
node -e "const d=JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json','utf8'));console.log('Lines:',d.total.lines.pct+'%','Gap:',Math.ceil(d.total.lines.total*0.7)-d.total.lines.covered)"
```

---

## Sprint 2: Próximos 40 hooks
**Meta: src/hooks/ de ~35% → ~65%**

- [ ] T2.1: Analytics hooks (6 arquivos: useAnalytics*.ts)
- [ ] T2.2: Agent hooks (useAgentFollowupRules, useAgentKanbanRules, useAgentMetrics, useAgentDocuments)
- [ ] T2.3: Dashboard hooks (useDashboardMetrics, useDailyPriorities, useTVDashboardData)
- [ ] T2.4: Lead detail hooks (useLeadHistory, useLeadTimeline, useLeadScore, useLeadCustomFields)
- [ ] T2.5: Award/Badge/Competition hooks (useAwards, useBadges, useCompetitions)
- [ ] T2.6: Onboarding hooks (useOnboarding, useChecklists)
- [ ] T2.7: Message hooks (useMessageTemplates, useScheduledMessages)
- [ ] T2.8: Export hooks (useExportLeads)
- [ ] T2.9: Permission hooks (usePermissions — expand existing)
- [ ] T2.10: Master admin hooks (useMasterPlans, useMasterFeatures, useMasterAuditLogs, useMasterOperations)
- [ ] T2.11: Utility hooks (useDebounce, useCountUp, useMobile, useToast, useAvatarMap)
- [ ] T2.12: Pipe hooks (usePipeWhatsapp, usePipeConfirmacao, usePipePropostas)
- [ ] T2.13: Remaining hooks (useAutoAssignment, useAutoFollowUp, useCadastroExterno, etc.)

**Linhas a cobrir: ~2,500 | Após: ~54%**

### Como rodar Sprint 2

```bash
# Mesma abordagem do Sprint 1
# Agrupar por domínio — testar todos os analytics hooks juntos, etc.
# Use sub-agents em paralelo quando possível (1 agent por grupo)
```

---

## Sprint 3: _shared modules (mock + integration)
**Meta: _shared/ de 12.5% → 55%**

- [ ] T3.1: `workflow-action-handler.ts` (1412 LOC) — mock executeWorkflowAction, test action routing
- [ ] T3.2: `ai-action-executor.ts` (1289 LOC) — mock LLM calls, test action parsing/execution
- [ ] T3.3: `workflow-executor.ts` (924 LOC) — expand existing tests, more node types
- [ ] T3.4: `meta-api.ts` (523 LOC) — mock fetch, test API wrapper functions
- [ ] T3.5: `lead-service.ts` (471 LOC) — expand integration tests (getOrCreateLead variants)
- [ ] T3.6: `auth.ts` (353 LOC) — mock Deno crypto, test webhook validation functions
- [ ] T3.7: `user-auth.ts` (305 LOC) — mock Supabase auth, test JWT extraction
- [ ] T3.8: `outbound-sender.ts` (308 LOC) — mock fetch, test message dispatch
- [ ] T3.9: `permission_engine.ts` (297 LOC) — integration tests against prod
- [ ] T3.10: `natural-messaging.ts` (302 LOC) — mock Deno.env + fetch, test heuristic split
- [ ] T3.11: `google-calendar-utils.ts` (293 LOC) — mock fetch, test calendar helpers
- [ ] T3.12: `embeddings.ts` (203 LOC) — mock fetch, test vector operations
- [ ] T3.13: `tinyerp-utils.ts` (220 LOC) — mock fetch, test ERP helpers
- [ ] T3.14: `sentry.ts` (205 LOC) — mock, test withSentry wrapper
- [ ] T3.15: `campaign-distribution.ts` (95 LOC) — mock Supabase, test distribution modes

**Linhas a cobrir: ~1,500 | Após: ~67%**

### Como rodar Sprint 3

```bash
# Cada módulo _shared precisa de:
# 1. import "../../tests/helpers/deno-mock" (se usa Deno.env)
# 2. global.fetch = vi.fn() (se faz HTTP calls)
# 3. createMockSupabase() (se usa Supabase client)
# 4. Testar as funções exportadas, mocando dependências externas

# Para integration tests:
# 1. import { supabaseProd, ensureTestOrg } from './setup-prod'
# 2. Criar dados na org de teste
# 3. Executar a função contra dados reais
# 4. Verificar resultado
# 5. Limpar dados no afterAll
```

---

## Sprint 4: Polish + edge cases
**Meta: 70%+ total**

- [ ] T4.1: Hooks restantes que não foram cobertos nos sprints 1-2
- [ ] T4.2: Edge cases nos _shared modules (error paths, timeouts, retries)
- [ ] T4.3: Expandir workflow-condition-evaluator (~150 testes adicionais pra todos 21 operadores)
- [ ] T4.4: Contexts restantes (OrgFeaturesContext, ThemeTransitionContext)
- [ ] T4.5: E2E tests adicionais (Playwright)
- [ ] T4.6: Validar coverage final, gerar report HTML
- [ ] T4.7: Commitar e fazer push

**Linhas a cobrir: ~800 | Após: ~74%**

### Como rodar Sprint 4

```bash
# Verificar quais arquivos ainda estão em 0%:
npm run test:coverage 2>/dev/null
node -e "
const d=JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json','utf8'));
Object.entries(d).filter(([k,v])=>k!=='total'&&v.lines.covered===0)
  .sort((a,b)=>b[1].lines.total-a[1].lines.total)
  .slice(0,20)
  .forEach(([k,v])=>console.log(v.lines.total,'LOC',k.split('/').pop()));
"

# Priorizar os maiores arquivos sem cobertura
# Escrever testes até atingir 70%
```

---

## Verificação final

```bash
# 1. Rodar suite completa
npm run test:unit && npm run test:integration

# 2. Verificar coverage
npm run test:coverage

# 3. Verificar meta
node -e "
const d=JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json','utf8'));
const t=d.total;
const pct=t.lines.pct;
console.log('Coverage:', pct+'%');
console.log(pct >= 70 ? '✅ META ATINGIDA' : '❌ Abaixo de 70%');
console.log('Lines:', t.lines.covered+'/'+t.lines.total);
"

# 4. Se atingiu, commitar
git add tests/ vitest.config.ts .specs/features/coverage-70/
git commit -m "test: coverage 70%+ — X testes, Y arquivos"
```

---

## Referência rápida — Como iniciar cada sessão

```bash
# 1. Ver estado atual
npm run test:coverage 2>/dev/null
node -e "const d=JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json','utf8'));console.log('Lines:',d.total.lines.pct+'%')"

# 2. Abrir a spec
cat .specs/features/coverage-70/tasks.md

# 3. Encontrar próxima task não feita (primeiro [ ] no arquivo)
grep -n "^\- \[ \]" .specs/features/coverage-70/tasks.md | head -5

# 4. Executar a task

# 5. Atualizar tasks.md (marcar [x])

# 6. Verificar progresso
npm run test:coverage
```
