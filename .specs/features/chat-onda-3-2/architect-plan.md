# Architect Plan — Chat Onda 3.2

**Autor:** Architect (agent-architect)
**Data:** 2026-04-22
**Branch:** `feat/chat-onda-3-2`
**Baseline:** tip `4fb223b` — Onda 1 + 2a + 2b + 3 + 3.1 + uazapi + Onda 4 (feature flag) + Onda 5 (integration real) merged.
**Dependências upstream:**
- `.specs/features/chat-onda-3/architect-plan.md`
- `.specs/features/chat-onda-3/dark-mode-audit.md`
- `.specs/features/chat-onda-2b/architect-plan.md`
**Status:** Plano — zero código neste commit.

---

## 0. Veredicto de escopo

Onda 3.2 é **consolidação de plataforma**, não novas ondas de chat. Quatro frentes, cada uma com uma dor operacional específica:

1. **Storybook está ausente.** Componentes do chat (bubbles, takeover, composer, timeline, palette) são consumidos em 1-2 páginas reais e em mockups que já começaram a apodrecer (`MockupChat 2.tsx`, `MockupChatV3.tsx` que é 80 % copy-paste de JSX). Falta uma harness isolada que sirva de fonte de verdade visual e de regressão.
2. **Mobile do chat é placeholder.** `ChatShell` declara explicitamente no header — `Mobile <780px: este componente é para viewport ≥780px. Abaixo de 780px, WhatsAppChat.tsx mantém o layout stack atual` — ou seja, a Onda 2b deliberadamente pulou mobile e deixou o legado. Com a flag `VITE_CHAT_ONDA_2B` sendo ligada progressivamente, um usuário em celular hoje cai em `WhatsAppChat.tsx` (visual pré-Onda 1). Dívida de UX **pública**.
3. **Onboarding é reset.** Já existe `org_onboarding` (quiz, `20260327000001_create_org_onboarding.sql`) + `OnboardingWizard`, porém é um quiz one-shot de setup inicial. Não existe **checklist persistente** estilo Vercel/Linear que guie o cliente pelos 6 primeiros dias. `MasterOrganizations` mostra "30 orgs ativas" mas churn silencioso por abandono pós-signup é a maior dor segundo CTO.
4. **Dark mode LOW.** Páginas diferidas explicitamente por `dark-mode-audit.md` (TVDashboard, Auth, Signup, ResetPassword, CheckoutSuccess, Privacidade, `master/*`, ApiDocs). Não são crítico de funnel, mas são visíveis em demos e auditorias.

**Regra de escopo desta onda:** nenhum componente novo do chat em si; nenhum realtime novo; nenhum backend novo (exceto 1 migration + 1 RPC de demo data). Se ultrapassar ~60h, partir em 3.2a/3.2b antes de mergear.

**O que NÃO entra em 3.2:**
- Nenhuma mudança em `WhatsAppChat.tsx` legado (vai ser apagado em 3.3, quando flag `chatOnda2b` for default-on e estável).
- Nenhuma integração server-side de rate limit (dívida de 3.2 antiga, reclassificada pra 3.3).
- Nenhuma PWA / service worker mobile (prematuro).
- Nenhuma expansão de `org_onboarding` existente (quiz). Criamos **tabela nova** `org_onboarding_progress` — responsabilidade disjunta.

---

## 1. Inventário (evidência, não suposição)

### 1.1 Storybook

```
$ ls /Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/.storybook
No such file or directory
$ grep "@storybook" package.json
(no output)
```

**Não existe.** Nenhum pacote `@storybook/*`, nenhum diretório `.storybook`, nenhum arquivo `*.stories.{ts,tsx}`. Instalação é do zero.

### 1.2 `useMediaQuery` / `useIsMobile`

Existe: `src/hooks/use-mobile.tsx`, breakpoint **768px**.

