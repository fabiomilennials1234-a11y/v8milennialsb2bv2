# 2026-06-08 — Copilot v2 wizard redesign (toggle + 2 abas)

## Mudanças
- **Copilot v2 (área frágil)**: redesenho do fluxo de criação/edição do agente. Stepper de 12 seções planas → layout único (criar=editar) com **toggle de personalidade por rota** + **3 abas** (Base de fábrica · Especificidades · Testar).
- **Base (read-only)**: selo "Verificado pela Torque", tom em cards com micro-exemplo (único editável), capabilities como chips informativos (não switches), accordion "Garantias" com "O que ele nunca faz" em verde.
- **Especificidades**: slots reagrupados em 5 grupos; novo campo **companyParticularities** (≤1000) ao lado de products; tom e capabilities migraram pra Base.
- **Capabilities travadas por arquétipo (v1)**: server re-deriva do whitelist (todas `true`), payload do cliente ignorado — fail-closed.
- **Novo slot `{{company_particularities}}`** injetado nos 3 base-prompts (subordinado à política comercial).
- **Re-bless consciente** dos fingerprints dos goldens (eval + redteam) porque o texto dos base-prompts mudou; comportamento dos casos inalterado.

## Arquivos tocados
- `supabase/functions/_shared/copilot-v2/base-prompts.ts` — seção `{{company_particularities}}` nos 3 arquétipos.
- `supabase/functions/_shared/copilot-v2/prompt-builder.ts` — `companyParticularities` em `AgentConfig` + `configToSlots`.
- `supabase/functions/_shared/copilot-v2/config-schema.ts` — slot `companyParticularities` (string ≤1000, strict) + `defaultCapabilitiesFor(archetype)`.
- `supabase/functions/_shared/copilot-v2/save-config-flow.ts` — override server-side das capabilities pelo whitelist do arquétipo.
- `src/modules/copilot/lib/copilot-v2-config.ts` — mirror FE do slot + `COMPANY_PARTICULARITIES_MAX` + `defaultCapabilitiesFor`.
- `src/modules/copilot/lib/copilot-v2-base-narrative.ts` (novo) — `BASE_NARRATIVE` + `CAP_LABELS` + `TONE_MICRO_EXAMPLE` + ordem do accordion.
- `src/modules/copilot/components/v2-wizard/CopilotV2Wizard.tsx` — reescrito: 3 abas + action bar sticky + roteamento de erro pra aba.
- `src/modules/copilot/components/v2-wizard/BaseTab.tsx` (novo) — aba Base read-only.
- `src/modules/copilot/components/v2-wizard/wizardSections.ts` — reagrupado em 5 grupos (Especificidades).
- `src/modules/copilot/components/v2-wizard/fields.tsx` — tom→Base, novo `particularities`/`objective-cards`, `*` gold, validação on-blur.
- `src/modules/copilot/pages/CopilotV2.tsx` — toggle de personalidade por rota + dirty-guard.
- `tests/unit/copilot-v2/{config-schema,save-config-flow,base-prompts.contract,wizard-ui}.test.ts(x)` + novo `base-narrative-hash.test.ts`.
- `tests/fixtures/copilot-v2/{eval-golden,redteam-golden}.json` — fingerprints re-blessed.

## Decisões
- Toggle = rota (mantém get-or-create, URL, back-button). Dirty-guard via `window.confirm`.
- Narrativa da Base = constante front-end curada (NÃO regex do prompt) + hash smoke-test (mesmo padrão de `fe-edge-contract`).
- Capabilities NÃO editáveis no v1 — derivadas server-side; activation "≥1 cap" sempre ok.
- companyParticularities é company-level único (não per-product); `slots` JSONB → sem migration.

## QA (counts literais)
- `tests/unit/copilot-v2/`: **86 files / 638 tests pass** (era 85/620 — +18 testes novos).
- eval-dataset-gate + redteam-gate: verdes (fingerprints re-blessed).
- `tsc --noEmit`: 0 erros. `npm run build`: OK. eslint (arquivos novos): 0 erros, 0 warnings.
- Verificação ao vivo (dev `bcfadphgsibjzivtbjvc`, Milennials qualificador ATIVO) via Playwright: agente ativo carrega/renderiza sem erro de console novo; toggle, 3 abas, Base (selo/cards/chips/accordion verde), Especificidades (5 grupos + companyParticularities) confirmados.
- Suite unit completa do repo permanece com 26 files vermelhos PRÉ-EXISTENTES (cors/whatsapp/uazapi/protected-route/pricing/...), nenhum importa módulo tocado — baseline red conhecido.

## Follow-ups
- Deploy edge (`copilot-v2-save-config`, `agent-runtime-v2`) e prod: NÃO feito (exige CTO). O slot novo já está no contrato compartilhado; deploy quando a fase de cutover rodar.
- Considerar surfacing dos `missingSoft` (objections/socialProof) como nudge na action bar (hoje só hard).
