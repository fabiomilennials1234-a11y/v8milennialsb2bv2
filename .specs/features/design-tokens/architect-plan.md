# Architect Plan — Design Tokens (Onda 7)

**Autor:** Architect (agent-architect)
**Data:** 2026-04-23
**Branch:** `feat/design-tokens` (bifurcada de `main`)
**Baseline:** tip `cbf7d56` (main após PR #84)
**Status:** Plano + execução.

---

## 0. Contexto

Main já tem tokens semânticos HSL **parcialmente definidos** em `src/index.css`:
- `--destructive` + foreground (light + dark)
- `--success` + foreground (light + dark)
- `--warning` + foreground (**light só** — sem dark variant)

`tailwind.config.ts` **mapeia** `destructive`, `success`, `warning` em classes Tailwind (`bg-success`, `text-warning`, etc).

**Inferência:** infra de tokens já foi iniciada (provavelmente em onda anterior do chat redesign), mas:
1. Warning sem variant dark — em dark mode cai no fallback CSS (quase igual ao light) → pouca diferenciação visual
2. Sem token `silver` (ranking "2º lugar") — CampanhaAnalytics usa `muted-foreground` como hack
3. Código **não usa** tokens em massa — predomina `bg-green-500`, `bg-red-500`, `bg-yellow-500` hardcoded

**Onda 7 (escopo B):** completar infra + sweep usages de status semântico.

## 1. Mudanças de infra

### 1.1 `src/index.css`

**Light mode** (já tinha success + warning — mantém; adiciona silver):
```css
--silver: 220 9% 55%;          /* neutral silver — 2nd place ranking */
--silver-foreground: 0 0% 100%;
```

**Dark mode** (adiciona warning + silver, corrige gap):
```css
--warning: 38 92% 55%;          /* slightly brighter in dark for contrast */
--warning-foreground: 30 18% 10%;
--silver: 220 9% 70%;           /* brighter in dark */
--silver-foreground: 30 18% 10%;
```

### 1.2 `tailwind.config.ts`

Adiciona `silver` ao objeto `colors.extend`:
```ts
silver: {
  DEFAULT: "hsl(var(--silver))",
  foreground: "hsl(var(--silver-foreground))",
},
```

Após essa mudança: `bg-silver`, `text-silver`, `border-silver`, etc disponíveis.

## 2. Sweep — status semântico

Estratégia: **só substituir quando a cor indica SEMÂNTICA de status.** Cores decorativas (gradientes, badges de rank, ícones decorativos) ficam.

### 2.1 `bg-green-500` → `bg-success` (status "Ativo/Success")

Contextos: Badge "Ativo" em team_members, success status em workflow executions, success dots em connection status.

Ex:
```diff
- <Badge className="bg-green-500">Ativo</Badge>
+ <Badge className="bg-success">Ativo</Badge>
```

### 2.2 `bg-green-500/10 text-green-500 border-green-500/20` → `bg-success/10 text-success border-success/20`

Tinted success badges (MasterOperations status, runtime logs).

### 2.3 `bg-red-500`, `bg-red-500/10 text-red-*` → `bg-destructive`, `bg-destructive/10 text-destructive`

Contextos: erros, falhas, "Perdido" status.

### 2.4 `bg-yellow-500`, `text-yellow-500/600` → `bg-warning`, `text-warning`

Contextos: pending, alerta, "Em progresso".

### 2.5 Trophy rank 2 → silver

`CampanhaAnalytics.tsx:131,138` — atualmente `text-muted-foreground` / `from-muted-foreground/20 via-muted-foreground/10` (hack Onda 6.1). Trocar para `text-silver` / `from-silver/20 via-silver/10 border-silver/30`.

## 3. Escopo — arquivos alvo

Inventário por grep:

| Padrão | Match estimado |
|--------|----------------|
| `bg-green-500\b` (sólido status) | ~15 |
| `bg-green-500/` (tinted) | ~10 |
| `text-green-500\b` / `text-green-600` | ~20 |
| `bg-red-500\b` | ~8 |
| `bg-red-500/` / `text-red-500` | ~25 |
| `bg-yellow-500` / `text-yellow-500` | ~15 |
| Trophy rank 2 | 2 |

**Estratégia:** sweep por arquivo, validando contexto semântico antes de substituir.

## 4. Decisões

### D1 — `destructive` > `danger`

Não criar alias `--danger` para `--destructive`. Shadcn/ui usa `destructive` como convenção, código já tem. Aliasar seria ruído (2 nomes mesma cor). Designers pensam "danger" mas código fala "destructive" — aceitável.

### D2 — Warning dark variant: 38 92% 55% (5pp brighter)

Warning light = `38 92% 50%`. Dark backgrounds absorvem warmth, texto warning precisa +5pp lightness pra contraste WCAG AA. Pattern idêntico ao `success` (fica igual light/dark porque green já é brighter-ready).

### D3 — Silver HSL baseado em neutral shadcn

`--silver: 220 9% 55%` = tom neutral (slate-400 equivalent). Distingue de:
- `muted-foreground` (mais saturado pro marrom do tema)
- `primary` (gold torque)
- `success` (green)
- Rank 1 `yellow-400` (gold-ish)
- Rank 3 `orange-400`

Rank 2 silver fica genuinamente "prata" na hierarquia.

### D4 — `bg-green-500` em ícones decorativos fica

`MasterDashboard.tsx` tem dots coloridos:
```tsx
<div className="w-3 h-3 rounded-full bg-green-500" />  // Active orgs
<div className="w-3 h-3 rounded-full bg-blue-500" />   // Trial
<div className="w-3 h-3 rounded-full bg-yellow-500" /> // Suspended
<div className="w-3 h-3 rounded-full bg-red-500" />    // Overdue
```

Esses são **data-driven colors** — dots distinguem categorias. Manter Tailwind literal evita confusão (dots não são status de UM item, são cores de categoria). Se trocar `bg-green-500` → `bg-success` em 1 dot mas deixar outros, inconsistente.

Regra: **se o conjunto todo usa cores semânticas (green, red, yellow, blue), mantém literal.** Se só um status existe (`bg-green-500` isolado), semantic token.

### D5 — Gradient `from-green-500/20` fica literal

Gradientes decorativos são visuais, não semânticos. `from-success/20` funcionaria mas não agrega clareza.

## 5. Out of scope

- ADR tokens `--info` (blue) e `--accent-extra`
- Sweep de cores decorativas (dots, gradientes, ícones trophy/crown)
- Migração para ChatShellWithContext (develop → main) — Onda 3.3
- Chart colors HSL refactor

## 6. Validação

- `npx tsc --noEmit` clean
- Build test: `npm run build` sem erros
- QA visual: dark mode + light mode em:
  - Pipes (badges origin, status)
  - Master Operations (status badges)
  - Workflow executions (success/failed/running)
  - CampanhaAnalytics (Trophy rank 2 prata)