```ts
const MOBILE_BREAKPOINT = 768;
export function useIsMobile() { ... window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`) ... }
```

**Decisão:** a spec pede 780px. Discrepância de 12px é cosmética, mas `use-mobile.tsx` está espalhado em código legado. **Não tocar em `use-mobile`**. Criar `src/hooks/chat/useChatViewport.ts` com breakpoint 780 (alinha com o comentário em `ChatShell.tsx:13`) e expor também `isCompact` (<1100px) se precisarmos escalonar mais tarde. Um hook, uma responsabilidade.

### 1.3 Drawer / Sheet

- `src/components/ui/drawer.tsx` — wrapper sobre `vaul@0.9.9`. Ideal para o "Ver lead" bottom-up (drag-to-dismiss nativo no iOS). **Usar.**
- `src/components/ui/sheet.tsx` — shadcn/Radix Dialog. Mais rígido, menos touch-friendly.

**Decisão:** ContextPanel mobile usa `Drawer` (vaul). Sem nova dependência.

### 1.4 Gestures / swipe

- `framer-motion@12.24.7` — já existe, cobre `useDragControls` + `PanInfo` para swipe-back.
- **Não instalar `react-swipeable`**. Dependência redundante; Framer Motion já resolve e já está no bundle.

### 1.5 Colisão de timestamp de migration

Spec propõe `20260422150000_org_onboarding_progress.sql`.

```
$ ls supabase/migrations | grep 20260422
20260422000000_fix_pipe_confirmacao_closer_coalesce.sql
20260422000000_uazapi_foundation.sql
20260422000001_uazapi_secrets_table.sql
20260422120000_conversation_read_state.sql
20260422140000_conversations_ai_state.sql
20260422140001_whatsapp_messages_fts.sql
```

`150000` livre. **Decisão:** usar `20260422150000_org_onboarding_progress.sql` + `20260422150001_seed_demo_data_rpc.sql` (demo RPC numa migration separada — reversível sem tocar schema).

### 1.6 `org_onboarding` preexistente

`20260327000001_create_org_onboarding.sql` cria tabela `org_onboarding` com colunas `status`/`current_step`/`answers` (JSONB). É o **quiz de setup**, trigger `auto_create_org_onboarding` cria uma linha por org nova.

**Decisão dura:** não estender essa tabela. Criar `org_onboarding_progress` separada. Razão: responsabilidades diferentes (quiz = one-shot, checklist = progressivo), ciclo de vida diferente (quiz termina em `completed`, checklist vive enquanto org existir), e violaria SRP. Vale o custo da segunda linha por org.

### 1.7 Hook `useOnboarding` preexistente

`src/hooks/useOnboarding.ts` (40 LOC). É o hook do **quiz**. **Namespace novo:** `src/hooks/onboarding/useOnboardingChecklist.ts` para evitar colisão nominal. `useOnboarding` continua com semântica "quiz".

### 1.8 Mockups v1/v2/v3

```
src/pages/MockupChat.tsx
src/pages/MockupChat 2.tsx
src/pages/MockupChatV2.tsx
src/pages/MockupChatV3.tsx
```

**Gesto de higiene nesta onda:** Storybook vai progressivamente substituir os mockups como fonte visual. **NÃO apagar** mockups aqui (rota `/_mockup/*` ainda usada em demos com CTO). Abrir ticket "sunset mockup pages" como follow-up da 3.3. Também apagar todos os arquivos " 2.tsx" (duplicata por conflito de merge) — ver commit `chore/cleanup-merge-dupes` abaixo.

### 1.9 Demo data

Nenhuma infraestrutura de seed existe (`grep seed_demo supabase/` vazio). Construção do zero via RPC `seed_demo_data(org_id)` + `remove_demo_data(org_id)`. Idempotente, `SECURITY DEFINER`, **restrito a admin da org**.

### 1.10 Páginas dark LOW — inventário

```
src/pages/TVDashboard.tsx          — painel público, dark crítico em demos
src/pages/Auth.tsx                 — login
src/pages/Signup.tsx               — onboarding
src/pages/ResetPassword.tsx        — flow auth
src/pages/CheckoutSuccess.tsx      — pós-pagamento
src/pages/Privacidade.tsx          — LGPD
src/pages/ApiDocs.tsx              — docs públicas
src/pages/master/MasterAuditLogs.tsx
src/pages/master/MasterDashboard.tsx
src/pages/master/MasterFeatures.tsx
src/pages/master/MasterOperations.tsx
src/pages/master/MasterOrganizations.tsx
src/pages/master/MasterPlans.tsx
src/pages/master/MasterUsers.tsx
src/pages/master/WhatsAppMigration.tsx
```

15 páginas. Pattern é mecânico (Onda 3.1 já definiu): trocar `bg-gray-*` → `bg-card`/`bg-muted`, `text-gray-*` → `text-muted-foreground`/`text-foreground`, `border-gray-*` → `border-border`, `shadow-*` → `ring-1 ring-border` onde visual pedir.

### 1.11 Duplicatas de merge no repo

```
src/components/chat/ChatEmptyState 2.tsx
src/components/chat/ChatShellWithContext 2.tsx
src/components/chat/ScrollToBottomFab 2.tsx
src/components/chat/UnreadDivider 2.tsx
src/components/chat/WhatsAppChat 2.tsx
src/components/chat/media/{AudioPlayer,AudioRecorder,ImagePreviewModal,MessageMedia} 2.tsx
src/components/chat/index 2.ts
src/lib/feature-flags 2.ts
src/pages/MockupChat 2.tsx
```

10 arquivos lixo. Vão causar falsos-positivos em Storybook se deixados. Apagar em commit cirúrgico antes do Sprint 3.2.1.

---

## 2. Decomposição em commits

**Estimativa total: 31 commits.** Sequência abaixo é prescritiva — respeitar ordem de dependência.

### Sprint 3.2.0 — Higiene (1 commit, ~0.5h)

**#1** `chore: remove merge dup files from chat + feature-flags`
- Apagar todos os 10 arquivos ` 2.tsx`/` 2.ts` listados em 1.11.
- Verificar que barrel `src/components/chat/index.ts` não referencia nenhum.
- Nada de lógica; pura higiene.

### Sprint 3.2.1 — Storybook (8 commits, ~12h)

**Estratégia:** Storybook 8.6+ (última major estável, suporte nativo a Vite SWC). Stories co-localizadas em `*.stories.tsx` ao lado dos componentes. Visual regression adiado pra 3.3 (Chromatic / Playwright snapshot).

**#2** `chore(storybook): init + config para vite + tailwind`
- `npx storybook@latest init --type react --builder vite --skip-install` (flag `--skip-install` evita conflito com `npm ci` de CI).
- `npm i -D @storybook/react-vite @storybook/addon-essentials @storybook/addon-a11y`.
- `.storybook/main.ts`: framework `@storybook/react-vite`, addons `essentials + a11y`, stories glob `../src/**/*.stories.@(ts|tsx)`.
- `.storybook/preview.tsx`:
  - Import `../src/index.css` (tailwind layers).
  - Decorator global `<ThemeProvider defaultTheme="dark">` (next-themes já instalado).
  - Decorator global `<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>`.
  - Decorator global `<MemoryRouter>` (react-router-dom).
  - Parameters: `backgrounds.default = 'dark'`, `layout = 'padded'`.
- `package.json` scripts: `"storybook": "storybook dev -p 6006"`, `"build-storybook": "storybook build -o dist-storybook"`.
- `.gitignore`: `dist-storybook/` + `storybook-static/`.
- `vite.config.ts` **não muda** (Storybook usa próprio vite config via builder).

**#3** `docs(storybook): stories base — MessageBubble + variants`
- `src/components/chat/bubbles/MessageBubble.stories.tsx` (ver nota — MessageBubble real está em `MessageList.tsx`, ver 2.5.1). Uma story: OutgoingText, IncomingText, Ai, System, Failed, EditMode, DeletedPlaceholder, WithReply, Audio, Image.
- Fixtures em `src/mocks/chat-fixtures.ts` — tipadas com `Tables<"whatsapp_messages">`.

**#4** `docs(storybook): stories ChatShell + density variants`
- `ChatShell.stories.tsx` → Default3Col, Compact, Spacious, ContextCollapsed, SelectedPhoneNull (empty state).
- Usa `args` para `density`/`densityCssVars`; controls expostos pelo Storybook.

**#5** `docs(storybook): stories takeover — TakeoverControls + AITimeline`
- `TakeoverControls.stories.tsx`: AI_ACTIVE, HUMAN_TAKEOVER, SUMMARY_ONLY, PAUSED, ERROR (5 states do FSM; ver `aiStateLabels.ts`).
- `AITimeline.stories.tsx`: Empty, WithMessages, WithMassSend, WithPix, WithRepair, WithSync, Mixed7Types, Loading (usa `mockImplementation` de `useAITimeline` via `parameters.msw`, OU simplesmente prop drilling + `<AITimeline>` aceitando `events` prop em modo story — ver 2.5.2).

**#6** `docs(storybook): stories CommandPalette + groups`
- `CommandPalette.stories.tsx`: Closed, OpenEmpty, OpenWithGroups, SearchActive, NoResults.
- `CommandPaletteProvider` embrulha. Keyboard shortcut simulado via `userEvent.keyboard('{Meta>}k{/Meta}')` em `play()` function.

**#7** `docs(storybook): stories list + composer + misc`
- `ConversationListItem.stories.tsx`: Unread, Online, Archived, Pinned, Muted, WithMentionBadge.
- `ChatComposer.stories.tsx`: Idle, Typing, Recording, WithDraft, WithAttachment, Disabled (takeover OFF).
- `UnreadDivider.stories.tsx`: Default, MultipleUnread.
- `ScrollToBottomFab.stories.tsx`: Visible, WithUnreadCount.
- `ChatEmptyState.stories.tsx`: Default, NoInstance, ErrorState.
- `HighlightedText.stories.tsx`: NoMatch, SingleMatch, MultipleMatches, CaseInsensitive.

**#8** `docs(storybook): stories lead info — LeadFieldGrid + AddCustomFieldPopover`
- `LeadFieldGrid.stories.tsx`: Default, AllStandard, AllCustom, Mixed9Fields, Empty.
- `AddCustomFieldPopover.stories.tsx`: Closed, Open, Submitting, ValidationError.

**#9** `docs(storybook): README + MDX intro page`
- `.storybook/Introduction.mdx`: propósito, como rodar, convenções de fixture, onde parar (não é integration test).
- `README.md` raiz: seção "Storybook" → `npm run storybook` → `http://localhost:6006`.
- **Não adicionar workflow CI de build-storybook nesta onda** — custo ~2min/build sem valor até introduzirmos Chromatic.

