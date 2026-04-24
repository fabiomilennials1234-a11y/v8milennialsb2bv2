# Dark Mode Audit — Onda 3.1 Sprint 3

**Data:** 2026-04-22
**Branch:** `feat/chat-ux-ui-redesign`
**Executado por:** Frontend (agent-frontend)

---

## Metodologia

Greps executados em `src/pages` + `src/components` (excluindo arquivos duplicados `* 2.tsx`):

```bash
grep -rn "bg-gray-\|bg-white\|bg-black\|text-black\|text-white" src/pages src/components --include="*.tsx"
grep -rn "border-gray-\|shadow-lg\|shadow-xl\|shadow-2xl" src/pages src/components --include="*.tsx"
```

**Total de matches (cor hard-coded):** 211
**Total de matches (shadows/border-gray):** 64
**Total combinado:** 275

---

## Categorização

### HIGH — Corrigir em C15-C19

Fundo branco explícito ou cor de texto não-dual em páginas centrais do app.

| Arquivo | Linha | Problema | Fix aplicado |
|---------|-------|----------|-------------|
| `src/pages/PipeWhatsapp.tsx` | 58, 67 | `bg-gray-900`, `bg-gray-500` em badges de origem (tiktok, outro) | `bg-foreground/15`, `bg-muted-foreground/15` |
| `src/components/kanban/KanbanCard.tsx` | 50 | `bg-gray-900/10 text-gray-900 border-gray-900/20` em tiktok badge | `bg-foreground/10 text-foreground border-foreground/20` |
| `src/components/confirmacao/ConfirmacaoCard.tsx` | 80 | `bg-gray-900/10 text-gray-900 border-gray-900/30` em tiktok | `bg-foreground/10 text-foreground border-foreground/20` |
| `src/pages/CampanhaDetail.tsx` | 34 | `bg-gray-100 text-gray-700` + dark override em classe "manual" | Simplificar para `bg-muted text-muted-foreground` único |
| `src/components/campanhas/CampanhaAnalytics.tsx` | 102 | `shadow-lg` em div verde sem dark counterpart | `shadow-md dark:shadow-none dark:ring-1 dark:ring-success/30` |
| `src/components/campanhas/CampanhaAnalytics.tsx` | 348 | `shadow-lg` no indicador de progresso | idem |
| `src/components/campanhas/CampanhaAnalytics.tsx` | 138 | `from-gray-400/20 via-gray-400/10 border-gray-400/30` rank 2 | `from-muted-foreground/20 via-muted-foreground/10 border-muted-foreground/30` |
| `src/components/campanhas/CreateCampanhaModal.tsx` | 151 | `border-gray-200 dark:border-border` (redundante com override) | `border-border` único |
| `src/components/campanhas/CampanhaAutomaticaPanel.tsx` | 58 | `bg-gray-100 dark:bg-muted` (mixed) | `bg-muted` único |
| `src/components/campanhas/CampanhaSemiAutomaticaPanel.tsx` | 299 | `bg-gray-100 dark:bg-muted` fallback | `bg-muted` |
| `src/components/automacoes/SplitAbAnalytics.tsx` | 223 | `bg-green-600 text-white` badge "Melhor" | `bg-success text-success-foreground` |
| `src/components/copilot/playground/LivePreviewChat.tsx` | 53, 478 | `bg-black/10` em componentes internos de media card | `bg-foreground/10` |
| `src/components/copilot/wizard-steps/TestConversationStep.tsx` | 433 | `bg-black/10` em attachment preview | `bg-foreground/10` |
| `src/components/followups/AcoesDoDia.tsx` | 257 | `text-white` em checkbox concluído | `text-success-foreground` (já sobre bg-success) |
| `src/components/settings/MetaSettings.tsx` | 155 | `text-white` em botão com gradiente primário | aceitável — gradiente gold é fundo fixo; LOW |
| `src/components/analytics/charts/PipelineAging.tsx` | 126-144 | hex `#22c55e`, `#fb923c`, `#ef4444`, `#7f1d1d` em barras de envelhecimento | `hsl(var(--success))`, warning-family, destructive-family |
| `src/components/proposals/CalorAnalyticsChart.tsx` | 28, 35, 42 | hex `#EF4444`, `#F59E0B`, `#94A3B8` em pie chart | `hsl(var(--destructive))`, `hsl(var(--chart-5))`, `hsl(var(--muted-foreground))` |

