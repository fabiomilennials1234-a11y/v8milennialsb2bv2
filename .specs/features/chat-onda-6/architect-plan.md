# Architect Plan — Chat Onda 6 Final (Dark LOW pages closure)

**Autor:** Architect (agent-architect)
**Data:** 2026-04-23
**Branch:** `feat/chat-onda-6-final` (não mergear direto em main — PR manual)
**Baseline:** tip `2ff302e` — Onda 6 parcial (Dark LOW TVDashboard + Auth + sweep) merged.
**Dependências upstream:**
- `.specs/features/chat-onda-3-2/architect-plan.md` (Seção 1.10 — inventário Dark LOW 15 páginas)
**Status:** Execução concluída nas pages. Components diferidos para Onda 6.1.

---

## 0. Veredicto

Onda 6 final fecha o track **Dark LOW pages** do redesign. Não é feature nova — é auditoria final + normalização dos últimos resíduos de cor hardcoded em `src/pages/`.

Grep sistemático revelou realidade diferente do audit inicial (Onda 3.2 §1.10):
- 8 páginas "pendentes" já estavam clean de `gray-*`/`slate-*`/`zinc-*`
- Página **Privacidade** (LGPD pública, crítica) estava **light-only** — 14 ocorrências gray-*
- Master pages já mergeadas tinham 4 badges fallback com `bg-gray-500` residual
- AutomacoesExecucoes, PipeWhatsapp, CampanhaDetail tinham resíduos táticos em status badges

Após execução: **`src/pages/` está 100% limpo de `gray-*`.**

**Fora de escopo:** 22 ocorrências em 14 componentes (`src/components/**`). Reagendado para **Onda 6.1**.

## 1. Mudanças aplicadas

### 1.1 Master pages (badges fallback)

| Arquivo | Linha | Antes | Depois |
|---------|-------|-------|--------|
| `src/pages/master/MasterFeatures.tsx` | 171 | `bg-gray-500` | `bg-muted text-muted-foreground` |
| `src/pages/master/MasterAuditLogs.tsx` | 62 | `bg-gray-500` | `bg-muted text-muted-foreground` |
| `src/pages/master/MasterOperations.tsx` | 162 | `bg-gray-500/10 text-gray-500 border-gray-500/20` | `bg-muted text-muted-foreground border-border` |
| `src/pages/master/MasterOperations.tsx` | 772 | idem acima | idem acima |

### 1.2 Privacidade (full dark-ification)

Página pública LGPD — OAuth Google verifier. 14 ocorrências trocadas:
- `bg-white` → `bg-background`
- `text-gray-900` → `text-foreground` (6x)
- `text-gray-700` → `text-foreground/80`
- `text-gray-500` → `text-muted-foreground`
- `text-gray-400` → `text-muted-foreground`
- `border-gray-200` → `border-border`
- `text-blue-600` → `text-primary` (2x, links)

### 1.3 Pages com resíduos táticos

| Arquivo | Ocorrência | Solução |
|---------|-----------|---------|
| `src/pages/AutomacoesExecucoes.tsx:50,341` | `text-gray-400` em status "skipped" | `text-muted-foreground` |
| `src/pages/PipeWhatsapp.tsx:58` | `bg-gray-900` (TikTok badge) | `bg-foreground text-background` (brand-compliant: preto light/branco dark, TikTok guidelines aceitam ambos) |
| `src/pages/PipeWhatsapp.tsx:67` | `bg-gray-500` (origin "Outros" fallback) | `bg-muted text-muted-foreground` |
| `src/pages/CampanhaDetail.tsx:34` | `bg-gray-100 text-gray-700 dark:bg-muted dark:text-muted-foreground` (manual campaign type) | `bg-muted text-muted-foreground` (semantic puro, sem dark: variant) |

## 2. Decisões

### D1 — Cores semânticas diretas (green/red/blue) ficam

Status colors tipo `bg-green-500`, `text-red-500` em badges/ícones **não** foram tocados. Tailwind solid colors (`green-500`, `red-500`) têm o mesmo hue em light e dark — ambos legíveis. Normalizar para tokens semânticos abstratos (`--success`, `--danger`) puxaria escopo de design system, virando ADR separado.

### D2 — TikTok brand color via `bg-foreground`

TikTok brand guidelines permitem logo em preto OU branco. `bg-foreground text-background` garante:
- Light mode: fundo preto + texto branco (brand compliant)
- Dark mode: fundo branco + texto preto (brand compliant, legível)

### D3 — CampanhaDetail manual badge: dropped `dark:` variant

Padrão anterior usava `bg-gray-100 dark:bg-muted` (classes diferentes por modo). Semantic tokens (`bg-muted`) já invertem automaticamente — `dark:` variant era redundante e confuso. Simplificado.

### D4 — Onda 6.1 (components) diferida

14 componentes com 22 ocorrências residuais. Escopo suficiente pra onda própria:
- `src/types/workflow.ts`
- `src/components/kanban/*` (3 arquivos)
- `src/components/chat/{WhatsAppChat,ConversationNotes}.tsx`
- `src/components/automacoes/{WorkflowToolbar,nodes/EndNode}.tsx`
- `src/components/campanhas/*` (5 arquivos)
- `src/components/confirmacao/ConfirmacaoCard.tsx`
- `src/components/ui/sidebar-demo.tsx`

`WhatsAppChat.tsx` é parte de Onda 3.3 (delete legacy — fix + delete = waste). Outros 13 arquivos são Onda 6.1.

## 3. Validação

- `grep "(bg|text|border|ring|shadow|hover:|dark:|divide|placeholder|via|from|to)-gray-[0-9]+" src/pages/**` → **0 matches** ✓
- `npx eslint` nos 7 arquivos alterados: zero novos erros (erros preexistentes de `@typescript-eslint/no-explicit-any` intocados) ✓
- TSC clean (pendente validação final)
- QA visual: pendente (smoke test manual das páginas alteradas em dark)

## 4. Escopo fora

- **Onda 6.1**: 13 componentes em `src/components/**` (excluindo `WhatsAppChat.tsx` que vai pra Onda 3.3)
- **Onda 3.3**: delete `WhatsAppChat.tsx` legacy + flag `chatOnda2b` default-on + rate limit server-side
- **ADR futuro**: tokens semânticos `--success`/`--warning`/`--danger` HSL (Onda 7+)

## 5. Riscos

- `bg-muted` em badges coloridas (vs `bg-gray-500` sólido) perde contraste visível. Smoke test em QA deve validar legibilidade.
- `bg-foreground text-background` para TikTok muda visual brand em dark mode (fundo branco). Se stakeholder preferir preto fixo, reverter para `bg-black dark:bg-white text-white dark:text-black` explícito.
- Privacidade agora respeita theme. Se rota `/privacidade` era sempre servida em light (OAuth verifier request), stakeholder Google pode estranhar tema dark. Rota é pública, renderiza theme global — se usuário está logado em dark, vê dark. Aceitável por ser conteúdo institucional genérico.
