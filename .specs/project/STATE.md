# Project State

**Last updated:** 2026-04-01

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

## Deferred Ideas

- S1+S3 security fixes -- deferred until T2+T5 test suite is in place

## Preferences

- CTO prefers world-class engineering standards -- no mediocre work shipped
- Dark-first design, editorial typography, cinematic UI sensibility
- Portuguese (BR) for user-facing content and business logic comments
- English for technical documentation and code