---

### MEDIUM — Aceitáveis ou parcialmente corrigidos

| Arquivo | Observação |
|---------|------------|
| `src/components/layout/Sidebar.tsx` L622 | `bg-amber-500 text-white` em badge de chat unread — amber com text-white é válido (contraste AA OK). Manter. |
| `src/components/leads/LeadCard.tsx` L545 | `bg-[#25D366]` no botão WhatsApp — cor de marca fixa (verde WhatsApp). Manter. |
| `src/components/gamification/*.tsx` | `text-white` em gradientes coloridos (fundo chromático, não preto/branco). Contraste WCAG AA válido. Manter exceto `LevelBadge` (shadow + border-white/20). |
| `src/components/performance/CompetitionPodiumV2.tsx` | `shadow-lg` em posição badge — adicionar `dark:shadow-none dark:ring-1 dark:ring-border/50` |
| `src/components/confirmacao/ConfirmacaoCard.tsx` L291 | `shadow-lg` com `shadow-destructive/10` — tem counterpart colorido, OK |
| `src/components/branding/V8Logo.tsx` L47 | `text-white` em bg chart-2 (verde fixo) — OK |
| `src/components/copilot/PromptPreviewSheet.tsx` L38 | `bg-black/60` overlay — overlay é cor-fixa por design, WCAG exige contraste no conteúdo, não no overlay. OK. |
| `src/components/copilot/PromptPreviewSheet.tsx` L48 | `shadow-xl` em painel lateral — adicionar `dark:shadow-none` |
| `src/pages/Metas.tsx` L319, 416 | `text-white` em ícone de posição top3 — sobre gradiente gold, válido. Manter. |
| `src/pages/Ranking.tsx` L73, 87 | `text-white` + `bg-white/20` em badge top3 — sobre gradiente, válido. Manter. |
| `src/pages/Performance.tsx` L173, 186 | Idem Ranking. Manter. |
| `src/pages/ApiDocs.tsx` L162 | `bg-black/40` overlay móvel — overlay cor-fixa OK. Manter. |
| `src/components/settings/api-docs/ApiCodePanel.tsx` | `bg-blue-600 text-white` — blue é parte do design da API doc (HTTP methods). Discutir com UI em 3.2. |
| `src/components/settings/api-docs/ApiExplorer.tsx` | Idem. |
| `src/components/ui/sidebar-demo.tsx` | Componente de demonstração/unused — verificar se está no bundle ativo. LOW. |
| `src/components/chat/ConversationNotes.tsx` | `bg-white dark:bg-amber-950/20` — já tem dark counterpart correto. OK. |
| `src/pages/Agenda.tsx` L618 | `shadow-2xl` em popup de evento — adicionar `dark:shadow-none dark:ring-1 dark:ring-border` |
| `src/components/campanhas/CampanhaKanban.tsx` L861 | `shadow-lg` em Card — `bg-card shadow-lg` é válido pois shadow-lg em card light tem escala adequada. Adicionar `dark:shadow-none` |

---

### LOW — Diferir para Onda 3.2

| Arquivo | Motivo de skip |
|---------|---------------|
| `src/pages/TVDashboard.tsx` | **INTENCIONAL.** TV Dashboard tem tema escuro fixo (mostrador físico). `text-white`, `bg-white/5`, `bg-white/10` são parte do design glassmorphism. Não sofre toggle dark/light. Skip permanente até decisão de produto. |
| `src/components/tv/*.tsx` | Mesmo motivo. SalesThermometer, HotProposals, SalesFunnel, AICoachSection, IndividualGoals — todos dark-only por design. |
| `src/pages/Auth.tsx` | Branding pré-login com gradiente gold. `text-white` é contraste sobre primário. Skip. |
| `src/pages/Signup.tsx` | Idem. |
| `src/pages/ResetPassword.tsx` | Idem. |
| `src/pages/CheckoutSuccess.tsx` | Página de sucesso pós-checkout com branding fixo. Skip. |
| `src/pages/Privacidade.tsx` | Página pública com `bg-white` intencional (branding externo). Skip. |
| `src/pages/master/MasterAuditLogs.tsx` | Painel master interno, baixo uso. `bg-gray-500` fallback em badge. Onda 3.2. |
| `src/pages/master/MasterOperations.tsx` | Idem. `bg-gray-500/10 text-gray-500` em status badge. Onda 3.2. |
| `src/pages/master/MasterFeatures.tsx` | Idem. |
| `src/pages/ApiDocs.tsx` | API docs com layout próprio + blue HTTP method badges por convenção da indústria. Onda 3.2. |
| `src/components/chat/**` | Cobertos em Onda 1 + 2. NÃO tocar. |
| `src/components/ui/animated-sidebar.tsx` | `bg-white dark:bg-neutral-900` — já tem dark counterpart. Primitivo shadcn, não tocar. |
| `src/components/ui/sidebar-demo.tsx` | Demo component — avaliar se está no bundle. Onda 3.2. |
| `src/components/shared/UpgradeModal.tsx` | `gradient-primary text-white` — sobre gradiente gold, válido. |
| `src/components/checkout/PlanSelector.tsx` | `text-white` em badge "Popular" sobre gradiente. Válido. |