### Sprint 3.2.2 — Mobile redesign (7 commits, ~20h)

Ordem crítica: hook → layout → navegação → composer → drawer contextual → gestures → polish.

**#10** `feat(chat): useChatViewport hook + breakpoint 780`
- `src/hooks/chat/useChatViewport.ts`. Retorna `{ isMobile, isCompact, width }`. SSR-safe (useState inicial `undefined`, depois sync em effect), espelhando pattern de `use-mobile.tsx`.
- Zero consumo ainda. Puramente adição.

**#11** `feat(chat): MobileChatLayout stack vertical`
- `src/components/chat/layout/MobileChatLayout.tsx`.
- Contrato idêntico a `ChatShell` (mesmas props: `list`, `view`, `context`, `selectedPhone`, `onBack`). Boundary preservada — consumidor (`ChatShellWithContext`) escolhe qual layout via `useChatViewport`.
- 2-state local: quando `selectedPhone === null` renderiza só `list`; quando `!== null` renderiza só `view` com header back-button.
- `context` vira drawer — ver #13.
- Sem CSS novo global. Apenas Tailwind utilities.

**#12** `feat(chat): wire MobileChatLayout em ChatShellWithContext`
- Em `ChatShellWithContext.tsx`: `const { isMobile } = useChatViewport(); const Shell = isMobile ? MobileChatLayout : ChatShell;` → render `<Shell {...props} />`.
- Fallback é automático. Desktop inalterado.
- Este commit **ativa** mobile para usuários com `VITE_CHAT_ONDA_2B=true`. Outros caem em `WhatsAppChat` legado (intencional até flag virar default).

