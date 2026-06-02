# copilot-v2-save-config 🔒

Wizard SAVE endpoint do Copilot v2 (Slice 8). Superfície **authenticated admin** — não webhook.

## Contrato
`POST { agentId, archetype, config, activate }` → `SaveConfigResult`.
- `200 ok` `{ status:'ok', config }` — salvo (e ativado se `activate`).
- `422 invalid` `{ errors[] }` — schema estrito reprovou (campo livre fora do escape-hatch, tipo errado, cap fora do whitelist do arquétipo, `organization_id` no payload).
- `422 rejected` `{ reason }` — escape-hatch linter bloqueou (`escape_hatch:jailbreak|pii|policy_conflict` ou `escape_hatch_check_failed` fail-CLOSED).
- `409 not_activatable` `{ missingHard[] }` — activation-gate reprovou (só quando `activate:true`); **não salva** (sem linha meia-ativa).

## Invariantes
- **Org nunca do payload.** Client carrega o JWT do admin; RPCs `save_copilot_v2_config`/`set_copilot_v2_agent_active` (SECURITY DEFINER) resolvem org do agent row + exigem `get_my_admin_organization_ids()`.
- **Ordem fail-CLOSED, pré-DB:** schema → linter → activation → save. Lógica pura em `_shared/copilot-v2/save-config-flow.ts` (unit-tested); este arquivo é só I/O.
- **Save transacional** (upsert único na RPC) → sem órfão (mata v1 #35).
- **Linter always-on, hard-block** (decisão CTO): regex prefilter (PII/jailbreak, custo zero) → se limpo, 1 classify `gemini-2.5-flash` (conflito de política). Parse falho → fail-CLOSED.

## Deps
`save-config-flow.ts`, `config-schema.ts`, `escape-hatch-linter.ts`, `activation-gate.ts`, `openrouter-client.ts`. Migration `20260602220000_copilot_v2_save_config_rpcs.sql` (committed-not-applied).

## Env
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`.

## config.toml
`verify_jwt = false` (preflight OPTIONS); JWT do admin validado dentro via client user-scoped + assert da RPC.