---

## Padrões de fix aplicados (cheat sheet)

```diff
- bg-gray-900                   → bg-foreground/15  (para badges escuros)
- bg-gray-500                   → bg-muted-foreground/15
- bg-gray-100 dark:bg-muted     → bg-muted  (colapsar redundância)
- border-gray-200 dark:border-border → border-border  (idem)
- text-gray-700 dark:text-muted-foreground → text-muted-foreground
- bg-gray-900/10 text-gray-900 border-gray-900/20  → bg-foreground/10 text-foreground border-foreground/20
- bg-gray-400/20 via-gray-400/10 border-gray-400/30 → bg-muted-foreground/20 via-muted-foreground/10 border-muted-foreground/30
- bg-black/10                   → bg-foreground/10
- bg-green-600 text-white       → bg-success text-success-foreground
- shadow-lg (card em dark)      → shadow-md dark:shadow-none dark:ring-1 dark:ring-border/50
- "#22c55e" (chart)             → hsl(var(--success))
- "#fb923c" (chart)             → hsl(var(--chart-5))  (ou hsl(var(--warning)) se mapeado)
- "#ef4444" (chart)             → hsl(var(--destructive))
- "#7f1d1d" (chart)             → hsl(var(--destructive))  (darkened via opacity)
- "#EF4444" "#F59E0B" "#94A3B8" → hsl(var(--destructive)), hsl(var(--chart-5)), hsl(var(--muted-foreground))
```

---

## Impacto estimado por commit

| Commit | Arquivos | LOC alteradas |
|--------|----------|--------------|
| C15 — Dashboard + Leads | PipeWhatsapp, KanbanCard, LeadCard (tiktok badge), dashboard charts tooltip | ~25 |
| C16 — Pipes + Confirmacao | ConfirmacaoCard (tiktok badge) | ~5 |
| C17 — Copilot + Workflows | LivePreviewChat, TestConversationStep, PromptPreviewSheet, SplitAbAnalytics | ~12 |
| C18 — Campanhas + Settings + Agenda | CampanhaDetail, CampanhaAnalytics, CampanhaAutomaticaPanel, CampanhaSemiAutomaticaPanel, CreateCampanhaModal, AcoesDoDia | ~20 |
| C19 — Componentes compartilhados | (sem novas ocorrências HIGH fora do já listado) | 0 extra |
| C20 — Charts + Sidebar | PipelineAging, CalorAnalyticsChart | ~15 |

**Total de LOC impactadas (estimado):** ~77 linhas alteradas em ~15 arquivos.

---

## Smoke check esperado

Após todos os commits, toggle `document.documentElement.classList.toggle('dark')` nas seguintes rotas não deve exibir nenhum bloco branco ou texto ilegível:

- `/dashboard` — cards, charts, badges de origem
- `/leads` — LeadCard badges
- `/pipe-whatsapp` — KanbanCard badges tiktok/outros
- `/confirmacao` — ConfirmacaoCard badges
- `/campanhas` — CampanhaAnalytics, CreateCampanhaModal
- `/copilot` — LivePreviewChat, PromptPreviewSheet, TestConversationStep
- `/workflows` + `/automacoes` — SplitAbAnalytics nodes
- `/agenda` — popup de evento
- `/settings` — MetaSettings
