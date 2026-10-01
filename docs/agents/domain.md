# Domain Docs

Como as skills de engenharia devem consumir a documentação de domínio deste repo ao explorar o codebase.

Layout: **single-context** — um `CONTEXT.md` + `docs/adr/` na raiz. Não é monorepo (sem `pnpm-workspace.yaml`, sem `packages/`, sem `workspaces` no `package.json`). O modular monolith mora todo em `src/modules/<bc>/` — 14 bounded contexts dentro de um único contexto de documentação.

## Before exploring, read these

- **`CONTEXT.md`** na raiz — glossário de domínio + linguagem ubíqua.
- **`docs/adr/`** — ADRs numeradas. Leia as que tocam a área em que você vai mexer.
- **Sub-`CLAUDE.md`** do bounded context em questão: `src/modules/<bc>/CLAUDE.md`, `supabase/functions/_shared/CLAUDE.md`, `supabase/functions/agent-message/CLAUDE.md`, `supabase/functions/whatsapp-webhook/CLAUDE.md`, `supabase/migrations/CLAUDE.md`. São contexto JIT — leia o do módulo que você toca, não todos.
- **Vault Obsidian** — `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`, entrada em `00 — INDEX.md`. Alinhado a Diátaxis. Consultar **antes** de agir em features: `02 — Arquitetura/`, `03 — Reference/` (schema, RLS, edge functions, cron, env vars, RPCs), `04 — Decisões/` (ADRs), `06 — Features/` (regras de negócio por domínio).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md                     ← glossário / linguagem ubíqua
├── llms.txt                       ← índice curado pra LLMs
├── docs/
│   ├── adr/                       ← decisões imutáveis, numeração sequencial
│   └── agents/                    ← este diretório (config das skills)
├── src/modules/<bc>/CLAUDE.md     ← contexto por bounded context
└── Obsidian/Segundo Cerebro/…     ← vault Diátaxis (source of truth expandido)
```

## ADRs

Numeração sequencial de 4 dígitos, kebab-case: `docs/adr/NNNN-<slug>.md`. Próximo número = **o maior existente + 1** (`ls docs/adr`). Há buracos e repetições antigas na sequência — não reaproveite número vago.

Decisão arquitetural nova também deve aparecer no vault em `04 — Decisões/`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

Termos com significado travado neste projeto — não invente sinônimo:

- **Role é `team_members.role`, enum `app_role` = `admin | sdr | closer | agency | bdr | cliente | member`.** Em uso: `admin` e `member`. É **`member`, nunca `membro`** — `membro` estoura `22P02` no INSERT. **`master` não é role**: é a camada de cima (`is_master_user()`, `useMasterAuth()`). SDR/Closer existem no enum mas o produto os trata como rótulo de UI. Guarda: `tests/unit/role-vocabulary.test.ts`.
- **Lead**, **funil** (`pipelines` + `pipeline_stages` + `pipeline_entries`, ADR-0034; `pipe_*` são views de compat em demolição), **stage** (comportamento por `stage_role`), **org** (`organization_id`), **team member**, **copilot agent**, **workflow**, **campanha**, **carteira**.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0017 (drop Sentry for in-house runtime logs) — but worth reopening because…_

## Regra do vault

Deletar arquivo do vault Obsidian exige a flag `[vault-delete-ok]` na mensagem de commit. O vault tem 8 camadas de proteção contra perda em merge — ver `CONTRIBUTING.md`.
