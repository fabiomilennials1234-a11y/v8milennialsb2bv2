# Tasks — Design Tokens (Onda 7 B)

**Branch:** `feat/design-tokens` (bifurcada de `main`)

## Infra

- [x] `src/index.css` — adicionar `--silver` + `--silver-foreground` (light + dark)
- [x] `src/index.css` — adicionar `--warning` + `--warning-foreground` no bloco dark (gap corrigido)
- [x] `tailwind.config.ts` — mapear `silver.DEFAULT` + `silver.foreground`
- [x] ADR doc `.specs/features/design-tokens/architect-plan.md`

## Sweep — status semântico

- [x] MasterOrganizations: `bg-green-500 Ativo` → `bg-success`, `bg-yellow-500 Suspenso` → `bg-warning`
- [x] MasterFeatures: badge "Ativo" → `bg-success`
- [x] MasterUsers: badge "Ativo" → `bg-success`
- [x] Copilot: badge "Ativo" → `bg-success`
- [x] CompetitionRankingListV2: progress >= 100 → success, progress < 50 → destructive
- [x] CopilotMetrics: score thresholds (green/yellow/red) → success/warning/destructive
- [x] TeamResponseTimes: response time thresholds → success/warning/destructive
- [x] SpeedConversionCorrelation: bucket colors → success + warning (destructive já)
- [x] MasterOperations: STATUS_BADGE + JOB_STATUS_BADGE (success, retrying, dead_letter) → tokens semânticos
- [x] MasterOperations: error cards (border-red-500 bg-red-500/5) → destructive
- [x] MasterOperations: churn/dead letter rows → destructive
- [x] CampanhaAnalytics: Trophy rank 2 + gradient → `text-silver` + `from-silver/20`

## Manter literal (decorative / category)

- Pipe origin badges (whatsapp green, google_ads red, tiktok gray, etc) — data categories
- MasterDashboard status dots (array verde/azul/amarelo/vermelho) — data categories
- TopPerformers position array (gold/silver/bronze) — rank gold literal
- ActionPanel / TVCompetitionBlock pulse dots — animated decorative
- LeadCard "Quente" red — brand metaphor (warmth), not semantic error

## Validação

- [x] `npx tsc --noEmit` clean
- [x] `npm run build` passed (42s)
- [ ] QA visual manual: dark mode em Master/{Operations,Organizations,Users,Features} + Copilot + CampanhaAnalytics + performance views

## Out of scope

- ADR tokens `--info` (blue), `--extra-accent` — Onda 7.1+
- Sweep dots decorativos — não é semântico
- Chart colors refactor — Onda 8+