**#13** `feat(chat): ContextPanel como Drawer vaul no mobile`
- `src/components/chat/context-panel/ContextPanelMobileDrawer.tsx` — wrapper `<Drawer>` que embrulha `<ContextPanel>`.
- Trigger: botão "Ver lead" no `ChatHeader` que **só aparece quando `isMobile`**.
- Estado de abertura controlado pelo `MobileChatLayout` (via prop controlled — `open`/`onOpenChange`).
- Snap points opcionais `[0.5, 0.92]` — arrastar pra meio ou full.

**#14** `feat(chat): composer safe-area-inset-bottom + keyboard handling`
- `ChatComposer.tsx`: em wrapper root, adicionar `style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}` **quando isMobile**.
- `tailwind.config.ts`: extender `spacing` com `safe-bottom: env(safe-area-inset-bottom)` (opcional — se preferir utility pure-CSS via arbitrary variant `pb-[env(safe-area-inset-bottom)]`).
- iOS Safari keyboard handling: usar `visualViewport` API via `useVisualViewportHeight()` (hook novo em `hooks/chat/`). Quando teclado abre, altura cai — composer permanece docked no bottom da visible viewport.

**#15** `feat(chat): swipe-back gesture mobile via framer-motion`
- `MobileChatLayout.tsx`: quando em estado "chat aberto" (`selectedPhone !== null`), embrulhar em `<motion.div drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.2} onDragEnd={handleDragEnd}>`.
- `handleDragEnd(_, info)`: se `info.offset.x > 80 && info.velocity.x > 300` → chamar `onBack()`.
- Animação de entrada/saída: `<AnimatePresence mode="wait">` alternando entre list-view e chat-view com slide horizontal (translateX).
- **Não mexer em desktop** — gesture só monta quando `isMobile`.

**#16** `test(chat): playwright mobile E2E — viewport 375x667`
- `tests/e2e/chat-mobile.spec.ts`:
  - `test.use({ viewport: { width: 375, height: 667 } })`.
  - Case 1: abrir `/chat` → ver lista → clicar conversa → ver chat → tocar back → lista de volta.
  - Case 2: abrir conversa → clicar "Ver lead" → drawer abre → arrastar pra fechar.
- Não adicionar no CI default — rodar em job `e2e-mobile` separado em 3.3.

### Sprint 3.2.3 — Onboarding progressivo (6 commits, ~15h)

**#17** `feat(db): migration org_onboarding_progress + RLS + triggers`

Arquivo: `supabase/migrations/20260422150000_org_onboarding_progress.sql`.

```sql
CREATE TABLE IF NOT EXISTS org_onboarding_progress (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  step_connect_whatsapp   boolean NOT NULL DEFAULT false,
  step_import_lead        boolean NOT NULL DEFAULT false,
  step_configure_copilot  boolean NOT NULL DEFAULT false,
  step_create_workflow    boolean NOT NULL DEFAULT false,
  step_add_member         boolean NOT NULL DEFAULT false,
  step_first_sale         boolean NOT NULL DEFAULT false,
  dismissed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger (reuse existing helper if exists, else inline)
CREATE TRIGGER trg_org_onb_prog_updated_at
  BEFORE UPDATE ON org_onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION update_org_onboarding_updated_at();

ALTER TABLE org_onboarding_progress ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org
CREATE POLICY "onb_prog_select" ON org_onboarding_progress FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM team_members WHERE user_id = auth.uid()));

-- UPDATE: só admin (consistente com org_onboarding)
CREATE POLICY "onb_prog_update" ON org_onboarding_progress FOR UPDATE
  USING (organization_id IN (
    SELECT tm.organization_id FROM team_members tm
    JOIN user_roles ur ON ur.user_id = tm.user_id
    WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- INSERT: via trigger auto, nunca cliente
-- (sem policy INSERT → bloqueado por RLS, apenas DEFINER functions inserem)

-- Auto-create on new org
CREATE OR REPLACE FUNCTION auto_create_org_onb_prog()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO org_onboarding_progress (organization_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_create_org_onb_prog
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION auto_create_org_onb_prog();

-- Backfill para orgs existentes (one-shot, idempotent)
INSERT INTO org_onboarding_progress (organization_id)
SELECT id FROM organizations
ON CONFLICT DO NOTHING;

CREATE INDEX idx_onb_prog_dismissed ON org_onboarding_progress(dismissed_at) WHERE dismissed_at IS NULL;
```

**Triggers auto-complete de step** (mesma migration):

```sql
-- step_connect_whatsapp: quando primeira uazapi_instance fica 'connected'
CREATE OR REPLACE FUNCTION complete_step_connect_whatsapp()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'connected' AND (OLD.status IS DISTINCT FROM 'connected') THEN
    UPDATE org_onboarding_progress
      SET step_connect_whatsapp = true
      WHERE organization_id = NEW.organization_id
        AND step_connect_whatsapp = false;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_step_connect_wa
  AFTER INSERT OR UPDATE OF status ON uazapi_instances
  FOR EACH ROW EXECUTE FUNCTION complete_step_connect_whatsapp();

-- step_import_lead: AFTER INSERT leads WHERE org_onb_prog.step_import_lead = false
-- step_configure_copilot: AFTER INSERT copilot_agents
-- step_create_workflow: AFTER INSERT workflows
-- step_add_member: AFTER INSERT team_members (checar count > 1 pré-insert seria race; simples: sempre setar true, idempotent)
-- step_first_sale: AFTER INSERT OR UPDATE OF stage pipe_propostas WHERE stage IN vendido stages
```

