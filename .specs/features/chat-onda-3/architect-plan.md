# Architect Plan — Chat Onda 3.1 (escopo reduzido)

**Autor:** Architect (agent-architect)
**Data:** 2026-04-22
**Branch:** `feat/chat-ux-ui-redesign`
**Baseline:** 58 commits (Onda 1 + 2a + 2b). Tip de branch: `0897cc3`.
**Dependências upstream:** `.specs/features/chat-onda-2b/architect-plan.md`, `.specs/features/chat-onda-2b/security-review.md`.
**Status:** Plano — zero código neste commit.

---

## 0. Veredicto de escopo

**Onda 3.1 é consolidação, não nova feature.** Três dores reais, uma dívida bloqueante:

1. **LeadDetailContent.tsx está com 1005 LOC.** O split C38 da Onda 2b só extraiu 2 de 12 peças (`LeadHeader` + `LeadTabHistory`). O arquivo continua monolítico e virou cola entre Chat, LeadContactModal e o futuro ContextPanel.
2. **Migrations 2b no disco mas não aplicadas em dev.** `20260422120000_conversation_read_state.sql`, `20260422140000_conversations_ai_state.sql`, `20260422140001_whatsapp_messages_fts.sql` — nenhuma rodou em `bcfadphgsibjzivtbjvc`. Os hooks `useTakeover`, `useAITimeline`, `useMessageSearch` estão carregando casts porque `types.ts` não foi regenerado.
3. **Dark mode é rachadura generalizada.** 209 ocorrências de `bg-gray-*` / `bg-white` / `text-black` / `text-white` / `border-gray-*` em `src/pages` + `src/components` (`grep` executado em 2026-04-22, numa base que teoricamente é dark-first). Chat está polido; o resto do app está inconsistente.
4. **`search_messages` sem rate limit.** Security 2b aceitou com flag para Onda 2c. Onda 3.1 paga essa flag — em client-side primeiro (defesa na janela do ataque acidental, não do adversarial). Server-side fica para 3.2.

**Escopo é disciplinadamente pequeno.** Nada de feature nova. Nada de redesenho visual. Apenas remover dívida que trava as próximas ondas.

**O que NÃO entra em 3.1:** rate limit server-side (Onda 3.2), auditoria de buscas (LGPD — Onda 3.2), fix automático de dark mode (esta onda entrega spec + fixes críticos em 3 páginas; remediação completa é Onda 3.2), split dos hooks antigos `useLeadAllPipelines` / `useWhatsAppLeadIntegration` (são estáveis, não valem o risco).

---

## 1. Inventário do alvo — `src/components/chat/LeadDetailContent.tsx` (1005 LOC)

### 1.1 Consumidores externos (fronteira pública)

```
$ grep -rn "from.*LeadDetailContent" src/ --include="*.tsx" --include="*.ts"
src/components/chat/WhatsAppChat.tsx:58:          import { LeadDetailContent } from "./LeadDetailContent";
src/components/chat/LeadContactModal.tsx:5:       import { LeadDetailContent } from "./LeadDetailContent";
src/components/lead/LeadDetailContent.tsx:19:    export { LeadDetailContent, ... } from "@/components/chat/LeadDetailContent";
```

Três pontos de entrada, um contrato de props:

```ts
interface LeadDetailContentProps {
  phoneNumber: string;
  pushName?: string | null;
  onClose?: () => void;
  showHeader?: boolean;
}
```

**Regra de ouro:** a assinatura `LeadDetailContentProps` é inalterável nesta onda. Toda a refatoração é interna. WhatsAppChat / LeadContactModal / ContextPanel não mudam uma linha.

### 1.2 Símbolos internos (linhas, para recorte)

| Linha | Símbolo | Destino Onda 3.1 |
|------:|---------|------------------|
| 69-77 | `originOptions` (const) | `src/lib/lead/lead-origins.ts` |
| 79-84 | `LeadDetailContentProps` (interface) | permanece em `src/components/lead/LeadDetailContent.tsx` (shell canônico) |
| 86-91 | `LeadDetailContent` (assinatura do componente) | shell `src/components/lead/LeadDetailContent.tsx` |
| 92-117 | estado local (`useState` × 10, `formData`) | distribuído entre `LeadTabInfo`, tabs de pipeline, creation form |
| 119-151 | queries + mutations (`useLeadByPhone`, `useLeadAllPipelines`, `useCampanhas`, `useTeamMembers`, `useUpdateLead`, etc.) | redistribuído em hooks `useLeadMeta`, `useLeadPipeState`, `useLeadCampaignsAttach`, `useLeadForm` |
| 155-189 | `useEffect` × 3 (hydrate form, reset stage on dest, reset custom stage) | migra para `LeadCreateForm` (creation path) e `useLeadForm` (edit path) |
| 193-206 | `DEST_TO_PIPE_TYPE`, `getStandardStages`, `standardStagesForCreate`, `isStandardDest` | `src/lib/lead/lead-destinations.ts` |
| 210-260 | `handleCreateLead` | `LeadCreateForm.tsx` (local ao componente) |
| 262-278 | `handleUpdateLead` | `useLeadForm.ts` → mutation |
| 280-318 | `handleAddToCampanha` | `useLeadCampaignsAttach.ts` → mutation |
| 322-396 | `handleMoveStage` / `handleRemoveFromPipeline` / `handleAddToPipeline` | `useLeadPipeState.ts` → mutations (fachada sobre `useLeadAllPipelines`) |
| 400-406 | `isCreateDisabled` | `LeadCreateForm.tsx` (local) |
| 410-435 | helpers `getPipelineKey/Label/Color/Stages/Current*` | `src/lib/lead/pipeline-adapters.ts` (puro, testável) |
| 439-672 | bloco JSX — creation form | `src/components/lead/create/LeadCreateForm.tsx` |
| 675-682 | `<TabsList>` | `src/components/lead/LeadDetailContent.tsx` (shell) |
| 685-780 | TabsContent `info` | `src/components/lead/tabs/LeadTabInfo.tsx` |
| 783-940 | TabsContent `pipeline` | `src/components/lead/tabs/LeadTabPipe.tsx` (renderiza `LeadCurrentStage` + `LeadPipeActions` + `LeadStageHistory`) |
| 943-991 | TabsContent `campanha` | `src/components/lead/tabs/LeadTabCampanhas.tsx` |
| 994-999 | TabsContent `history` | já extraído: `LeadTabHistory.tsx` (Onda 2b) |

