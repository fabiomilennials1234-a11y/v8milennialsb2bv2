# Torque MCP — S2 Mutating Pack (Recovery) — Design

**Data:** 2026-06-22 · **Feature:** torque-mcp (continuação) · **ADR base:** `docs/adr/0011-torque-mcp-internal-ops-server.md`

## Contexto

S1 entregou 6 read tools (live em dev+prod, RLS-herdado, anti-bypass). A espinha já tem `runMutation` (dry-run/confirm/audit), `redact` (PII) e `registry` (gating por `ALLOW_MUTATIONS`) — **prontos e testados, mas sem uso**. S2 fecha o loop: sair de só-diagnóstico para **recuperação** dos incidentes recorrentes (disparo travado, lead deletado, prompt dessincado, cron perigoso).

Objetivo (decidido): **recovery/mutation**. Não é cobertura nova nem customer-facing.

## Decisões

1. **Write-path: reusar RPC/edge fn testada quando existe; write direto só onde não existe.** Mantém a superfície de escrita cross-org do master **mínima** e reusa lógica + permissão já testadas. **Exceção consciente à regra anti-SECURITY-DEFINER do S1**: aquela regra vale para *leitura* (visibilidade RLS); para *escrita*, chamar uma RPC `SECURITY DEFINER` que faz o próprio check de permissão (ex.: `restore_lead` com branch master) é mais seguro do que conceder ao master `FOR ALL` amplo.

2. **Confirm = echo-token do dry-run.** `runMutation` ganha: `plan()` computa o plano + um `confirm_token = hash(plano canônico)`. Dry-run (default) retorna `{ dryRun:true, plan, confirm_token }`. Aplica **só** quando `input.confirm_token` bate com o recomputado. Como o Claude precisa LER o dry-run para obter o token, ele é forçado a mostrar o plano ao humano antes de aplicar — impede "confirm cego". (Substitui o `confirm:true` boolean do S1.)

3. **Audit-first.** Helper `audit()` grava em `audit_log` com `actor='mcp'` (tool, org_id, params redigidos via `redact`, plan, result) **antes** de retornar sucesso; se a escrita de audit falhar, a mutação **aborta**. Fecha o gap "hard-delete sem rastro".

4. **Gating por ambiente.** Mutating tools só aparecem com `ALLOW_MUTATIONS=true` (já implementado por `visibleTools`). **Rollout: deploya com a flag OFF** (tools presentes mas escondidas) → flipa por ambiente quando for usar. Subir o S2 não expõe mutação até o flip.

5. **`org_id` explícito sempre** (mesmo master) — evita mutação cross-org acidental.

## As 4 tools

| Tool | Write-path | Plano (dry-run mostra) | Notas |
|---|---|---|---|
| `lead.restore(org_id, lead_id)` | reusa RPC `restore_lead` (SECURITY DEFINER + master-ghost, migration 20261212000000) | o lead soft-deletado que voltaria (nome/org/quando deletado) | mais limpo; zero policy nova |
| `copilot.update_prompt(agent_id, sections)` | **write direto** via JWT master | diff dos 3 lugares (system_prompt / custom_instructions.dos / conversation_style.promptSections) | escreve os 3 **atômico** + `prompt_hash=NULL`; precisa **1 migration**: master UPDATE em `copilot_agents` (hoje só master SELECT) |
| `blast.requeue(org_id, job_id)` | reusa mecanismo mass-send (re-dispara job travado) | o job (status/sent/sender_id) que seria re-enfileirado | mais complexo; ação exata (reset+re-trigger vs control endpoint) definida no plano de implementação |
| `cron.toggle(job_name, enabled)` | `cron.alter_job` via **`serviceClient`** | job + estado atual → novo estado | 🔴 pg_cron é privilegiado → **não é RLS-herdado**; usa service_role, fortemente gated + audit. Única tool fora do padrão. Só enable/disable (nunca delete) |

## Ordem de build

- **S2a** (mais limpo, reuse/1-migration): `lead.restore` + `copilot.update_prompt`
- **S2b** (complexo/privilegiado): `blast.requeue` + `cron.toggle`

Cada tool: red-green na lógica pura (echo-token, redact, dry-run/confirm, montagem do plano) local; write real verificado em integração (dev/prod, como no S1).

## Componentes (isolados)

- `lib/guardrails.ts` — estender `runMutation` com echo-token (hash do plano + verificação). Interface pública estável; consumidores (tools) só passam `plan/apply/audit`.
- `lib/audit.ts` — novo `audit(ctx, {tool, org, params, plan, result})` (audit-first). Reusa `redact`.
- `tools/{lead,copilot,blast,cron}.ts` — cada tool exporta um `ToolDef` `readonly:false`; helpers puros de plano testáveis isolados.
- `supabase/migrations/<novo>_torque_mcp_copilot_update_policy.sql` — master UPDATE em `copilot_agents` (mínimo).
- `index.ts` — registrar as 4 (já gated por `ALLOW_MUTATIONS`).

## Testes

- **Unit (Deno local, sem Docker):** geração/verificação do echo-token; `audit()` redige PII + aborta se não gravar; `runMutation` não aplica sem token correto, aplica com; helpers de plano de cada tool.
- **Integração (dev/prod):** cada write real (restore um lead de teste e confirmar; update_prompt e reler os 3; requeue e ver job sair de queued; cron.toggle e ver `active` mudar). Verificação manual via handshake MCP como no S1 (DB local/CI segue bloqueado pela drift de migration — issue separada).

## Segurança

- Tarefa sensível (mutação cross-org multi-tenant) → **seção Segurança obrigatória** no plano de cada tool.
- Master write surface cresce só onde inevitável: 1 policy UPDATE em `copilot_agents`. `cron.toggle` usa service_role isolado (cliente separado, só tools `requiresServiceRole`).
- Echo-token + audit-first + dry-run default + flag OFF por padrão = quatro travas independentes contra mutação acidental/cega.

## Fora de escopo

Cobertura de novas leituras; `db.read_sql`/`rls.check_access`/`migration.diff_prod` (diag pack, rodada futura); cenário B (customer-facing).

## Itens a resolver no plano de implementação

- `blast.requeue`: ação exata de requeue (o bug era `uazapi_sender_id` null → re-criar/re-disparar o sender job). Mapear contra `mass-send-status`/`mass-send-control` + `runUazapiSenderJob`.
- `cron.toggle`: confirmar assinatura de `cron.alter_job`/`cron.schedule` disponível + se precisa de RPC wrapper SECURITY DEFINER em vez de service_role direto.
- `restore_lead`: confirmar assinatura atual (params) + que cobre re-inserção em pipes ou só un-delete.