Nome real das tabelas confirmado:
- `uazapi_instances` (existe — `20260422000000_uazapi_foundation.sql`).
- Caso nome divirja, consultar `supabase/functions/_shared/uazapi-client.ts` antes de escrever trigger.

**Dependência:** DBA deve validar nomes de stage "vendido" em `pipe_propostas` antes de escrever trigger final (provavelmente `stage = 'vendido'` ou `stage = 'ganho'` — verificar `pipeline_stages`).

**#18** `feat(onboarding): hook useOnboardingChecklist + useCompleteOnboardingStep`

- `src/hooks/onboarding/useOnboardingChecklist.ts`:
  ```ts
  export function useOnboardingChecklist() {
    const { organizationId } = useOrganization();
    return useQuery({
      queryKey: ["onboarding-checklist", organizationId],
      queryFn: async () => { /* select * from org_onboarding_progress */ },
      enabled: !!organizationId,
      staleTime: 30_000,
    });
  }
  ```
- `useCompleteOnboardingStep`: mutation `update` + `invalidateQueries`. Útil para steps que **não** têm trigger auto (ex.: dismiss, marcar manual).
- `useDismissOnboarding`: mutation seta `dismissed_at = now()`.

**#19** `feat(onboarding): OnboardingChecklist componente + pill expandable`

- `src/components/onboarding/OnboardingChecklist.tsx`:
  - Pill fechado: `"3/6"` + chevron. Clicky → expand.
  - Expandido: Card (240px wide, ~400px tall), 6 items com Check ícone + label + link pra página (ex.: "Conectar WhatsApp" → `/configuracoes?tab=whatsapp`).
  - Progress bar no topo do card.
  - Botão "Dispensar" bottom → `dismissed_at`.
  - Quando 6/6 ou `dismissed_at` → componente retorna `null`.
- `src/components/onboarding/OnboardingChecklist.stories.tsx` (Storybook ganho grátis).
- Pure visual. Nenhuma lógica de integração aqui.

**#20** `feat(onboarding): integra OnboardingChecklist em MainLayout top-right`

- `MainLayout.tsx`: adicionar `<OnboardingChecklist />` como sibling da `<TopNavigation />`, positioned `fixed top-16 right-4 z-40` (abaixo do topnav).
- Esconder em rotas `/auth`, `/signup`, `/_mockup/*`, `/master/*` (via `useLocation` + whitelist).

**#21** `feat(onboarding): usePrimeOnboardingProgress (fallback client-side)`

- Trigger server-side cobre 80 %. Mas e orgs antigas com leads/workflows/etc já criados? Backfill da migration cobre INSERT da linha mas deixa todos steps `false`.
- Hook `usePrimeOnboardingProgress` roda no mount do `OnboardingChecklist`: SELECT counts em paralelo (`leads`, `copilot_agents`, `workflows`, `team_members`, `pipe_propostas WHERE stage='vendido'`), se algum > 0 e step ainda false → `UPDATE` para marcar true.
- Uma vez só por sessão (flag em `sessionStorage`).
- Custo: 5 COUNT queries na primeira visita. Aceitável.

**#22** `test(onboarding): integration test triggers + hook`

- `tests/integration/onboarding-progress.test.ts`:
  - INSERT em `uazapi_instances` com `status='connected'` → `step_connect_whatsapp` vira true.
  - INSERT em `leads` → `step_import_lead` vira true.
  - etc. para cada um dos 6.
- Precisa de `supabase start` local (já documentado).

### Sprint 3.2.4 — Demo data (4 commits, ~8h)

**#23** `feat(db): RPC seed_demo_data + remove_demo_data`

Arquivo: `supabase/migrations/20260422150001_seed_demo_data_rpc.sql`.

```sql
CREATE OR REPLACE FUNCTION seed_demo_data(p_org_id uuid)
RETURNS jsonb SECURITY DEFINER LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_tag_id uuid;
  v_pipeline_id uuid;
  v_agent_id uuid;
  v_workflow_id uuid;
  v_leads_created int := 0;
BEGIN
  -- Guard: caller tem que ser admin da org
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN user_roles ur ON ur.user_id = tm.user_id
    WHERE tm.user_id = v_user_id AND tm.organization_id = p_org_id AND ur.role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- 1. Tag 'demo' (idempotent)
  INSERT INTO tags (organization_id, name, color)
  VALUES (p_org_id, 'demo', '#facc15')
  ON CONFLICT (organization_id, name) DO NOTHING
  RETURNING id INTO v_tag_id;
  IF v_tag_id IS NULL THEN
    SELECT id INTO v_tag_id FROM tags WHERE organization_id = p_org_id AND name = 'demo';
  END IF;

  -- 2. Pipeline custom 'Demo Pipeline' com 3 stages
  -- 3. Copilot agent 'Demo Copilot'
  -- 4. Workflow simples 'Demo Workflow'
  -- 5. 10 leads fake com tag 'demo', distribuídos pelos 3 stages

  -- ... ver implementação detalhada em DBA spec ...

  RETURN jsonb_build_object(
    'leads', v_leads_created,
    'tag_id', v_tag_id,
    'pipeline_id', v_pipeline_id,
    'agent_id', v_agent_id,
    'workflow_id', v_workflow_id
  );
END $$;

CREATE OR REPLACE FUNCTION remove_demo_data(p_org_id uuid)
RETURNS jsonb SECURITY DEFINER LANGUAGE plpgsql AS $$
-- idem guard admin
-- DELETE FROM leads WHERE organization_id = p_org_id AND id IN (SELECT lead_id FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE t.name = 'demo' AND t.organization_id = p_org_id)
-- DELETE FROM workflows WHERE organization_id = p_org_id AND name = 'Demo Workflow'
-- etc.
$$;

REVOKE ALL ON FUNCTION seed_demo_data FROM public;
REVOKE ALL ON FUNCTION remove_demo_data FROM public;
GRANT EXECUTE ON FUNCTION seed_demo_data TO authenticated;
GRANT EXECUTE ON FUNCTION remove_demo_data TO authenticated;
```