### 1.3 Dependências transversais que NÃO se mexem nesta onda

- `useLeadAllPipelines` (369 LOC) — fachada central de pipes. Estável. Vamos consumir, não reescrever.
- `useWhatsAppLeadIntegration` (560 LOC) — criação de leads a partir do WhatsApp. Idem.
- `useLeadTimeline` — usado por `LeadTabHistory`. Idem.

---

## 2. Estrutura de pastas proposta

```
src/components/lead/
├── LeadDetailContent.tsx           # shell canônico <200 LOC (ponto único de verdade)
├── header/
│   └── LeadHeader.tsx              # já existe (Onda 2b)
├── create/
│   └── LeadCreateForm.tsx          # bloco JSX de criação extraído
├── info/
│   ├── LeadContactInfo.tsx         # nome, empresa, email
│   ├── LeadResponsibles.tsx        # SDR, Closer, Responsible (read-only neste shell; edição já vive em /leads detail)
│   ├── LeadQualification.tsx       # rating, qualification_score
│   └── LeadSource.tsx              # origem, origem_detalhe
├── pipe/
│   ├── LeadCurrentStage.tsx        # badge + seletor rápido do estágio atual
│   ├── LeadStageHistory.tsx        # compacta lead_history filtrado por stage_moved
│   └── LeadPipeActions.tsx         # add/move/remove funil
├── tabs/
│   ├── LeadTabInfo.tsx             # orquestra info/* + LeadNotes
│   ├── LeadTabPipe.tsx             # orquestra pipe/*
│   ├── LeadTabCampanhas.tsx        # extração nova (antes inline)
│   ├── LeadTabTags.tsx             # read/write de tags (futura — stub com mensagem "editar tags via /leads")
│   ├── LeadTabProducts.tsx         # futura — stub idem
│   └── LeadTabHistory.tsx          # já existe (Onda 2b)
└── notes/
    └── LeadNotes.tsx               # textarea de notas + dirty-state save

src/hooks/lead/
├── useLeadMeta.ts                  # lead básico por phone|id — fachada em cima de useLeadByPhone
├── useLeadPipeState.ts             # pipe status + add/move/remove (fachada sobre useLeadAllPipelines)
├── useLeadTags.ts                  # read tags do lead (write fora de escopo nesta onda)
├── useLeadProducts.ts              # read products do lead (write fora de escopo)
├── useLeadForm.ts                  # form state + save (update) — extraído do shell
└── useLeadCampaignsAttach.ts       # attach em campanha (substitui handleAddToCampanha)

src/lib/lead/
├── lead-origins.ts                 # originOptions + helpers label(origin)
├── lead-destinations.ts            # DEST_TO_PIPE_TYPE + helpers isStandardDest()
└── pipeline-adapters.ts            # getPipelineKey/Label/Color/Stages/Current* — funções puras testáveis

src/lib/
└── rate-limit.ts                   # token bucket genérico (primeiro cliente: useMessageSearch)

src/components/chat/
└── LeadDetailContent.tsx           # stub de re-export — mantém compat com WhatsAppChat + LeadContactModal
```

### 2.1 Decisão de path canônico

Hoje o canônico é `src/components/chat/LeadDetailContent.tsx` e `src/components/lead/LeadDetailContent.tsx` é re-export. **Inverte na Onda 3.1.**

- Canônico: `src/components/lead/LeadDetailContent.tsx` (shell).
- Legacy re-export: `src/components/chat/LeadDetailContent.tsx` — mantém import `./LeadDetailContent` funcionando em `WhatsAppChat` e `LeadContactModal` sem mexer neles.

Isso zera risco de quebra nos dois consumidores conhecidos e permite rename deferido para Onda 3.2 (quando vamos atualizar os imports).

---

## 3. Plano de commits — 25 commits atômicos

Cada commit compila, passa lint, e é revertable. Diff médio alvo: ≤ 300 LOC. Quando passa de 500 LOC é sinal para dividir.

### Sprint 3.1.1 — LeadDetailContent split (10 commits)

| # | Commit | Arquivos criados | Arquivos tocados | LOC aprox. | Depende | Smoke test |
|---|--------|------------------|------------------|-----------:|---------|------------|
| 1 | `refactor(lead): extract helpers para lib/lead (origins, destinations, pipeline-adapters)` | `src/lib/lead/lead-origins.ts`, `src/lib/lead/lead-destinations.ts`, `src/lib/lead/pipeline-adapters.ts` | `src/components/chat/LeadDetailContent.tsx` (consome novos imports) | +120/-60 | — | chat renderiza; criar lead novo ainda funciona |
| 2 | `refactor(lead): extract LeadContactInfo + LeadResponsibles` | `src/components/lead/info/LeadContactInfo.tsx`, `src/components/lead/info/LeadResponsibles.tsx` | LeadDetailContent (substitui blocos) | +130/-50 | #1 | tab Info: nome/empresa/email editáveis; SDR visível |
| 3 | `refactor(lead): extract LeadQualification + LeadSource` | `src/components/lead/info/LeadQualification.tsx`, `src/components/lead/info/LeadSource.tsx` | LeadDetailContent | +90/-35 | #2 | tab Info: rating aceita 0-10; origin select funciona |
| 4 | `refactor(lead): extract LeadCurrentStage + LeadStageHistory` | `src/components/lead/pipe/LeadCurrentStage.tsx`, `src/components/lead/pipe/LeadStageHistory.tsx` | LeadDetailContent | +160/-80 | #1 | tab Pipeline: badge atual + lista stages |
| 5 | `refactor(lead): extract LeadPipeActions (add/move/remove)` | `src/components/lead/pipe/LeadPipeActions.tsx` | LeadDetailContent | +180/-150 | #4 | tab Pipeline: mover stage; adicionar em funil; remover |
| 6 | `refactor(lead): extract LeadNotes` | `src/components/lead/notes/LeadNotes.tsx` | LeadDetailContent | +60/-25 | #3 | textarea notes, dirty state, Ctrl+S salva |
| 7 | `refactor(lead): extract LeadCreateForm` | `src/components/lead/create/LeadCreateForm.tsx` | LeadDetailContent | +260/-245 | #1,#3 | sem lead → form criação completa; todos os destinos (qualificação/confirmação/propostas/custom/campanha/none) |
| 8 | `refactor(lead): consolidate LeadTabInfo orquestrando info/* + LeadNotes` | `src/components/lead/tabs/LeadTabInfo.tsx` | LeadDetailContent | +90/-110 | #2,#3,#6 | tab Info render idêntico ao anterior (snapshot visual) |
| 9 | `refactor(lead): consolidate LeadTabPipe orquestrando pipe/*` | `src/components/lead/tabs/LeadTabPipe.tsx` | LeadDetailContent | +80/-130 | #4,#5 | tab Pipeline render idêntico |
| 10 | `refactor(lead): consolidate LeadTabCampanhas + stubs TabTags/TabProducts` | `src/components/lead/tabs/LeadTabCampanhas.tsx`, `src/components/lead/tabs/LeadTabTags.tsx`, `src/components/lead/tabs/LeadTabProducts.tsx` | LeadDetailContent | +140/-60 | #1 | tab Campanhas: attach funciona; tags/products stubs aparecem com CTA "ver em /leads" |

