# Copilot Agents - Unused Columns Audit

Date: 2026-05-18
Issue: #237

## Scope

Audited `copilot_agents` columns that may be unused or candidates for deprecation.
Searched all `src/`, `supabase/functions/`, and `tests/` for read/write references.

**Decision: DO NOT drop columns. Documentation only.**

---

## allowed_topics (string[])

**Status: ACTIVELY USED (read + write)**

| Location | Usage |
|----------|-------|
| `src/hooks/useCopilotPromptBuilder.ts:57,224-228` | Reads from agent, builds "TOPICOS PERMITIDOS" prompt section |
| `src/hooks/useCopilotAgents.ts:683,840` | Maps to/from wizard data (allowedTopics) |
| `src/lib/copilot/prompt-utils.ts:39` | Maps wizard data to agent payload |
| `src/components/copilot/playground/CopilotPlayground.tsx:182` | Sets `[]` for new agents via playground |
| `supabase/functions/agent-message/engine/build-prompt.ts:298-302` | Server-side prompt builder reads it |
| `tests/unit/use-copilot-prompt-builder.test.ts:118,193` | Tested |

**Verdict:** Keep. Used in prompt building on both client and server.

---

## forbidden_topics (string[])

**Status: ACTIVELY USED (read + write)**

| Location | Usage |
|----------|-------|
| `src/hooks/useCopilotPromptBuilder.ts:58,232-238` | Reads from agent, builds "TOPICOS PROIBIDOS" prompt section |
| `src/hooks/useCopilotAgents.ts:684,841` | Maps to/from wizard data (forbiddenTopics) |
| `src/lib/copilot/prompt-utils.ts:40` | Maps wizard data to agent payload |
| `supabase/functions/agent-message/engine/build-prompt.ts:309-313` | Server-side prompt builder reads it |
| `tests/unit/use-copilot-prompt-builder.test.ts:119,194` | Tested |

**Verdict:** Keep. Used in prompt building on both client and server.

---

## few_shot_examples (json)

**Status: ACTIVELY USED (read + write)**

| Location | Usage |
|----------|-------|
| `src/hooks/useCopilotPromptBuilder.ts:59,762` | Reads from agent, builds few-shot section in prompt |
| `src/hooks/useCopilotAgents.ts:714,859` | Maps to/from wizard data (examples) |
| `src/lib/copilot/prompt-utils.ts:41` | Maps wizard data to agent payload |
| `supabase/functions/agent-message/engine/build-prompt.ts:91` | Server-side reads and injects into prompt |
| `tests/unit/use-copilot-prompt-builder.test.ts:120` | Tested |
| `tests/unit/copilot-prompt-utils.test.ts:151-154` | Tested |

**Verdict:** Keep. Used in prompt building on both client and server.

---

## wizard_version (number)

**Status: NOT USED outside auto-generated types**

| Location | Usage |
|----------|-------|
| `src/integrations/supabase/types.ts` | Auto-generated type definition only |

**Verdict:** Column is dead. No code reads or writes it. Safe to drop in future migration if desired.

---

## template_prompt_override (string)

**Status: NOT USED outside auto-generated types**

| Location | Usage |
|----------|-------|
| `src/integrations/supabase/types.ts` | Auto-generated type definition only |

**Verdict:** Column is dead. No code reads or writes it. Safe to drop in future migration if desired.

---

## Summary

| Column | Status | Action |
|--------|--------|--------|
| `allowed_topics` | Active | Keep |
| `forbidden_topics` | Active | Keep |
| `few_shot_examples` | Active | Keep |
| `wizard_version` | Dead | Can drop later |
| `template_prompt_override` | Dead | Can drop later |
