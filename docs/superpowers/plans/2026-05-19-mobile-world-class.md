# PRD — Mobile World-Class (Torque CRM)

**Status:** ready-for-agent
**Data:** 2026-05-19
**Autor:** Gabriel (CTO) + Claude Code
**Ondas:** 3 (Fundação → Core Views → Polish)

---

## Problem Statement

Vendedores B2B de distribuidoras/fábricas usam o Torque CRM pelo celular entre visitas — respondem WhatsApp, checam pipeline, consultam leads antes de reuniões. Hoje a experiência mobile é fragmentada: navegação presa em hamburger menu, pipeline kanban ilegível em tela pequena, composer de chat quebra com teclado iOS, não há PWA (sem ícone na home, sem push, sem cache offline), e dois sistemas de chat coexistem causando inconsistência. Score mobile atual: 6.5/10. Para um CRM cuja ação #1 é chat via WhatsApp, mobile precisa ser first-class.

## Solution

Transformar as 3 telas core (Chat, Pipeline, Ficha do lead) em experiência mobile world-class via PWA, mantendo desktop inalterado. Referências: Trello (bottom sheet cards), Kommo (list view pipeline, chat-first), RD Station (PWA, bottom nav). Implementação em 3 ondas progressivas para entregar valor incremental.

## User Stories

1. Como vendedor, quero instalar o CRM como app no celular, para acessar com 1 tap sem abrir browser
2. Como vendedor, quero receber push notification quando lead responde no WhatsApp, para não perder oportunidades
3. Como vendedor, quero uma barra de navegação fixa na parte inferior da tela, para acessar Chat/Pipeline/Leads com o polegar
4. Como vendedor, quero ver meu pipeline como lista filtrada por etapa, para encontrar leads rapidamente no celular
5. Como vendedor, quero filtrar etapas do pipeline via chips horizontais no topo, para trocar de etapa com 1 tap
6. Como vendedor, quero ver a ficha do lead como bottom sheet deslizante, para consultar dados sem perder contexto do pipeline
7. Como vendedor, quero tabs na ficha do lead (Info/Histórico/Chat), para navegar entre dados do lead no celular
8. Como vendedor, quero um botão "Abrir conversa" proeminente na ficha do lead, para ir direto ao chat
9. Como vendedor, quero que o teclado do iOS não cubra o campo de mensagem, para digitar sem bugs
10. Como vendedor, quero botões rápidos de áudio, template e anexo acima do composer, para enviar conteúdo sem navegar menus
11. Como vendedor, quero ver toast notification in-app quando um lead responde enquanto estou em outra tela, para não perder mensagens
12. Como vendedor, quero fazer swipe-back no chat mobile para voltar à lista de conversas, para navegar naturalmente
13. Como vendedor, quero que o app funcione offline com dados cacheados, para consultar último estado do lead mesmo sem internet
14. Como vendedor, quero mover lead de etapa via menu de ação no card mobile, para avançar leads no pipeline pelo celular
15. Como vendedor, quero que conversas longas carreguem rápido no celular, para não esperar scroll em históricos grandes
16. Como admin, quero que a experiência desktop permaneça inalterada, para não impactar workflows existentes
17. Como admin, quero que telas de configuração (campanhas, workflows, copilot) fiquem desktop-only, para não comprometer UX mobile com telas complexas
18. Como vendedor, quero que o app mobile tenha visual dark-first consistente, para manter identidade visual do produto

## Implementation Decisions

### Abordagem: PWA (não nativo)

PWA via `vite-plugin-pwa`. Reutiliza 100% do código React. Instalável, push notifications, cache offline. App nativo descartado — time pequeno, codebase separado seria insustentável. Responsive-only descartado — sem push nem instalação, deixa dinheiro na mesa.

### Navegação: Bottom Tab Bar

4 itens fixos: Chat, Pipeline, Leads, Mais. Componente `MobileBottomNav` renderizado apenas quando `useViewport().isMobile`. Hamburger menu eliminado no mobile. Top bar mobile reduzida a logo + avatar. Tab "Mais" abre sheet overlay com itens secundários.

### Hook unificado: useViewport()

Breakpoint único 768px. Substitui `useIsMobile` (768px) e `useChatViewport` (780px) — elimina inconsistência. Retorna `{ isMobile, isTablet, isDesktop, width }`. ResizeObserver-based (já provado no useChatViewport). 4 consumidores migram: sidebar.tsx, LeadDetailDialog.tsx, ChatBubblePanel.tsx, ChatShellWithContext.tsx.

### Pipeline mobile: List View

Componente `PipelineListView` — renderizado condicionalmente quando mobile. Desktop mantém kanban com @dnd-kit inalterado. Chips de etapa como scroll horizontal no topo (estilo Kommo). Cards grandes com nome, empresa, telefone, rating, tempo na etapa. Ação de mover lead via long-press menu ou botão no card (sem drag-and-drop no mobile).

### Ficha do lead: Bottom Sheet 90%

`LeadDetailDialog` já usa Sheet no mobile (ADR-2026-05-17). Melhorar para 90% viewport height. Tabs: Info / Histórico / Chat. CTA principal "Abrir conversa" fixo no bottom. Drag handle no topo para dismiss.

### Chat mobile fixes