**Checkpoint Sprint 3.1.1:** `LeadDetailContent.tsx` no caminho legacy vira <200 LOC e apenas compõe shells. Zero mudança de comportamento visual. `npm run build` passa. `npm run lint` passa. Smoke manual de 7 minutos (checklist na seção 10).

### Sprint 3.1.2 — Hooks de lead consolidados (3 commits)

| # | Commit | Arquivos criados | Arquivos tocados | LOC | Depende | Smoke |
|---|--------|------------------|------------------|-----|---------|-------|
| 11 | `feat(lead): useLeadMeta + useLeadPipeState + useLeadTags + useLeadProducts` | `src/hooks/lead/useLeadMeta.ts`, `src/hooks/lead/useLeadPipeState.ts`, `src/hooks/lead/useLeadTags.ts`, `src/hooks/lead/useLeadProducts.ts`, `src/hooks/lead/useLeadForm.ts`, `src/hooks/lead/useLeadCampaignsAttach.ts` | — (novos apenas) | +320/0 | #10 | apenas compile |
| 12 | `refactor(lead): tabs consomem hooks lead/*` | — | LeadTabInfo, LeadTabPipe, LeadTabCampanhas, LeadPipeActions, LeadNotes, LeadCreateForm | +180/-220 | #11 | todos os fluxos de tabs; criar lead continua funcionando |
| 13 | `chore(lead): canonicalize path em src/components/lead e stub em chat/` | `src/components/chat/LeadDetailContent.tsx` vira stub 10 LOC | LeadDetailContent shell completa em `src/components/lead/` | +40/-40 | #12 | WhatsAppChat abre detail; LeadContactModal abre detail; ContextPanel lateral renderiza |

**Checkpoint Sprint 3.1.2:** `LeadDetailContent.tsx` legacy tem 10 LOC (re-export). `src/components/lead/LeadDetailContent.tsx` é o shell real (<200 LOC). Todos os dados passam por hooks em `src/hooks/lead/*`. Zero regressão de comportamento. Contrato de props inalterado.

### Sprint 3.1.3 — Dark mode audit (7 commits)

| # | Commit | Arquivos | LOC | Depende | Smoke |
|---|--------|----------|-----|---------|-------|
| 14 | `docs(app): dark-mode-audit.md com regressões categorizadas` | `.specs/features/chat-onda-3/dark-mode-audit.md` | +400/0 | — | n/a |
| 15 | `fix(app): dark tokens em Dashboard + cards de métricas` | `src/components/dashboard/FunnelChart.tsx`, `src/components/dashboard/PerformanceChart.tsx`, `src/components/dashboard/WeeklyChart.tsx`, `src/components/dashboard/SegmentBenchmark.tsx`, `src/components/dashboard/SalesBreakdown.tsx`, `src/components/dashboard/TopPerformers.tsx`, `src/components/dashboard/FirstOrderVsBase.tsx` | +90/-90 | #14 | toggle dark/light em `/dashboard`; cards, gráficos e badges legíveis nos dois modos |
| 16 | `fix(app): dark tokens em Leads + Pipes` | `src/pages/PipeWhatsapp.tsx`, `src/components/leads/LeadCard.tsx`, `src/components/kanban/KanbanCard.tsx`, `src/components/kanban/StageWorkflowsBadge.tsx`, `src/components/leads/LeadDetailModal.tsx`, `src/components/leads/LeadDetailDrawer.tsx` | +70/-70 | #14 | dark em `/leads` e `/pipe-whatsapp`: cards, badges de origem (tiktok/outro), chips de stage |
| 17 | `fix(app): dark tokens em Copilot + Workflows` | `src/components/copilot/PromptPreviewSheet.tsx`, `src/components/copilot/playground/LivePreviewChat.tsx`, `src/components/copilot/wizard-steps/TestConversationStep.tsx`, `src/components/copilot/AgentMetricsTab.tsx`, `src/components/automacoes/SplitAbAnalytics.tsx` | +60/-60 | #14 | dark em `/copilot`, `/workflows`, `/automacoes` sem áreas brancas |
| 18 | `fix(app): dark tokens em Campanhas + Settings + Agenda + Team` | `src/pages/CampanhaDetail.tsx`, `src/components/campanhas/CampanhaAnalytics.tsx`, `src/components/campanhas/CampanhaAutomaticaPanel.tsx`, `src/components/campanhas/CampanhaSemiAutomaticaPanel.tsx`, `src/components/campanhas/CreateCampanhaModal.tsx`, `src/components/settings/MetaSettings.tsx`, `src/components/confirmacao/ConfirmacaoCard.tsx`, `src/components/confirmacao/ConfirmacaoDetailModal.tsx`, `src/components/followups/AcoesDoDia.tsx` | +90/-90 | #14 | dark em `/campanhas`, `/settings`, `/agenda`, `/team` |
| 19 | `fix(app): charts tokens duais via CSS vars (recharts)` | `src/components/dashboard/WeeklyChart.tsx`, `src/components/dashboard/PerformanceChart.tsx`, `src/components/dashboard/SegmentBenchmark.tsx`, `src/components/dashboard/MetaComparativeChart.tsx`, `src/components/dashboard/FirstOrderVsBase.tsx`, `src/components/analytics/charts/RevenueComposition.tsx`, `src/components/analytics/charts/MRREvolution.tsx`, `src/components/analytics/charts/PipelineAging.tsx`, `src/components/proposals/ProductAnalyticsChart.tsx`, `src/components/proposals/CalorAnalyticsChart.tsx`, `src/components/ranking/RankingHistoryChart.tsx`, `src/components/comissoes/CommissionChart.tsx` | +140/-140 | #15 | cartesian grid + axis + legend em dark e light usam `hsl(var(--chart-*))` |
| 20 | `fix(app): sidebar + gamification tokens coordenados em dark` | `src/components/layout/Sidebar.tsx`, `src/components/layout/SidebarPerformanceWidget.tsx`, `src/components/gamification/*.tsx`, `src/components/badges/BadgeCard.tsx`, `src/pages/Ranking.tsx`, `src/components/performance/CompetitionRankingListV2.tsx`, `src/pages/Metas.tsx` | +80/-80 | #14 | sidebar no dark não fica brown-on-brown ilegível; gamification badges contrast OK |

