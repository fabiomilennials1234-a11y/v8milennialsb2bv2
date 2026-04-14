# Project State

**Last updated:** 2026-04-13

## Decisions

### D001: SDD adopted as mandatory workflow (2026-04-01)
All work on this project must follow the Spec-Driven Development workflow (`tlc-spec-driven` skill). No exceptions. Auto-sized by scope (Small/Medium/Large/Complex).

### D002: Brownfield mapping completed (2026-04-01)
7 codebase documents created in `.specs/codebase/`: STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS. These serve as the foundation for all future feature work.

## Blockers

None currently.

## Lessons

### L001: Sub-agents need Write permissions
When dispatching sub-agents for brownfield mapping, they couldn't write files due to permission restrictions. The orchestrating agent must handle file writes itself after receiving research results.

## Todos

- [ ] Address CONCERN-S1 (Critical): Remove `VITE_SUPABASE_SERVICE_ROLE_KEY` from `.env.development`
- [ ] Address CONCERN-S3 (Critical): Audit edge functions for `verify_jwt` settings
- [ ] Address CONCERN-T1 (Critical): Increase test coverage from 3% -- prioritize auth, payments, RLS
- [ ] Address CONCERN-A1 (High): Decompose 30+ files over 800 lines

### D003: S1+S3 deferred, T2+T5 prioritized (2026-04-01)
CTO decided to defer security fixes (S1: service role key exposure, S3: verify_jwt audit) and focus first on building the testing safety net (T2: auth/permissions tests, T5: RLS policy tests). Rationale: tests prevent future regressions; fixes without tests just create new untested code.

### D004: org-quota-enforcement spec/design/tasks complete (2026-04-09)
Feature fully specified in `.specs/features/org-quota-enforcement/`. 12 tasks across 5 phases. CTO decisions: delta model (plan_base + addons + admin_adj), soft enforcement (block new, keep existing), scope = WhatsApp instances + users + copilot agents.

### D005: org-quota-enforcement implemented (2026-04-09)
All 12 tasks executed. 9 SQL migrations (20260910000000–20260910000008), 1 new hook (useOrgQuotas), 1 new component (QuotaManagementPanel), 3 files updated (WhatsAppSettings, Copilot, BillingOverrideModal), 1 edge function updated (checkout-provision-org). Build passes. Pending: integration tests against live DB, E2E validation.

### D006: Agent Team System created (2026-04-13)
9 specialized AI agents operating autonomously via CLAUDE.md protocol. Agents: Conductor (orchestrator), Architect, Backend, Frontend, DBA, QA, Infra, Automation (new), AI (new). Every task auto-routes through Conductor → agent selection → SDD → execution → Obsidian update. Skills in `.claude/skills/agent-*/SKILL.md`. Obsidian notes in `Agentes/`. Protocol simplified to 3 phases (Triage → Execute → Document). Eliminated fragile skill path verification (Fase 3) and redundant Fixes/ documentation (Fase 5). All agents integrate `tlc-spec-driven` for mandatory SDD compliance.

### D007: Coverage 70% project started (2026-04-13)
Full system coverage project. Baseline: 9.33% (1,058/11,331 lines). Target: 70%+. Sprint 0 complete: 706 tests, 43 test files. Created spec in `.specs/features/coverage-70/`. Infrastructure: supabase-mock, deno-mock, setup-prod (integration against prod with isolated test org `__integration_test_org__`). Coverage scope expanded to include hooks + contexts. 4 sprints planned.

### D008: Copilot wizard is dead code (2026-04-13)
CopilotWizard, step-tips, prompt-quality, followupSchedule are deprecated. Current flow uses CopilotPlayground (single-pane editor). Templates still active as presets. Obsidian Copilot.md updated with dead code callout. Tests for dead code kept but low priority.

## Deferred Ideas

- S1+S3 security fixes -- deferred until T2+T5 test suite is in place

## Preferences

- CTO prefers world-class engineering standards -- no mediocre work shipped
- Dark-first design, editorial typography, cinematic UI sensibility
- Portuguese (BR) for user-facing content and business logic comments
- English for technical documentation and code