**Regras duras:**
- Reversibilidade total: `remove_demo_data` deleta **apenas** entidades com tag `demo` ou com nome fixado (`'Demo Pipeline'`, `'Demo Copilot'`, `'Demo Workflow'`). Nunca deleta sem filtro.
- Watermark visual: Lead name sempre prefixado `[DEMO]`. Impossível confundir com lead real.
- Phone numbers: usar range `+55 11 99999-9001` a `+55 11 99999-9010` (válidos mas fora de uso real; BR 11 99999-9XXX é faixa não-comercial teoricamente).

**#24** `feat(onboarding): botão "Popular com dados de exemplo" no OnboardingChecklist`
- Seção secundária do card: "Testando o app? → Popular com dados de exemplo".
- Chama `supabase.rpc('seed_demo_data', { p_org_id })`, toast sucesso, invalidate queries de leads/pipelines/copilot/workflows.
- Loading state spinner (mutation pendente).

**#25** `feat(onboarding): botão "Remover dados demo"`
- Aparece após seed (check via query de tag demo count > 0).
- Confirmation dialog: "Isso vai deletar os 10 leads demo. Dados reais ficam intactos."
- Chama `supabase.rpc('remove_demo_data', { p_org_id })`.

**#26** `test(demo): integration test seed + remove reversível`
- Tests: caller não-admin → 42501. Admin → RPC retorna contagens. Após seed: 10 leads com tag demo. Após remove: 0 leads demo, restante intacto.

### Sprint 3.2.5 — Dark mode LOW (5 commits, ~6h)

Pattern é mecânico. Agrupar por afinidade (auth flow em 1 commit, master em 1 commit, etc) para PR review fácil.

**#27** `fix(ui): dark mode Auth + Signup + ResetPassword`
- 3 páginas, mesmo pattern: remover `bg-white`/`bg-gray-50`, usar tokens `bg-background`/`bg-card`, inputs `bg-input` já ok, bordas `border-border`, texto `text-foreground`/`text-muted-foreground`.

**#28** `fix(ui): dark mode CheckoutSuccess + Privacidade + ApiDocs`
- 3 páginas estáticas. Idem pattern. ApiDocs pode ter code blocks — usar `bg-muted` + `text-muted-foreground`.

**#29** `fix(ui): dark mode TVDashboard`
- Painel público. Cuidado com contraste (telas de parede). Verificar WCAG AA mínimo nas cards de métrica.

**#30** `fix(ui): dark mode master/* (7 páginas)`
- Grande volume. MasterDashboard, MasterOrganizations, MasterUsers, MasterPlans, MasterFeatures, MasterAuditLogs, MasterOperations, WhatsAppMigration.
- Podem ir num único commit (pattern idêntico entre elas) ou split 2× se diff > 800 LOC.

**#31** `docs: update dark-mode-audit.md → LOW done`
- Marcar páginas diferidas como resolvidas. Atualizar `07 — Changelog/` + `06 — Features/design-system/dark-mode.md` no Obsidian.

---

## 3. Linha do tempo

