---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/agent-team-system/spec.md
---

# Agent Team System

**Scope:** Large
**Status:** Approved

## Summary

Create a team of 10 specialized AI agents that operate autonomously on every task. No manual invocation - the Conductor protocol in CLAUDE.md auto-routes every request through the right agent(s), ensures SDD compliance, and keeps Obsidian documentation updated.

## Requirements

### REQ-1: Autonomous operation
Every task, change, or request automatically goes through the agent team. The user never invokes agents manually. CLAUDE.md embeds the Conductor routing logic so it fires on every interaction.

### REQ-2: 10 specialized agents as skills
Each agent is a Claude Code skill with full persona, domain expertise, approach, rules, and context loading instructions. Agents: Conductor, Architect, Backend, Frontend, DBA, QA, Infra, Automation, AI.

### REQ-3: SDD integration
All agents integrate `tlc-spec-driven` for specification and documentation. Non-trivial work is specced before execution. Quick fixes use quick mode.

### REQ-4: Obsidian sync
After execution, agents update relevant Obsidian notes: feature docs in `06 - Features/`, changelog in `07 - Changelog/`, backlog in `08 - Backlog/`.

### REQ-5: Correct paths and references
All paths reference macOS filesystem (`/Users/gabrielaureliogipp/`). Obsidian context references the real vault structure (`02 - Arquitetura/`, `04 - Decisoes/`, etc.), not the non-existent `Projetos/` paths.

### REQ-6: Simplified protocol
- No Fase 3 (skill path verification) - skills are invoked and fail gracefully
- No Fixes/ documentation phase - changelog and SDD handle documentation
- 3 phases: Triage → Execute → Document

## Decisions

- Skills go in project `.claude/skills/` (project-specific, not global)
- CLAUDE.md gets a "Team de Agentes" section with Conductor protocol
- Obsidian agent notes are updated to match the new skills
- Protocolo.md is simplified to 3 phases


## Links relacionados

- [[MOC - Arquitetura]]

- [[00 - INDEX]]
- [[Visao Geral]]
