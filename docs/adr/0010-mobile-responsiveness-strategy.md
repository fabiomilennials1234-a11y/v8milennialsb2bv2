# Mobile responsiveness strategy — hybrid responsive + dedicated views

**Status:** accepted (2026-06-18)

## Context

O CRM hoje é desktop-only na prática. No viewport mobile (360–390px) está sistemicamente quebrado, confirmado por auditoria estática e pelo CTO: scroll lateral (estoura tela), nav inutilizável, kanban esmagado, modais cortados, Dashboard/Comando ilegíveis.

A fundação mobile **já existe parcial**: `useViewport` (breakpoint único 768px), `MainLayout` ciente de `isMobile` (`pb-16` p/ bottom-nav), `MobileBottomNav`, e o Chat 100% portado (`MobileChatLayout`, `MobileChatContext`, `Mobile*` em `communication/`). O que falta: conteúdo das páginas responsivo + 2 switches de layout (nav, kanban).

Auditoria estática achou os culpados: larguras fixas em px espalhadas (`w-[200px]`…`w-[600px]`, `min-w-[200px]`), ~30 componentes com `grid-cols-3+` sem variante responsiva, `TopNavigation` densa (987 linhas) renderizada inteira no mobile, kanban sempre em board horizontal apesar de já existir `PipelineListView` (chips de stage + lista vertical) não-ligado ao mobile.

ICP = vendedor B2B em campo. Uso mobile real: responder WhatsApp, checar lead, mexer no funil, ver agenda. Builders/analytics/settings pesados continuam desktop-first.

## Decisões

1. **Estratégia híbrida, não views dedicadas por página.** Fixes de fundação globais matam ~80% do estouro de uma vez (overflow-guard, grids→responsivo, larguras fixas→fluidas, modais→bottom-sheet). Views/layout dedicados **só** onde responsivo não basta: kanban e Dashboard/Comando. Rejeitado: componentes `Mobile*` por superfície (como o Chat fez) — duplicação e custo só justificáveis se mobile virasse plataforma primeira-classe; não é o caso. Rejeitado: só varredura responsiva — deixaria kanban/dashboard medianos, abaixo da barra.

2. **Breakpoint único 768px via `useViewport`.** Mantém o hook existente. `< 768` = mobile (telefone), `>= 768` = layout desktop (tablet herda desktop). Sem tier de tablet dedicado. Rejeitado: múltiplos breakpoints — complexidade sem ganho pro ICP.

3. **Nav mobile: top-bar slim + bottom-nav + drawer "Mais".** `TopNavigation` densa esconde no mobile (hoje só some em rota de chat). No lugar: top-bar slim (logo/org-switcher + busca + alertas + avatar) e `MobileBottomNav` com 5 primais do vendedor — **Chat, Funis, Leads, Agenda, +Mais**. "Mais" abre drawer full-screen com TODOS os ~16 destinos agrupados. Comando/Dashboard saem dos primais (vão pro "Mais"). Rejeitado: só hamburger (polegar não alcança topo em uso de campo); só bottom-nav (perde org-switcher/alertas/busca).

4. **Kanban força lista no mobile.** `isMobile` → sempre `PipelineListView` (chips de stage com scroll horizontal + cards verticais + mover-pra-stage via ação). Zero drag-drop em touch. O toggle board/lista fica desktop-only. Rejeitado: melhorar drag touch no board — colunas espremidas e drag em touch é frustrante.

5. **Modais viram bottom-sheet no mobile.** Wrapper responsivo: `Dialog` (Radix) no desktop, `Drawer` (vaul, já instalado) bottom-sheet no mobile. Resolve modal-maior-que-tela / botão-salvar-fora-de-alcance / teclado-cobre-input. Aplicado primeiro nos modais de alto tráfego (lead detail, criar lead, quick blast).

6. **Dashboard/Comando empilham em coluna única.** Charts e KPI cards colapsam pra 1 coluna; nada de grid multi-coluna espremido.

7. **Convenções enforçáveis daqui pra frente:** (a) proibido largura fixa em px que exceda ~320px sem variante responsiva; (b) todo `grid-cols-N` (N≥2) precisa de base `grid-cols-1` + breakpoint; (c) todo modal novo usa o wrapper responsivo, não `Dialog` cru; (d) board/tabela larga precisa de fallback mobile (lista/cards).

8. **Rollout em fatias mobile-only, shippáveis sozinhas** (não tocam desktop → risco baixo): 1) Fundação (top-bar + nav + overflow-guard global), 2) Kanban lista, 3) Modais bottom-sheet, 4) Varredura grids/larguras (core primeiro), 5) Dashboard/Comando. Cada fatia validada com Playwright vivo (login org Milennials, viewport 390px, screenshots antes/depois).

## Consequências

- **Risco desktop baixo:** mudanças guardadas por `isMobile`/breakpoints `<768`; desktop intocado. Regressão possível em tablet (<768 raro, mas herda desktop, ok; faixa 768–1024 pode ficar apertada — fora de escopo agora).
- **Dívida de convenção retroativa:** os ~30 grids e larguras fixas existentes não somem na fatia 1; saem na fatia 4 (core primeiro), restante longtail.
- **Drawer wrapper vira primitivo novo** em `components/ui` — todo modal deve migrar gradualmente; modais antigos com `Dialog` cru ficam como dívida até tocados.
- **`PipelineListView` ganha segundo dono (mobile)** além do toggle desktop — mudanças nele afetam ambos.
- **Validação depende de auth numa org real** — Playwright precisa de credenciais de teste (Milennials) ou login manual via `!` no harness.
- **CONTEXT.md inalterado:** mobile é implementação, não introduz termo de domínio.