**Não entram em 3.1 (fica pra 3.2):**
- `src/pages/TVDashboard.tsx` + `src/components/tv/*` (50+ ocorrências `bg-white/*`) — esse é tema fixo escuro de propósito, não precisa de dual-mode. Documentar em audit.
- `src/pages/Auth.tsx`, `src/pages/Signup.tsx`, `src/pages/ResetPassword.tsx`, `src/pages/CheckoutSuccess.tsx`, `src/pages/Privacidade.tsx` — páginas pré-login com branding fixo. Documentar e deixar.
- `src/pages/master/*.tsx` — painel master interno, baixa frequência de uso. Fixar em 3.2.

**Checkpoint Sprint 3.1.3:** `.specs/features/chat-onda-3/dark-mode-audit.md` entregue. As 8 áreas HIGH corrigidas. Toggle dark/light em `/dashboard`, `/leads`, `/pipe-whatsapp`, `/copilot`, `/campanhas`, `/settings`, `/agenda` não mostra bloco branco ou texto ilegível. Screenshot antes/depois no PR.

### Sprint 3.1.4 — Rate limit `search_messages` client-side (3 commits)

| # | Commit | Arquivos criados | Arquivos tocados | LOC | Depende | Smoke |
|---|--------|------------------|------------------|-----|---------|-------|
| 21 | `feat(chat): rate limit token bucket client-side para useMessageSearch` | `src/lib/rate-limit.ts` | `src/hooks/chat/useMessageSearch.ts` | +180/-10 | — | busca funciona; na 21ª busca em <60s o hook retorna `rateLimited: true` e não dispara RPC |
| 22 | `feat(chat): graceful error toast + Sentry tracking no rate limit hit` | — | `useMessageSearch.ts`, `src/components/chat/search/CommandGroupMessages.tsx` (se existir — grep antes) | +60/-15 | #21 | quando limit hit, toast "Aguarde N segundos" aparece uma vez; Sentry recebe breadcrumb `search_messages_rate_limited` |
| 23 | `test(chat): unit tests rate-limit.ts` | `src/lib/rate-limit.test.ts` | — | +180/0 | #21 | `npm run test:unit` com 8+ casos: first N pass, N+1 blocked, recovery após window, reset, clock skew |

