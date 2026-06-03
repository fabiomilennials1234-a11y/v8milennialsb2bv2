---
title: "Slice 8 — Wizard Design Spec (CTO review gate)"
feature: copilot-v2-remodel
slice: "8"
artifact: design-spec
status: cto-review
branch: feat/copilot-v2/slice-8-wizard
gates: "T9 (UI build) bloqueado até aprovação"
tags: [copilot-v2, slice, wizard, design-spec, security]
---

> Gerado via workflow (3 arquétipos paralelos grounded em base-prompts.ts + síntese). Decisões 1–4 do CTO já aplicadas. **Aprovar/redline os 10 open items no fim antes do T9.** Brief: [[slice-08-wizard]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

# Slice 8 — Copilot v2 Agent Wizard — DESIGN SPEC (CTO review gate)

**Status:** proposal for CTO approve/redline · **Gates:** T9 (engenheiro builds the UI) · **Author:** arquiteto
**Grounded against:** `supabase/functions/_shared/copilot-v2/{base-prompts,prompt-builder,capability-gate,rubric-engine}.ts` and `.specs/features/copilot-v2/SPEC.md` (Slice 8, lines 124-131; safety surface 200-203). Every section/widget below maps 1:1 to a verified `{{token}}`, to the deterministic rubric, or to a capability flag — there is **zero** free text anywhere except the single escape-hatch.

---

## 1. Intro + Hybrid IA

The wizard configures one agent of a fixed archetype (`qualificador | vendedor | carteira`). The client never touches the prompt skeleton — the base prompt is Torque-owned and immutable (`base-prompts.ts`, ADR-0002 #4). The client only fills typed slots; `prompt-builder.fillTemplate()` injects them, missing slots become `(não configurado)`.

**Two modes, one save:**

| Mode | Trigger | Navigation | Why |
|---|---|---|---|
| **STEPPER** (linear) | First-time creation (no row in `copilot_v2_config` yet) | Sequential, forces every required section before the final step | Guarantees the activation-gate is *satisfiable* — you cannot reach "Ativar" with a half-built agent that the server would 409 |
| **TABS** | Editing an existing agent | Free jump between the 12 sections | An operator fixing one field should not re-walk a 12-step funnel |

**Invariants for both modes:**
- **ONE transactional save** (`copilot_v2_config` slots + `escape_hatch_notes` + capability flags + `copilot_v2_rubric` for qualificador, in a single edge transaction). No save-per-section, no orphan media/doc rows (SPEC 130).
- **Dark-first**, Linear/Stripe/Vercel altitude, golden accent (`hsl(47 100% 50%)`).
- **Reuses the platform `OnboardingWizard` stepper chrome** (progress bar + numbered step dots + per-step body + bottom prev/next) — see §6.
- Section **count is fixed at 12** per SPEC 127; the **escape-hatch is the 13th surface and is NOT one of the 12** — it is the lint-gated observations field appended after.

### The load-bearing divergence — Section 4

Section 4 is the only section whose **shape differs by archetype**, because none of the three base prompts has an `{{objective}}` or `{{rubric}}` token (verified: `configToSlots` emits 11 keys, none of them an objective/rubric/section4 slot). So Section 4 never fills a prompt slot — it is agent metadata routed to `slotKey: "section4"`:

| Archetype | Section 4 widget | What it actually drives |
|---|---|---|
| **qualificador** | **RUBRIC-FORM** | Materializes `Rubric { rules: TierRule[] }` → persisted in `copilot_v2_rubric`, consumed by the deterministic `mapSignalsToTier`. The LLM extracts signals; this form parametrizes signals→tier; neither LLM nor client narrates a tier (cardinal rule, `base-prompts.ts:39,102`). |
| **vendedor** | **Curated OBJECTIVE dropdown** | Sets closing posture + handoff bias the wizard uses to pre-suggest capability defaults (§9/§10) and governs the `can_set_tier` toggle. Vendedor *re-fires* the org rubric on new signal when `can_set_tier` is ON (`base-prompts.ts:189`); it never authors a tier from scratch. |
| **carteira** | **Curated OBJECTIVE dropdown** (segment-framed) + segment chips | Picks the **commercial priority** among already-allowed behaviors. Segment (ouro/prata/novo/resgate/dormindo) is read live from `get_lead_360`; the wizard compiles the choice into ONE Torque-authored sentence prepended into the subordinated `{{specific_notes}}` block. Impossible to express a tier. |

---

## 2. Per-section comparison (3 archetypes side by side)

`req` = required for activation. `widget` codes: `tcg` = texto-curto-guiado (hard maxLength, single-phrase hint, NOT prose), `lista` = guided chip/line list, `dropdown` = closed enum, `rubric-form` = §3.1, `toggle-group` = capability toggles (default OFF, fail-closed).

| # | Section | qualificador | vendedor | carteira | Key difference |
|---|---|---|---|---|---|
| 1 | **Empresa** (`company.name/about` → `{{company_name}}`/`{{company_about}}`) | tcg · req · max 220 | tcg · req · max 240 | tcg · req · max 280 | Identical role; only char cap differs |
| 2 | **Produtos** (`products[]` → `{{products}}`) | lista · req · max 80/item | lista · req · max 120/item | lista · req · max 120/item (portfólio recomprável) | Carteira framing = "what this book reorders" |
| 3 | **ICP** (`icp` → `{{icp}}`) | tcg · req · max 280 | tcg · req · max 300 | tcg · req · max 280 | Q = fit compass; V = read encaixe; C = upsell compass, **never re-qualify** |
| 4 | **Section 4** (`section4` metadata — NO prompt token) | **rubric-form** · req | **dropdown** (objetivo de venda) · req | **dropdown** (objetivo por segmento) + segment chips · req | The divergence (§1, §3) |
| 5 | **Objeções** (`objections[]` → `{{objections}}`) | lista · opt · max 160/item | lista · opt · max 220/item | lista · opt · max 240/item | All "objeção → contorno"; off-list objection → transfer |
| 6 | **Prova social** (`socialProof[]` → `{{social_proof}}`) | lista · opt · max 140/item | lista · opt · max 180/item | lista · opt · max 200/item | Reinforcement only, never pressure |
| 7 | **Política comercial** (`commercialPolicy` → `{{commercial_policy}}`) | tcg · opt · max 400 | **tcg · req · max 500** | tcg · req · max 500 | **Required for V & C** — only authorized price/term/MOQ source; every gap forces transfer. Optional for Q (Q rarely quotes) |
| 8 | **Mídia de envio** (`can_send_media`) | toggle-group · opt | toggle-group · opt | toggle-group · opt | Files live org-level (Slice 6); section only authorizes |
| 9 | **Agendamento** (capabilities) | toggle-group · opt (`can_schedule_meeting`) | toggle-group · opt (`can_schedule_meeting`, `can_move_stage`, `can_fill_field`) | toggle-group · opt (`can_schedule_meeting`, `can_move_stage`) | Funnel-advance writes; each gated on its introspect |
| 10 | **Transferência + notificação** | **toggle-group · req** (`can_transfer`, `can_handoff`, `can_set_tier`, `can_move_stage`, `can_fill_field`) | **toggle-group · req** (`can_transfer`, `can_set_tier`) | **handoffTarget dropdown · req** + toggles (`can_transfer`, `can_handoff`, `can_fill_field`) | **Only Q & C have `{{handoff_target}}`.** V has NO handoff target (closer self-escalates to a person, `base-prompts.ts:192`). **`can_set_tier` does NOT exist for carteira** (REGRA DURA, `base-prompts.ts:282`). `can_handoff` does NOT exist for vendedor (self-handoff is meaningless) |
| 11 | **Tom de voz** (`tone` → `{{tone}}`) | dropdown · req | dropdown · req | dropdown · req | Closed enum per archetype (§3.4) |
| 12 | **Horário** (`businessHours` → `{{business_hours}}`) | **dropdown · req** (presets + Personalizado structured picker) | tcg · req · max 120 | tcg · req · max 120 | Q proposal: structured dropdown; V/C: guided short-text with timezone |
| 13 | **Escape-hatch** (`escapeHatchNotes` → `{{specific_notes}}`) | textarea ≤500 · opt · LLM-linted | same | same (carteira prepends the compiled objective sentence above the free tail) | The ONLY free-text field in the entire wizard (§5) |

**Required set (drives the activation-gate, §5):**
- qualificador: 1, 2, 3, 4 (≥1 rubric rule), 10, 11, 12
- vendedor: 1, 2, 3, 4, 7, 10, 11, 12
- carteira: 1, 2, 3, 4, 7, 10 (handoffTarget), 11, 12

---

## 3. Full enum / option sets per archetype (the redline surface)

### 3.1 Qualificador — Section 4 RUBRIC-FORM

Materializes `Rubric { rules: TierRule[] }` exactly (`rubric-engine.ts:29-40`). One row per tier in **fixed descending rank**: diamante (4) → ouro (3) → prata (2) → bronze (1). `desqualificado` is the implicit fallback when no rule is satisfied (`mapSignalsToTier:79`) and is **NOT an editable row**.

Each tier row exposes the 5 optional `TierRule` fields, all typed, zero free text:

| Field | Widget | Semantics |
|---|---|---|
| `minFaturamento` | número (R$/mês, step 1000) | floor (≥); empty = criterion ignored |
| `minVolume` | número (unidades **or** R$/mês per Section-2 toggle) | floor (≥); empty = ignored |
| `minRecorrencia` | dropdown `Level` | `baixa \| media \| alta` (pontual=baixa, esporádica=media, recorrente=alta) |
| `minUrgencia` | dropdown `Level` | `baixa \| media \| alta` |
| `requiresIcp` | toggle bool | requires `icpFit === true` |

**`regiao` is shown read-only/informative** as a captured signal — there is no `minRegiao` in `TierRule`, so the engine never filters by region. Surfacing it as a rule would promise a filter the engine does not apply.

Inline (UI-only, not in prompt): floors are ≥, empty = ignored, ranking auto-descends, and a **non-blocking validator** warns if a lower tier is strictly more demanding than a higher one.

**Pre-loaded opinionated preset (CTO edits):**

| Tier | minFaturamento | minVolume | minRecorrencia | minUrgencia | requiresIcp |
|---|---|---|---|---|---|
| diamante | 100000 | — | alta | — | true |
| ouro | 30000 | — | media | — | — |
| prata | 10000 | (OR volume≥X) | — | — | — |
| bronze | — | — | — | — | — |

`required`: at least the bronze rule present, else every lead → `desqualificado`.

### 3.2 Section 4 OBJECTIVE dropdowns

**Vendedor — "Objetivo de venda + ajuste de tier" (pick exactly one):**
1. Fechar na conversa (closer agressivo — busca decisão de compra no chat)
2. Marcar reunião de fechamento (conduz para call/visita com humano)
3. Apresentar proposta e nutrir (mantém quente até sinal claro de compra)
4. Híbrido: fecha o que dá no chat, escala o resto pra reunião

**Carteira — "Objetivo por segmento de carteira" (pick exactly one) + segment chips (default all 5 ON):**
1. Recompra em foco — facilitar a próxima reposição no momento certo (prioriza ouro/prata)
2. Upsell / cross-sell — expandir ticket e linhas com fit (prioriza ouro/prata/novo)
3. Win-back / resgate — reabrir relação com quem esfriou, sem pressão (prioriza resgate/dormindo)
4. Relacionamento equilibrado — recompra + upsell + resgate conforme o segmento
5. Onboarding de cliente novo — garantir boa 1ª experiência, sem forçar volume (prioriza novo)

Segment chips: `ouro · prata · novo · resgate · dormindo`. Selection compiles into ONE Torque-authored controlled sentence prepended into `{{specific_notes}}` (operator never types it). Only nudges priority among allowed behaviors; cannot smuggle a tier instruction.

### 3.3 Section 10 — handoffTarget dropdown (carteira only — V has none)
1. Responsável da conta (dono do cliente no CRM)
2. Time comercial (round-robin de vendedores)
3. Vendedor closer específico
4. Gestor comercial

(Qualificador's handoff target is the Vendedor agent via `can_handoff` / `handoff_to_vendedor`; its `{{handoff_target}}` is the structured-notification destination configured org-level. Vendedor has no `{{handoff_target}}` token at all.)

### 3.4 Tom de voz (`{{tone}}`) — per archetype

**Qualificador:** Profissional e direto *(default)* · Consultivo e acolhedor · Técnico e objetivo · Próximo e informal (sem gírias) · Formal e institucional

**Vendedor:** Consultivo e direto (parceiro de negócio, sem rodeio) · Formal e técnico (especificação, engenharia, compras industriais) · Próximo e caloroso (relacionamento, sempre profissional) · Objetivo e enxuto (comprador ocupado)

**Carteira:** Parceiro próximo (caloroso, informal-profissional) · Consultivo sóbrio (técnico, direto) · Cordial formal (você, institucional) · Direto e ágil (objetivo, curto)

### 3.5 Horário (`{{business_hours}}`)
**Qualificador (proposed dropdown):** Seg–Sex 08h–18h *(default)* · Seg–Sex 09h–19h · Seg–Sáb 08h–18h · 24/7 · Personalizado (structured day+range picker, no free text).
**Vendedor / Carteira:** texto-curto-guiado, max 120, must include timezone (e.g. "Seg-Sex 8h-18h, horário de Brasília").

> **Open item:** harmonize §12 — either all three use the structured dropdown, or all three use guided short-text. The split (Q dropdown, V/C guided text) is inconsistent and is a CTO redline candidate.

---

## 4. Capability whitelist (per archetype, all default OFF, fail-closed)

The 7 write tools and their flags are fixed in `capability-gate.ts:30-38`. `resolveAgentCapabilities` only enables a flag when explicitly `true` (fail-CLOSED, consistent with Slice 1-H). The wizard surfaces each as an opt-in toggle across sections 8/9/10.

| Capability flag | Write tool | qualificador | vendedor | carteira | Surfaced in |
|---|---|:---:|:---:|:---:|---|
| `can_send_media` | `send_media` | ✅ | ✅ | ✅ | §8 |
| `can_schedule_meeting` | `schedule_meeting` | ✅ | ✅ | ✅ | §9 |
| `can_move_stage` | `move_lead_stage` | ✅ | ✅ | ✅ | §9/§10 |
| `can_fill_field` | `fill_lead_field` | ✅ | ✅ | ✅ | §9/§10 |
| `can_transfer` | `transfer_to_human` | ✅ | ✅ | ✅ | §10 |
| `can_set_tier` | `set_qualification_tier` | ✅ | ✅ | ❌ **forbidden** (REGRA DURA, `base-prompts.ts:282`; `rubric-engine.ts:7-9`) | §10 (Q/V only) |
| `can_handoff` | `handoff_to_vendedor` | ✅ | ❌ **n/a** (self-handoff, `base-prompts.ts:192`) | ✅ | §10 (Q/C only) |

**Recommended defaults (suggested, still client-confirmed; all persist OFF unless toggled):**
- qualificador: `can_set_tier` ON (else the rubric is never fed) + `can_handoff` ON (else qualified lead never reaches Vendedor) + `can_transfer` ON.
- vendedor: `can_transfer` ON; `can_set_tier` per Section-4 choice.
- carteira: `can_transfer` ON; `can_handoff` per objective; `can_set_tier` hidden entirely.

> Read/introspect tools (`get_lead_360`, `get_contact_status`, `get_conversation_history`, `list_pipeline_stages`, `list_custom_fields`, `search_knowledge`, `check_agenda_availability`) are **never** gated and never appear in the wizard — they are always allowed (`capability-gate.ts:52-55`).

---

## 5. Escape-hatch + Activation UX

### Escape-hatch (the only free-text field — SPEC 129, 202)
- Single `<textarea>`, **≤500 chars**, with a live counter (e.g. `0/500`, turns warning at 480, hard-blocks input past 500).
- Maps to `escapeHatchNotes` → `{{specific_notes}}`, framed in-prompt as strictly subordinate to all hard rules (`base-prompts.ts:117-119, 209-213, 291-295`).
- **Server LLM-linter** runs on save (SPEC 129): rejects conflict-with-base / PII / jailbreak / price-coercion. Rejection surfaced **inline** with `{ category, suggestion }` — not a toast, attached to the field, blocks the transactional save.
- Carteira: the compiled objective sentence (§3.2) is prepended by the system; the operator-editable free tail still counts against the 500 cap and is linted.

### Activation ("Ativar" affordance)
- **Client-side mirror** of the activation-gate evaluates the required set (§2). "Ativar" is **disabled** until the mirror passes; a checklist shows which required sections are still missing so the path forward is obvious.
- On submit, the server is authoritative. **HTTP 409 `not_activatable`** returns `missingHard: string[]`; the UI lists each missing hard requirement inline against its section (and, in TABS mode, deep-links/jumps to the offending tab).
- Activation flips `copilot_v2_agents.is_active`; it is a separate affordance from save (you can save a draft without activating).

---

## 6. Component reuse plan

**Reuse `src/modules/platform/components/onboarding/OnboardingWizard.tsx` chrome (verified pattern):**
- Header + skip, the progress bar (`bg-primary` fill, `transition-all duration-500`), the numbered **step dots** with per-step Lucide icons and connector lines, the `max-w-lg mx-auto` body column, and the bottom prev/next nav (`Voltar` / `Continuar`, disabled-until-`canAdvance`).
- The `STEP_KEYS` / `STEP_LABELS` / `STEP_ICONS` / `canAdvance(currentStep)` per-step-validation pattern transfers directly to the 12-section stepper.
- **Do not reuse** its save-per-step (`saveStepAnswers`) model — Slice 8 mandates ONE transactional save. Local `useState` mirror, single submit at the end.

**New module home:** `src/modules/copilot/components/v2-wizard/` (BC = copilot, Active per `src/modules/CLAUDE.md`).

**shadcn primitives (from `src/components/ui/`):** `Input`, `Textarea` (escape-hatch + tcg), `Select` (dropdowns/tone/hours/objective/handoffTarget), `Switch` (capability toggles + `requiresIcp`), `Tabs` (edit mode), `Badge`/chips (lista items + segment chips), `Label`, `Form` (RHF + Zod), `Card`, `Tooltip` (the per-field hints). Number inputs in the rubric-form use `Input type=number` with `step`/`min`. `cn()` for golden-accent active states.

**Validation:** RHF + Zod per-section, mirroring the edge Zod schema for `copilot_v2_config` (SPEC 47) so the client mirror and server contract cannot drift. The rubric-form validates against the `Rubric`/`TierRule` shape (`rubric-engine.ts`) and persists to `copilot_v2_rubric`.

**Widget → primitive map:**

| Widget | Primitive |
|---|---|
| texto-curto-guiado | `Input`/`Textarea` + `maxLength` + char counter + single-phrase placeholder |
| lista | tag/chip input (`Input` + `Badge` list), per-item `maxLength` |
| dropdown | `Select` (closed enum) |
| rubric-form | `Card` grid: `Input type=number` + `Select` (Level) + `Switch` |
| toggle-group | `Switch` group, all default OFF |
| escape-hatch | `Textarea` ≤500 + live counter + inline linter error |

---

## 7. Notes for the engenheiro (T9)
- Persist shape: `copilot_v2_config` JSONB (Zod-validated) + `escape_hatch_notes` TEXT ≤500 nullable (SPEC 47); capability flags live under `slots.capabilities` (matches `resolveAgentCapabilities`); qualificador rubric → `copilot_v2_rubric` (SPEC 48). All in one transaction (SPEC 130).
- Section 4 for V/C writes `slotKey: "section4"` metadata; carteira's compiled sentence is prepended to `escapeHatchNotes` at build time — never let the operator type it.
- The wizard must NOT emit `handoff_target` for vendedor (no token) and must NOT render `can_set_tier` for carteira (REGRA DURA).
- Round-trip test (SPEC 131): load → edit one field → save → reload must be lossless; malicious escape-hatch must be rejected; assert no free-text field exists beyond the escape-hatch.

=== OPEN ITEMS FOR CTO (10) ===
1. Qualificador rubric preset thresholds (diamante fat>=100k+recorrencia alta+ICP; ouro fat>=30k+recorrencia media; prata fat>=10k OR volume>=X; bronze no floor) — concrete numbers to approve/redline, especially prata's 'volume>=X' placeholder.
2. Vendedor Section-4 objective enum: the 4 closing objectives (Fechar na conversa / Marcar reuniao de fechamento / Apresentar proposta e nutrir / Hibrido) — approve set and labels.
3. Carteira Section-4 objective enum: the 5 segment-framed objectives + which segments each prioritizes — approve, especially whether 'Onboarding de cliente novo' should be a separate objective or folded into 'Relacionamento equilibrado'.
4. Carteira handoffTarget enum (Responsavel da conta / Time comercial round-robin / Vendedor closer especifico / Gestor comercial) — approve the 4 destinations and confirm they map to real notification-routing targets.
5. Tom de voz enums per archetype (5 for qualificador, 4 for vendedor, 4 for carteira) — approve labels/registers and the suggested defaults.
6. Section 12 (Horario) inconsistency: qualificador uses a structured preset dropdown (incl. 24/7 + Personalizado) while vendedor/carteira use guided short-text with timezone. Decide whether to harmonize all three to the dropdown or all three to guided text.
7. Recommended capability defaults (Q: can_set_tier+can_handoff+can_transfer ON; V: can_transfer ON; C: can_transfer ON) — confirm these pre-checks, given everything still persists OFF unless the operator confirms.
8. Per-section maxLength caps (company 220/240/280, products 80/120, icp 280/300, objections 160/220/240, socialProof 140/180/200, commercialPolicy 400 for Q vs 500 for V/C) — approve or normalize the caps.
9. Required-set per archetype (esp. commercialPolicy required for vendedor & carteira but optional for qualificador; Section 10 required for all three) — confirm this gating matches the desired activation bar.
10. Escape-hatch linter rejection categories surfaced inline (conflict / PII / jailbreak / price-coercion) — confirm the category enum the UI should render.