1. **Teclado iOS**: `visualViewport` API com `resize` event listener. Composer usa `position: sticky` com bottom calculado pelo viewport delta. Fallback: `env(safe-area-inset-bottom)`.
2. **Quick action bar**: Ícones acima do composer — áudio, template rápido, anexo. Componente novo `ChatQuickActions`.
3. **Toast notification**: Usar Sonner existente. Hook `useIncomingMessageToast` escuta Realtime `channel_messages` INSERT quando usuário está fora da tela de chat. Toast com nome do lead + preview da mensagem + tap para navegar.
4. **Matar chat legado**: Deletar `WhatsAppChat.tsx` (~1122 linhas). Remover feature flag `chatOnda2b`. `ChatShellWithContext` vira único entry point.
5. **Virtualization mobile**: Reativar em `MessageList` e `ConversationList` com overscan reduzido (3 items vs 5 desktop) e `estimateSize` calibrado para touch.

### Service Worker strategy

- Assets estáticos (JS, CSS, imagens): `cache-first`
- API calls Supabase: `network-first` com fallback para cache
- `skipWaiting()` + `clientsClaim()` para updates imediatos
- Prompt "Nova versão disponível" via Sonner toast

### Design system mobile

Regra: diferença de **estilo** → Tailwind classes (`md:`, `lg:`). Diferença de **estrutura/comportamento** → componente separado com render condicional via `useViewport()`.

### Ondas de implementação

**Onda 1 — Fundação (~1 semana)**
- M1: `useViewport()` hook + migração dos 4 consumidores
- M2: PWA setup (manifest + SW + vite-plugin-pwa)
- M3: `MobileBottomNav` componente
- M4: `MainLayout` refactor (bottom nav mobile, top nav simplificado)
- M7 parcial: Fix teclado iOS no composer

**Onda 2 — Core Views (~1-2 semanas)**
- M5: `PipelineListView` + chips de etapa
- M6: `LeadDetailDialog` enhance (sheet 90%, tabs, CTA)
- M7 completo: Quick action bar no composer
- M8: `InAppNotification` (toast mensagens recebidas)

**Onda 3 — Polish (~1 semana)**
- M9: Deletar chat legado, remover feature flag
- M10: Virtualization mobile otimizada
- M2 complemento: Push notifications via SW
- Testes e2e Playwright mobile viewport

## Módulos

| # | Módulo | Tipo | Onda |
|---|---|---|---|
| M1 | `useViewport()` | Hook novo (substitui useIsMobile + useChatViewport) | 1 |
| M2 | PWA setup | Config vite-plugin-pwa + manifest + SW | 1 + 3 |
| M3 | `MobileBottomNav` | Componente novo | 1 |
| M4 | `MainLayout` refactor | Modificação | 1 |
| M5 | `PipelineListView` | Componente novo | 2 |
| M6 | `LeadDetailDialog` enhance | Modificação | 2 |
| M7 | `ChatComposer` fixes | Modificação + componente novo | 1 + 2 |
| M8 | `InAppNotification` | Hook + componente novo | 2 |
| M9 | Chat legado cleanup | Deleção + refactor | 3 |
| M10 | Virtualization mobile | Modificação | 3 |

## Testing Decisions

Testes focam comportamento externo, não implementação interna. Testar o que o usuário vê e faz, não como o código resolve internamente.

**Módulos com testes:**

- **M1 useViewport()**: Unit test — mock `matchMedia`/`ResizeObserver`, verificar retorno correto para diferentes larguras. Padrão similar ao `use-mobile.tsx` existente.
- **M3 MobileBottomNav**: Render test — verifica 4 tabs renderizam, active state muda, navegação funciona. Usar Testing Library.
- **M5 PipelineListView**: Render + interaction test — chips filtram corretamente, cards renderizam dados do lead, ação de mover lead funciona.
- **M7 ChatComposer**: Unit test — visualViewport resize handler calcula offset correto. Visual test — quick actions renderizam e disparam callbacks.
- **M8 InAppNotification**: Unit test — hook dispara toast com dados corretos quando mensagem Realtime chega e usuário está fora do chat.

**Testes e2e (Onda 3):**
- Playwright com viewport mobile (375x812 iPhone, 360x800 Android)
- Fluxos: instalar PWA → bottom nav → abrir pipeline → filtrar etapa → abrir lead → abrir chat → enviar mensagem → receber resposta → toast notification

## Out of Scope

- **App nativo** (React Native / Flutter) — time não comporta codebase separado
- **Telas admin no mobile** — campanhas, workflows, copilot config, analytics ficam desktop-only
- **Offline-first completo** — cache serve como fallback read-only, não há sync bidirecional offline
- **Tablet layout** — foco é celular (< 768px). Tablet usa layout desktop
- **Redesign desktop** — zero mudança na experiência desktop existente
- **Multi-idioma** — interface permanece pt-BR
- **Deep linking** — URLs diretas para leads/conversas ficam para fase futura

## Further Notes

- Feature flag `chatOnda2b` será removida na Onda 3 quando chat legado morrer. Até lá, novo código mobile assume flag=true.
- Bottom nav z-index precisa ser maior que Sonner toasts e menor que modais/sheets.
- `env(safe-area-inset-bottom)` obrigatório no bottom nav e composer para iPhones com notch/dynamic island.
- Manifest theme_color deve usar accent gold existente: `#E8922A`.
- Service worker não deve cachear chamadas Realtime (WebSocket) — só REST.
- Referências visuais: Linear (polish), Kommo (pipeline mobile), Trello (cards/sheets), RD Station (PWA + bottom nav).