**Design do token bucket** (spec para commit #21):

```ts
// src/lib/rate-limit.ts
interface BucketConfig {
  key: string;           // storage key; pattern `rl:${scope}:${userId}`
  capacity: number;      // ex: 20
  refillIntervalMs: number; // ex: 60_000 (1 min → refill completo)
  storage?: Storage;     // localStorage default; injetável para test
  now?: () => number;    // injetável para test
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

interface ConsumeResult {
  allowed: boolean;
  tokensRemaining: number;
  retryAfterMs: number;  // 0 se allowed; ms para próximo token se blocked
}

export function createRateLimiter(cfg: BucketConfig): {
  tryConsume: (count?: number) => ConsumeResult;
  reset: () => void;
};
```

Regras:
- Armazena em `localStorage` por `key`. `key` inclui `userId` (pattern de B3 da Onda 2b — isolamento por usuário no mesmo device).
- `tryConsume()` é síncrono. Lê estado, calcula refill linear (tokens += elapsed / refillIntervalMs * capacity, capped em capacity), decrementa 1, persiste.
- Se `tokens < 1`, retorna `allowed=false`, `retryAfterMs = ceil((1 - tokens) * refillIntervalMs / capacity)`.
- **Defesa:** é client-side. Atacante que monkey-patch `localStorage` contorna. Isso é aceito — o controle duro é server-side (Onda 3.2 — API quota em Postgres). Aqui o objetivo é proteger do loop acidental (useEffect infinito, typeahead agressivo).
- `logger.warn('search_messages_rate_limited', { userId, tokensRemaining })` + Sentry breadcrumb com severity `warning`.

Integração no `useMessageSearch`:

```ts
const limiter = useMemo(() => createRateLimiter({
  key: `rl:search_messages:${user?.id ?? 'anon'}`,
  capacity: 20,
  refillIntervalMs: 60_000,
}), [user?.id]);

// dentro de queryFn, antes do supabase.rpc:
const res = limiter.tryConsume(1);
if (!res.allowed) {
  logger.warn('search_messages_rate_limited', { retryAfterMs: res.retryAfterMs });
  throw new Error(`rate_limited:${res.retryAfterMs}`);
}
```

No catch do `useQuery`, se `error.message.startsWith('rate_limited:')`, renderizar toast com segundos formatados; não propagar para Sentry como error (só breadcrumb).

### Sprint 3.1.5 — Migrations 2b aplicadas em dev + types regen (2 commits)

**⚠️ BLOQUEIO HUMANO:** `supabase db push` é ação destrutiva. **CTO precisa aprovar explicitamente antes deste sprint.** O agent DBA/Infra não executa sem autorização por ticket.

Sequência oficial (DBA executa, Conductor coordena):

```bash
# 1. Backup / snapshot do dev (Supabase Dashboard → Database → Backups)
#    Timestamp anotado no commit 24.

# 2. Dry run — conferir diff
supabase db diff --project-ref bcfadphgsibjzivtbjvc

# 3. Aplicar migrations pendentes
supabase db push --project-ref bcfadphgsibjzivtbjvc

# 4. Verificar Q1..Q10 do security-review-2b §Q1-Q10 (linhas 186-310)
#    Cada Q é um SQL script — anexar saída em .specs/features/chat-onda-3/q-verification.md

# 5. Regenerar types
supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts

# 6. Verificar que Q1..Q10 passaram ANTES de commitar o types.ts.
```

| # | Commit | Arquivos | LOC | Depende | Smoke |
|---|--------|----------|-----|---------|-------|
| 24 | `chore(db): migrations onda-2b aplicadas em dev + types regen` | `src/integrations/supabase/types.ts` (auto-gerado) + `.specs/features/chat-onda-3/q-verification.md` | +500/-500 (types) | autorização CTO, Q1..Q10 PASS | `npm run build` + sanity manual: takeover pill aparece, search funciona |
| 25 | `refactor(chat): remove type casts pós-regen em useTakeover/useAITimeline/useWhatsAppContacts/usePatchedRealtime` | `src/hooks/chat/useTakeover.ts`, `src/hooks/chat/useAITimeline.ts`, `src/hooks/chat/useWhatsAppContacts.ts`, `src/hooks/chat/usePatchedRealtime.ts` | +20/-40 | #24 | `npm run build` sem erros TS; casts reduzidos de 4 para 0 |

**Casts atuais a remover (confirmados via grep):**

```
src/hooks/chat/usePatchedRealtime.ts:106: return [row as unknown as TCache, ...existing];
src/hooks/chat/usePatchedRealtime.ts:120: matcherRef.current(row, item) ? (row as unknown as TCache) : item
src/hooks/chat/useWhatsAppContacts.ts:143: const tag = row.tags as unknown as ChatContactTag;
src/hooks/chat/useWhatsAppContacts.ts:162: const tag = (row as unknown as { tags: ChatContactTag }).tags;
```

Os casts em `useTakeover.ts` (linhas 86-88) usam `(row as Record<string, unknown>).ai_state as AiTakeoverState` porque `conversations.ai_state` ainda não existe em `types.ts`. Após regen, vira acesso direto tipado.

**Checkpoint Sprint 3.1.5:** `bcfadphgsibjzivtbjvc` tem as 3 migrations 2b aplicadas. `types.ts` regenerado. Q1..Q10 documentados como PASS. Quatro casts `as unknown as` eliminados. Deploy em prod (`jsjsmuncfkbsbzqzqhfq`) FICA PARA ONDA 3.2 (regra do security review 2b linha 368).

---

## 4. Dark mode audit detalhado (input para commit #14)

Comando base executado (2026-04-22):

```bash
grep -rn "bg-gray-\|bg-white\|bg-black\|text-black\|text-white\|border-gray-\|shadow-lg\|shadow-xl" \
  src/pages src/components --include="*.tsx" \
  | grep -v " 2\.tsx"
```

- **Total de matches:** 209 ocorrências.
- **Arquivos únicos em `src/pages`:** 15.
- **Arquivos únicos em `src/components`:** 63.
- **Shadows sem `dark:` counterpart:** 55 ocorrências.

### 4.1 Princípios de remediação

1. **Usar tokens, não cores.** `bg-card` no lugar de `bg-white`; `text-foreground` no lugar de `text-black`; `border-border` no lugar de `border-gray-200`.
2. **Cores utilitárias (emerald/amber/red) mantém família, mas com opacidade ou variants escuros.** Ex: `bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`.
3. **Shadows invisíveis no dark viram `ring-1 ring-border/50` + `shadow-md dark:shadow-none`.** Shadow preto sobre fundo preto some — substituir por borda sutil.
4. **Charts usam CSS vars `hsl(var(--chart-1..5))`** (já definidos em `src/index.css` linhas 102-107 + dark block). Remover hex hard-coded.
5. **Sidebar tem tokens próprios `--sidebar-*`** que JÁ variam por tema (src/index.css linhas 93-100 light, 186-187 dark). Sidebar em si está OK; componentes INTERNOS à sidebar que usam `text-white` direto (SidebarPerformanceWidget) trocam por `text-sidebar-foreground`.

### 4.2 Categorização por severidade

**HIGH — páginas centrais com fundo branco explícito em dark mode** (corrigir em Sprint 3.1.3):

| Arquivo | Linhas-exemplo | Problema | Fix |
|---------|---------------|----------|-----|
| `src/pages/PipeWhatsapp.tsx` | 58 (`bg-gray-900`), 67 (`bg-gray-500`) | Badges de origem com fundo cinza fixo | Tokens por família de origem + `dark:bg-*` |
| `src/components/leads/LeadCard.tsx` | 50 (`bg-gray-900/10 text-gray-900 border-gray-900/20`) | Categoria "tiktok" hard-coded | Token `bg-foreground/10 text-foreground border-foreground/20` |
| `src/components/kanban/KanbanCard.tsx` | 622 (`bg-amber-500 text-white`) | Badge de lead hot sem dual | `bg-amber-500 text-white dark:bg-amber-600` |
| `src/components/dashboard/FunnelChart.tsx` | N/A (inspect) | shadow-lg sem counterpart + label colors fixas | Audit por arquivo |
| `src/components/dashboard/PerformanceChart.tsx` | N/A | hex fixo em `stroke`/`fill` recharts | Substituir por `hsl(var(--chart-*))` |
| `src/components/dashboard/WeeklyChart.tsx` | idem | idem | idem |
| `src/components/campanhas/CampanhaAnalytics.tsx` | N/A | shadow-lg + gráfico sem dark | Audit |
| `src/pages/CampanhaDetail.tsx` | 34 (`bg-gray-100 text-gray-700 dark:bg-muted dark:text-muted-foreground`) | Parcialmente corrigido mas classe light fixa | `bg-muted text-muted-foreground` único |

**MEDIUM — componentes compartilhados usados em várias telas**:

| Arquivo | Ocorrências | Fix |
|---------|-------------|-----|
| `src/components/layout/Sidebar.tsx` (interno ao `.dark` funciona; mas widgets filhos) | inspecionar | Trocar `text-white` internos por `text-sidebar-foreground` |
| `src/components/layout/SidebarPerformanceWidget.tsx` | tem `bg-sidebar-*` já ok | Verificar só casos de `text-white` residuais |
| `src/components/ui/dialog.tsx`, `ui/drawer.tsx`, `ui/sheet.tsx`, `ui/alert-dialog.tsx` | backdrop `bg-black/50` | Manter (overlay é cor-fixa por design); verificar que o conteúdo interno usa tokens |
| `src/components/copilot/playground/LivePreviewChat.tsx` | bolhas de preview | Usar `bubble-*` tokens |
| `src/components/copilot/PromptPreviewSheet.tsx` | syntax highlight bg branco | `bg-muted` + `text-muted-foreground` para code block; ou `prose dark:prose-invert` |
| `src/components/copilot/wizard-steps/TestConversationStep.tsx` | simulação de chat com `bg-white` nas bubbles | Usar os mesmos tokens `bubble-incoming/outgoing` do Chat real |
| `src/components/gamification/AchievementBadge.tsx`, `LeaderboardCard.tsx`, `LevelBadge.tsx`, `StreakCounter.tsx` | text-white em gradientes | Manter (gradiente é colorido fixo); garantir contraste mínimo WCAG AA |
| `src/components/performance/CompetitionRankingListV2.tsx` | shadow-xl | `shadow-xl dark:shadow-none dark:ring-1 dark:ring-border` |
| `src/components/automacoes/SplitAbAnalytics.tsx` | cards de análise com `bg-white` | `bg-card` |
| `src/components/analytics/charts/*.tsx` | axis color fixo | `hsl(var(--muted-foreground))` |

**LOW — telas pouco acessadas ou intencional**:

| Arquivo | Nota |
|---------|------|
| `src/pages/TVDashboard.tsx` + `src/components/tv/*.tsx` | **INTENCIONAL.** TV Dashboard tem tema escuro fixo (mostrador físico em venda). `text-white` é parte do design. **Skip Onda 3.1.** Documentar em audit. |
| `src/pages/Auth.tsx`, `src/pages/Signup.tsx`, `src/pages/ResetPassword.tsx` | Páginas pré-login com branding `gradient-primary`. `text-white` é contraste contra gradiente gold. **Skip.** |
| `src/pages/CheckoutSuccess.tsx`, `src/pages/Privacidade.tsx` | Idem (Privacidade é página pública com fundo branco fixo). **Skip Onda 3.1.** |
| `src/pages/master/MasterAuditLogs.tsx`, `MasterFeatures.tsx`, `MasterOperations.tsx` | Painel master interno (uso baixo). Badge colors com `bg-gray-500` como fallback. **Onda 3.2.** |
| `src/pages/ApiDocs.tsx` | Docs com layout próprio. **Onda 3.2.** |
| `src/pages/Ranking.tsx`, `src/pages/Metas.tsx` | Pódio com badge de ouro/prata/bronze tem `text-white` sobre gradiente — intencional em top 3; verificar só linhas 319/416 onde está condicional no Metas. Fix inclui pedaço em Sprint #20. |

### 4.3 Patterns de fix (cheat sheet para Frontend aplicar)

```diff
- <div className="bg-white border border-gray-200 shadow-lg rounded-lg p-4">
+ <div className="bg-card border border-border rounded-lg p-4 shadow-md dark:shadow-none dark:ring-1 dark:ring-border">

- <p className="text-gray-700">Label</p>
+ <p className="text-muted-foreground">Label</p>

- <h3 className="text-black font-bold">Title</h3>
+ <h3 className="text-foreground font-bold">Title</h3>

- <Badge className="bg-gray-500 text-white">Info</Badge>
+ <Badge variant="secondary">Info</Badge>  {/* já tem tokens dual */}

- <LineChart><Line stroke="#f59e0b" /></LineChart>
+ <LineChart><Line stroke="hsl(var(--chart-1))" /></LineChart>

- <CartesianGrid stroke="#e5e7eb" />
+ <CartesianGrid stroke="hsl(var(--border))" />
```

---

## 5. Riscos por sprint e mitigação

### Sprint 3.1.1 — Split do LeadDetailContent

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------:|---------|-----------|
| Quebra silenciosa de tab (estado não propagado, form não hydrata) | Média | Alto (bloqueia chat inteiro) | Checklist de smoke manual (§10) executado APÓS CADA commit. Snapshot visual (print antes/depois) no PR. |
| Hoisting de estado (form em creation vs. edit gera bugs) | Média | Médio | Separar `LeadCreateForm` do `LeadTabInfo` — nunca compartilhar `formData` state cross-mode. |
| Consumer silencioso (algum `import { ... } from "./LeadDetailContent"` além dos 3 conhecidos) | Baixa | Médio | `grep -rn "LeadDetailContent" src/` antes de Sprint #13. Confirmado: apenas 3 imports externos. |
| Perda de useEffect de reset (destination → stage) | Média | Médio | Testar explicitamente: alternar destination 5x e confirmar stage reseta. |

### Sprint 3.1.2 — Hooks consolidados

| Risco | P | I | Mitigação |
|-------|---|---|-----------|
| Hooks em `useLeadMeta` duplicam queries de `useLeadByPhone` | Média | Baixo | `useLeadMeta` é fachada — delega para `useLeadByPhone`. Mesma queryKey, sem duplicação de request. |
| Fachada `useLeadPipeState` divergir de `useLeadAllPipelines` | Baixa | Médio | Re-export das mutations, sem lógica adicional. Testes de integração existentes devem continuar passando. |
| `useLeadForm` gera invalidações a mais | Média | Baixo | QueryKey pattern `["leads", organizationId]` mantido. Revisar invalidations antes do merge do #12. |

### Sprint 3.1.3 — Dark mode

| Risco | P | I | Mitigação |
|-------|---|---|-----------|
| Regressão visual em light mode após troca de `bg-white` → `bg-card` | Alta | Baixo | `bg-card` em :root é `0 0% 100%` (branco). Visualmente idêntico. Validar com prints. |
| Chart tokens quebrarem em Recharts específicos (fill vs stroke) | Média | Médio | Commit #19 por último; testar cada gráfico individualmente. |
| Sidebar perder contraste em dark | Baixa | Médio | Sidebar tokens já variam por tema — só componentes filhos tocam. Pre-check em Storybook/smoke. |
| Badges de origem (tiktok, etc.) ficarem ilegíveis | Baixa | Baixo | Fix token-based mantém legibilidade em ambos modos. |

### Sprint 3.1.4 — Rate limit

| Risco | P | I | Mitigação |
|-------|---|---|-----------|
| localStorage indisponível (Safari privado, iframe sandbox) | Baixa | Baixo | Fallback para Map in-memory. Graceful degradation: se storage falhar, não rate-limit (permite uso, registra warning). |
| Clock skew (user altera data do sistema) | Baixa | Baixo | `performance.now()` ou `Date.now()` — aceitamos. Worst case: token refill antecipado. Isso é client-side, server bate depois (Onda 3.2). |
| Race condition entre abas | Média | Baixo | localStorage é compartilhado entre abas — ok. `tryConsume` não é atômico entre abas (duas abas podem consumir simultaneamente), mas o bucket comporta a corrida (limite conceitual: 20/min, realidade: 20-21/min com 2 abas abrindo exatamente ao mesmo tempo). Aceitável. |
| Falso positivo bloqueia uso legítimo | Média | Médio | Capacity=20/min é confortável para typeahead de 300ms debounce. Monitorar Sentry breadcrumbs para ajustar. |

### Sprint 3.1.5 — Migrations dev + types

| Risco | P | I | Mitigação |
|-------|---|---|-----------|
| `db push` aplica migration em prod por acidente | Baixa | **Crítico** | `--project-ref bcfadphgsibjzivtbjvc` explícito; CTO autoriza por ticket; `.env` do supabase-cli bloqueia target remoto. |
| Types regen quebra código legado | Média | Alto | `npm run build` ANTES de commit #24 e DEPOIS do #25. Qualquer erro TS é rollback (git restore types.ts). |
| Q1-Q10 falham (migration tem bug) | Baixa | Alto | Security-review-2b deu PASS em todas. Rollback documentado nas próprias migrations (§ Reversão (DOWN)). |
| Coluna `ai_state` não existe mas hook já está em produção | Baixa | Crítico | **Pré-check:** dev já roda hoje? Não — hooks têm fallback `as Record<string, unknown>` que retorna DEFAULT_STATE. Se `ai_state` não existe, retorna NULL → default. Nenhum usuário quebra. |

---

## 6. Linha do tempo (estimativa total ~60h)

| Sprint | Escopo | Horas | Cumulativo |
|--------|--------|------:|-----------:|
| 3.1.1 | Split LeadDetailContent (10 commits) | **15h** | 15h |
| 3.1.2 | Hooks lead/* (3 commits) | **8h** | 23h |
| 3.1.3 | Dark mode (7 commits) | **25h** | 48h |
| 3.1.4 | Rate limit (3 commits) | **8h** | 56h |
| 3.1.5 | Migrations dev + types (2 commits) | **5h** | 61h |
| **Total** | **25 commits** | **~60h** | |

**Paralelização possível:**
- 3.1.3 (dark) pode rodar em paralelo com 3.1.1/3.1.2 (arquivos disjuntos — dark mexe em dashboards/copilot/analytics, split mexe em chat/lead).
- 3.1.4 (rate limit) pode rodar em paralelo com tudo — só toca `useMessageSearch.ts` e `src/lib/rate-limit.ts`.
- 3.1.5 depende de autorização humana — pode ser executado a qualquer momento após aprovação, idealmente após 3.1.1+3.1.2 para consumir os tipos novos.

Com 1 dev junior + Architect review, realistic wall-time: **8-10 dias corridos**. Com 2 devs paralelos: **5-6 dias**.

---

## 7. Backwards-compatibility

### 7.1 Contrato externo inalterado

- `LeadDetailContent` props: `{ phoneNumber, pushName?, onClose?, showHeader? }` — zero mudança.
- Import paths:
  - `import { LeadDetailContent } from "@/components/chat/LeadDetailContent"` → funciona (stub re-export).
  - `import { LeadDetailContent } from "@/components/lead/LeadDetailContent"` → funciona (canônico).
- `useMessageSearch` hook: retorno `{ results, isLoading, error, search, clear, activeQuery }` — permanece. Adiciona apenas que `error` pode conter `rate_limited:N` que a UI deve tratar (opcional — fallback já tem toast).

### 7.2 Hooks antigos preservados

Hooks `useLeadByPhone`, `useLeadAllPipelines`, `useWhatsAppLeadIntegration`, `useLeadTimeline` não mudam. Os novos hooks em `src/hooks/lead/*` são **fachadas aditivas** — usam os antigos por baixo. Zero breaking change.

### 7.3 Tipos TypeScript

- `LeadDetailContentProps` exportado de ambos os paths.
- `PipelineStatus`, `StandardPipelineStatus`, `CustomPipelineStatus` continuam vindo de `@/hooks/useLeadAllPipelines`.
- `TimelineEvent` continua vindo de `@/hooks/useLeadTimeline`.

### 7.4 Migration plan de paths (Onda 3.2)

Em Onda 3.2 podemos (opcional) atualizar os imports de `./LeadDetailContent` para `@/components/lead/LeadDetailContent` e deletar o stub. Fora de escopo agora — stub custa 10 LOC e zero runtime.

---

## 8. Documentação a atualizar (Conductor)

Após cada sprint fechar:

- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/chat/onda-3.md` — criar nota.
- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/07 — Changelog/2026-04-DD.md` — daily.
- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisoes/ADR-onda-3-split-leaddetailcontent.md` — ADR da inversão de path canônico.
- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisoes/ADR-rate-limit-client-side.md` — ADR escolhendo token bucket client sobre server agora, com plano para server em 3.2.
- `.specs/project/STATE.md` — atualizar status.
- `.specs/features/chat-onda-3/dark-mode-audit.md` — criar em commit #14.
- `.specs/features/chat-onda-3/q-verification.md` — output dos Q1-Q10 em commit #24.

---

## 9. Próximos passos (quem executa o quê)

| Passo | Agente | Output |
|-------|--------|--------|
| Review deste plan | **CTO** (humano) | approve / reject / ajustes |
| Autorizar `db push` dev | **CTO** | OK por ticket (pre Sprint 3.1.5) |
| UI spec para dark mode remediations | **UI** | `.specs/features/chat-onda-3/ui-spec-dark-mode.md` (opcional — cheat sheet §4.3 já pode guiar Frontend) |
| Security review do plan de rate limit | **Security** | sign-off em §3.1.4 (esperado PASS — client-side + Sentry tracking) |
| Execução Sprint 3.1.1 | **Frontend** | 10 commits conforme §3 |
| Execução Sprint 3.1.2 | **Frontend** | 3 commits |
| Execução Sprint 3.1.3 | **Frontend** (consulta UI para padrões quando dúvida) | 7 commits + audit doc |
| Execução Sprint 3.1.4 | **Frontend** + **QA** (unit tests) | 3 commits |
| Execução Sprint 3.1.5 | **DBA** (migration apply) + **Backend** (types regen + cast cleanup) | 2 commits |
| QA final E2E | **QA** | Playwright suite em branch, incluindo takeover pill + search + criar lead (todos os destinos) |

---

## 10. Smoke-test checklist (executar APÓS cada sprint)

**Chat (pós Sprint 3.1.1 e 3.1.2):**

- [ ] Abrir `/chat` → selecionar conversa existente → tab "Info": nome/empresa/email renderizam corretos.
- [ ] Editar rating → "Salvar" → toast de sucesso → reload: valor persistiu.
- [ ] Tab "Pipeline": badge do stage atual aparece; clicar → dropdown expande; mover para outro stage → toast.
- [ ] Tab "Pipeline": "Adicionar a outro funil" → select → "Adicionar" → toast.
- [ ] Tab "Campanhas": se houver campanha ativa, select → "Adicionar" → toast.
- [ ] Tab "Histórico": lista últimos 8 eventos com timestamp.
- [ ] Conversa com número desconhecido (sem lead): form de criação completo; preencher nome, selecionar destino "qualificação" + stage → "Criar Lead" → toast + tabs aparecem.
- [ ] Destinos: qualificação, confirmação, propostas, campanha, custom — cada um valida stage obrigatório.

**Dark mode (pós Sprint 3.1.3):**

- [ ] Toggle dark/light com `document.documentElement.classList.toggle('dark')` no DevTools em cada rota abaixo. Zero bloco branco em dark, zero texto ilegível em light:
  - [ ] `/dashboard`
  - [ ] `/leads`
  - [ ] `/pipe-whatsapp`
  - [ ] `/chat`
  - [ ] `/copilot`
  - [ ] `/workflows`
  - [ ] `/automacoes`
  - [ ] `/campanhas`
  - [ ] `/agenda`
  - [ ] `/team`
  - [ ] `/settings`

**Rate limit (pós Sprint 3.1.4):**

- [ ] Abrir ⌘K → digitar 20 buscas distintas (≥3 chars cada) rapidamente → 21ª exibe toast "Aguarde Ns"; Sentry breadcrumb registrado.
- [ ] Aguardar 3 segundos → nova busca deve passar (refill parcial).
- [ ] Logout → login outro user → bucket do primeiro não influencia segundo (key por `userId`).

**Migrations dev (pós Sprint 3.1.5):**

- [ ] Takeover pill aparece no ChatHeader com estado correto.
- [ ] Pausar IA → DB confirma `ai_state=AI_PAUSED_MANUAL`.
- [ ] Tentar transition ilegal via SQL direto → trigger rejeita com `check_violation`.
- [ ] ⌘K → digitar "proposta" (≥3 chars) → grupo "Mensagens" popula.
- [ ] `npm run build` zero erros TS.
- [ ] Grep `as unknown as` em `src/hooks/chat/` → 0 matches.

---

## 11. Definition of Done — Onda 3.1

- [ ] 25 commits atômicos pushed para `feat/chat-ux-ui-redesign`.
- [ ] `LeadDetailContent.tsx` canônico em `src/components/lead/` com <200 LOC.
- [ ] 4 hooks novos em `src/hooks/lead/*` em uso pelas tabs.
- [ ] `src/components/chat/LeadDetailContent.tsx` reduzido a stub de re-export <15 LOC.
- [ ] 8 áreas HIGH de dark mode corrigidas; audit doc listando LOW/MEDIUM diferidos.
- [ ] `src/lib/rate-limit.ts` com ≥8 unit tests passando.
- [ ] 3 migrations 2b aplicadas em `bcfadphgsibjzivtbjvc` com Q1-Q10 PASS documentado.
- [ ] `types.ts` regenerado; 4 casts `as unknown as` removidos.
- [ ] `npm run build`, `npm run lint`, `npm run test:unit` verdes.
- [ ] Smoke checklist §10 completo e arquivado.
- [ ] Obsidian + STATE.md + ADRs atualizados.
- [ ] Sem veto de Security; sign-off de UI em dark mode spec.
- [ ] **Não vai para prod nesta onda.** Prod deploy das migrations é Onda 3.2 após QA completo em dev.

---

## 12. O que vem depois (Onda 3.2 — fora de escopo agora)

- Rate limit server-side: tabela `api_rate_limit` + RPC `enforce_search_rate_limit` (LGPD + adversarial).
- Auditoria de buscas (quem buscou o quê, quando) — compliance interno.
- Dark mode cleanup nas telas LOW (master/*, TVDashboard pre-login páginas se houver decisão).
- Rename de imports `./LeadDetailContent` → `@/components/lead/LeadDetailContent` + remover stub.
- Split de `useLeadAllPipelines` (369 LOC) se dor persistir.
- Deploy das migrations 2b em prod.

---

**Fim do plano.**