| Sprint | Commits | Horas | Pode paralelizar com |
|--------|---------|------:|----------------------|
| 3.2.0 Higiene | 1 | 0.5 | — (bloqueante) |
| 3.2.1 Storybook | 8 | 12 | 3.2.5 (ambos são pure-frontend) |
| 3.2.2 Mobile | 7 | 20 | — (depende do Storybook p/ testar stories em viewport pequeno; sequencial) |
| 3.2.3 Onboarding | 6 | 15 | 3.2.2 (domínios disjuntos) |
| 3.2.4 Demo data | 4 | 8 | — (depende de 3.2.3 #17 migration criada; commits 3.2.4 são sequenciais ao 3.2.3) |
| 3.2.5 Dark LOW | 5 | 6 | 3.2.1 (dois frontends independentes) |
| **Total** | **31** | **61.5** | |

**Sequência recomendada ao Conductor:**

1. **Linha A (frontend-heavy):** 3.2.0 → 3.2.1 → 3.2.5 → 3.2.2 (Storybook primeiro porque testar mobile sem ele é ruim).
2. **Linha B (fullstack paralelo):** 3.2.3 → 3.2.4 (começam quando linha A terminar 3.2.1; backend tem migration + triggers + RPCs concentrados).

Tempo de calendário com 1 dev junior + CTO revisando: ~8 dias úteis.
Tempo de calendário com 2 devs paralelo: ~5 dias úteis.

---

## 4. Risco + mitigação por sprint

### 3.2.0 Higiene
- **Risco:** apagar arquivo usado em import obscuro.
- **Mitigação:** `grep -rn "from.*[Xx] 2\"" src/` antes de deletar; build deve passar. Baixo risco (arquivos são dups de merge recente).

### 3.2.1 Storybook
- **Risco A:** conflito de versão Vite 5 + Storybook 8. Vaul 0.9.9 usa peer dep react 18 — ok.
- **Mitigação A:** `npx storybook@latest init --builder vite` oficial. Se quebrar, fallback manual install via `@storybook/react-vite@^8.6`.
- **Risco B:** stories com dependência de Supabase client → quebram sem network.
- **Mitigação B:** **zero chamadas Supabase em stories.** Toda fixture é estática. Para hooks que fazem query, mockar via `args.data` prop ou extrair subcomponente puro de apresentação (ex.: `<AITimeline>` acessa `useAITimeline()` → Storybook usa `<AITimelineView events={fixtures} />` subcomp, ou injeta via React Query `setQueryData`).
- **Risco C:** build-storybook quebra CI pesado.
- **Mitigação C:** não adicionar em CI nesta onda. `npm run storybook` é dev-local-only.

### 3.2.2 Mobile
- **Risco A:** Framer Motion `drag` conflita com scroll vertical do `MessageList`.
- **Mitigação A:** `dragDirectionLock` + `dragConstraints`. Só permite drag horizontal se gesto inicia > 30° horizontal. Testar em device físico iOS Safari (notório p/ touch events).
- **Risco B:** `visualViewport` API incompleta em Firefox Android.
- **Mitigação B:** fallback para `window.innerHeight` + `useEffect` em `resize`. Aceitar degradação graciosa em browsers minoritários (98 % dos usuários CRM estão em Chrome/Safari).
- **Risco C:** `WhatsAppChat.tsx` legado continua sendo default em mobile até flag virar on. Usuário vê experiência nova em desktop + legado em mobile — inconsistente.
- **Mitigação C:** aceitar. Documentar em CHANGELOG: "mobile redesign disponível com `VITE_CHAT_ONDA_2B=true`". Flag vira default-on em 3.3.
- **Risco D:** Drawer vaul drag conflita com scroll do ContextPanel.
- **Mitigação D:** vaul já resolve via `shouldScaleBackground` + snap points. Testar.

### 3.2.3 Onboarding
- **Risco A:** Trigger de step_first_sale dispara em toda atualização de `pipe_propostas`. N operações por lead = N triggers.
- **Mitigação A:** filtro `WHEN (NEW.stage = 'vendido' AND OLD.stage IS DISTINCT FROM 'vendido')` no CREATE TRIGGER. Também `step_first_sale = false` como curto-circuito dentro da function (sai cedo se já true).
- **Risco B:** Backfill em prod com 30 orgs é trivial, mas em 100+ orgs passa a ser lento.
- **Mitigação B:** `INSERT ... ON CONFLICT DO NOTHING` é fast. Não fazer SELECT COUNT por org no backfill — delegar ao hook `usePrimeOnboardingProgress` lado client.
- **Risco C:** Admin dismissou checklist → 1 mês depois novo admin entra → quer ver checklist.
- **Mitigação C:** `dismissed_at` é por-org, não por-user. UI oferece botão "Reabrir checklist" em Settings > Organização (opcional, 3.3).
- **Risco D (Security):** trigger `SECURITY DEFINER` executa com privilégio do owner. Se função tiver search_path mutável → PgSQL injection via schema poisoning.
- **Mitigação D:** `SET search_path = public, pg_catalog` em todas as functions. Obrigatório. Security review deve bloquear merge sem isso.

### 3.2.4 Demo data
- **Risco A:** Seed em prod de cliente real que já tem leads com tag "demo".
- **Mitigação A:** nunca criar tag "demo" — sempre UPSERT (ON CONFLICT). Criar leads sempre novos (não dedupe). Prefixo `[DEMO]` no nome é watermark. `remove_demo_data` só deleta entidades com `name LIKE '[DEMO]%'` OU com tag demo.
- **Risco B:** Ordem de DELETE em `remove_demo_data` viola FK. `pipe_propostas`, `pipe_whatsapp`, `lead_tags`, `conversations`, `conversation_messages` apontam para `leads`.
- **Mitigação B:** ordem explícita: conversation_messages → conversations → lead_tags → pipe_* → leads. Ou usar `ON DELETE CASCADE` nas FKs (já existe em várias). DBA confirma antes de escrever RPC.
- **Risco C:** admin clica "Popular" duas vezes → 20 leads.
- **Mitigação C:** RPC verifica no início `IF EXISTS (SELECT 1 FROM leads JOIN lead_tags ON ... WHERE tag='demo') THEN RETURN {'already_seeded': true};`. Idempotente.

### 3.2.5 Dark LOW
- **Risco A:** Mudança visual em páginas de auth → conversão do signup quebra.
- **Mitigação A:** QA valida manualmente fluxo de signup antes + depois. Screenshot comparison.
- **Risco B:** `master/*` tem forms complexos — risco de regressão funcional em mudança visual.
- **Mitigação B:** revisar cada file individualmente; diff deve ter `bg-*`/`text-*`/`border-*` changes **apenas**. Zero mudança de estrutura JSX. ESLint rule `no-unused-imports` pega tokens órfãos.

---

## 5. Dependências entre commits

```
#1 (higiene)
  ↓
#2 storybook init ──────────┐
  ↓                          │
#3-#8 stories (paralelizáveis entre si, todas dependem de #2)
  ↓
#9 storybook docs

#2 ──┐
      ├─→ #10 useChatViewport (sem depender de Storybook — hook puro; pode rodar antes)
#10 ──┼─→ #11 MobileChatLayout (precisa #10)
#11 ──┼─→ #12 wire em ChatShellWithContext
       ├─→ #13 ContextPanel drawer (precisa #12 pra integrar trigger)
       ├─→ #14 composer safe-area (independente de #13, paralelo)
       ├─→ #15 swipe gestures (precisa #11 montado)
       └─→ #16 E2E mobile (depende #15)

#17 migration ──┐
                 ├─→ #18 hook (precisa tabela + regenerar types.ts)
#18 ────────────┼─→ #19 componente (precisa hook)
#19 ────────────┼─→ #20 integra MainLayout
                 ├─→ #21 prime fallback (paralelo a #19)
                 └─→ #22 test (depende #17+#18)

#17 ──→ #23 RPC seed (reusa schema da #17; mesma migration dir)
#23 ──→ #24 botão popular (precisa RPC)
#24 ──→ #25 botão remover (reusa infra)
#25 ──→ #26 test (todos RPCs prontos)

#27, #28, #29, #30 dark pages — totalmente paralelos entre si e paralelos a qualquer sprint
#31 docs — depende de todos os 27-30
```

**Ponto crítico #17:** migration tem que rodar em dev **antes** de #18 escrever hook. `supabase gen types typescript` após #17 aplicada. Sem isso, hook fica com `as any` e dívida herdada da Onda 2b se repete.

---

## 6. Backwards-compatibility

### Storybook
- Build de produção **não consome** `.storybook/` nem `*.stories.tsx` (glob do Vite config default exclui). Bundle inalterado.
- `npm run build` tempo: inalterado. Storybook só roda quando `npm run storybook`.

### Mobile redesign
- Apenas **monta quando `isMobile` true E `featureFlags.chatOnda2b` true**. Usuário com flag off → `WhatsAppChat` legado continua idêntico.
- Desktop inalterado. `ChatShell.tsx` não muda uma linha.

### Onboarding
- Escondível via `dismissed_at`. Um clique, permanente.
- Orgs com `dismissed_at !== null` → componente retorna `null` → zero impacto visual.
- Orgs novas (post-migration) recebem linha auto; checklist aparece.
- Orgs antigas (pre-migration) recebem linha via backfill SQL; `usePrimeOnboardingProgress` preenche steps já cumpridos no primeiro mount.

### Demo data
- Totalmente reversível via `remove_demo_data`.
- Watermark `[DEMO]` + tag `demo` fazem lead demo impossível de confundir.
- Não altera schema (apenas INSERTs em tabelas existentes).
- Se migration for revertida, dados demo permanecem como leads normais com tag "demo" — **não quebram nada**.

### Dark LOW
- Pure visual. Zero mudança de comportamento, zero mudança de estrutura, zero mudança de API.
- Risco zero em integration/E2E.

---

## 7. Definition of Done (Onda 3.2)

- [ ] `npm run storybook` sobe em localhost:6006, 15+ componentes listados, todos renderizam sem erro.
- [ ] Em viewport 375x667: acessar `/chat` → ver lista full-width → tocar conversa → ver chat com back button → tocar back → voltar lista; em ângulo chat aberto, swipe direita volta; "Ver lead" abre drawer bottom.
- [ ] Org recém-criada: aparece pill `"0/6"` top-right do MainLayout. Conectar WhatsApp → step vira true em <2s (via realtime ou invalidate on focus).
- [ ] Admin clica "Popular com dados demo" → 10 leads `[DEMO]` aparecem em `/leads`. Clica "Remover" → some. Leads reais intactos.
- [ ] `/auth`, `/signup`, `/reset-password`, `/checkout/success`, `/privacidade`, `/api-docs`, `/tv`, `/master/*` — todas em dark mode consistente com Linear-like tokens. Zero `bg-white`/`bg-gray-*` literais.
- [ ] Security: trigger functions todas com `SET search_path`. RPC `seed_demo_data` com guard admin. RLS na tabela nova.
- [ ] Types.ts regenerado após migration #17.
- [ ] `Obsidian/.../07 — Changelog/2026-04-XX.md` atualizado por sprint.
- [ ] `.specs/project/STATE.md` atualizado ao final da onda.

---

## 8. Próximos passos — handoff ao Conductor

Em ordem de despacho recomendada:

1. **Security** → pré-review RLS + triggers + RPC (`seed_demo_data`). Veto-point antes de DBA escrever SQL.
2. **DBA** → migration #17 + RPCs #23. Rodar em dev, regenerar types.
3. **Frontend** → Sprint 3.2.0 + 3.2.1 (paralelo a DBA).
4. **Frontend** → Sprint 3.2.2 (depende de 3.2.1 p/ Storybook disponível nos testes visuais).
5. **Frontend** → Sprint 3.2.3 hooks + componente (após DBA liberar #17).
6. **Frontend** → Sprint 3.2.4 UI (após DBA liberar #23).
7. **UI** → Sprint 3.2.5 dark LOW (paralelo; baixo custo).
8. **QA** → cobertura por sprint, E2E mobile em dispositivo real.
9. **Infra** → garantir que EasyPanel build não quebra com novo `dist-storybook` folder (adicionar .dockerignore).

**Security deve aprovar antes do DBA aplicar a migration em qualquer env, incluindo dev.**
