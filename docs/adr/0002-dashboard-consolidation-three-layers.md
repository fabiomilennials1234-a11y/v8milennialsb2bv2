# ADR-0002: Dashboard Consolidation into Three-Layer Framework

## Status

Accepted

## Date

2026-05-28

## Context

Torque CRM had 6 separate dashboard surfaces (Dashboard with 4 tabs, DashboardOutbound, CopilotMetrics, Performance, Upsell) and 50+ metric components spread across them. Users — especially org owners from B2B industrial companies — had no clear entry point and no hierarchy guiding them to the right metrics for their role.

The system had comprehensive metric coverage (revenue, funnel, rankings, unit economics, UTM, copilot, portfolio) but the UX fragmented it across too many entry points.

## Decision

Consolidate into 3 role-based tabs within the main Dashboard page:

1. **"Resultado"** (Estratégica) — admin/master only. North Stars, funnel health, efficiency, alerts.
2. **"Time"** (Tática) — admin/master only. Team performance, detailed funnel, diagnostics, copilot.
3. **"Meus Números"** (Operacional) — all roles, default for membro. Personal metrics, pending actions, evolution.

Absorbed pages: DashboardOutbound → "Meus Números", CopilotMetrics → "Time", Performance → "Time", Inteligência → sub-section of "Resultado", Analytics (master) → distributed.

TV Dashboard excluded from consolidation (separate use case: wall-mounted display).
Carteira/Upsell excluded (separate domain).

## Alternatives Considered

**Keep pages separate, reorganize content.** Less breaking change but doesn't solve the fragmentation problem — users still need to know which URL to visit.

**Single scrollable dashboard with sections.** Information overload. No role-based filtering without tabs.

## Consequences

- One entry point for all metric consumption (except TV and Carteira)
- Role-based visibility reduces noise for individual contributors
- Old routes must redirect to new tabs to preserve bookmarks
- ~50 components need repositioning (not rewriting)
- 5 new metrics require new RPCs: pipeline coverage, stale leads, pending leads, win streak, goal attainment exposure
