# Copilot Prompt Analyzer

**Date:** 2026-05-12
**Status:** Approved
**Author:** Gabriel (CTO) + Claude

## Summary

Batch analysis of copilot conversations via Gemini 2.5 Flash to suggest prompt improvements. User reviews suggestions with diff preview, accepts or ignores each one. Accepted suggestions auto-patch the agent's prompt fields.

## Goals

- Help users improve copilot prompts based on real conversation data
- Surface gaps, failures, and improvement opportunities automatically
- Zero risk to existing functionality (fully modular, additive-only)

## Non-Goals

- Real-time per-conversation analysis (future consideration)
- Automatic prompt changes without user approval
- Replacing the manual PromptEditor workflow

## Architecture

```
Tab "Análise" (React, lazy-loaded)
  └─ Button "Analisar conversas"
       └─ POST /analyze-copilot-prompt (Edge Function)
            ├─ Validate org membership + rate limit
            ├─ Query: 50 conversations × 30 msgs (last 7 days)
            ├─ Build meta-prompt: current prompt config + conversations
            ├─ Call Gemini 2.5 Flash
            └─ Return: Suggestion[]
  └─ Suggestion cards (diff preview per section)
       ├─ Accept → UPDATE copilot_agents (specific field)
       └─ Ignore → mark as dismissed in local state
  └─ Persist analysis in copilot_prompt_analyses
```

### Isolation Guarantees

| Component | Touches existing code? | Isolation |
|-----------|----------------------|-----------|
| Edge fn `analyze-copilot-prompt` | No | New function, new directory |
| Table `copilot_prompt_analyses` | No | New table, own RLS policies |
| Tab "Análise" in Playground | Adds one tab entry | New component, lazy-loaded |
| Hook `usePromptAnalysis` | No | New hook, own query key |
| Accept suggestion mutation | UPDATE copilot_agents | Same operation as manual edit |

**Rollback:** Remove tab = 1 line. Drop table + function = 1 migration. No existing data modified.

## Database

### New table: `copilot_prompt_analyses`

```sql
CREATE TABLE public.copilot_prompt_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  suggestions JSONB NOT NULL DEFAULT '[]',
  accepted_ids TEXT[] NOT NULL DEFAULT '{}',
  dismissed_ids TEXT[] NOT NULL DEFAULT '{}',
  conversation_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.copilot_prompt_analyses ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_prompt_analyses_agent ON public.copilot_prompt_analyses (agent_id, created_at DESC);
CREATE INDEX idx_prompt_analyses_org ON public.copilot_prompt_analyses (organization_id);
```

### Suggestion JSON schema

```typescript
interface PromptSuggestion {
  id: string;                    // "sug_01", "sug_02", ...
  section: PromptSection;
  type: "add" | "rewrite" | "remove";
  field: string;                 // exact field key
  current_text: string | null;   // null for "add" type
  suggested_text: string;        // empty for "remove" type
  reason: string;                // human-readable explanation
  evidence: string[];            // conversation excerpts as proof
  confidence: number;            // 0.0 - 1.0
}

type PromptSection =
  | "personality"
  | "objective"
  | "flow"
  | "products"
  | "instructions"
  | "business_context"
  | "conversation_style";
```

## Edge Function: `analyze-copilot-prompt`

### Request

```typescript
POST /analyze-copilot-prompt
Authorization: Bearer <user_jwt>
Body: { agent_id: string }
```

### Flow

1. Validate JWT + org membership
2. Fetch agent config: `promptSections`, `business_context`, `conversation_style`, `objective_composite`, `custom_instructions`
3. Rate limit check: query `copilot_prompt_analyses` for agent in last 24h — reject if exists
4. Fetch conversations:
   ```sql
   SELECT c.id, c.state, c.context, c.turn_count,
     (SELECT json_agg(sub ORDER BY sub.created_at)
      FROM (
        SELECT role, content, created_at
        FROM conversation_messages cm
        WHERE cm.conversation_id = c.id
        ORDER BY cm.created_at
        LIMIT 30
      ) sub
     ) AS messages
   FROM conversations c
   WHERE c.agent_id = $agent_id
     AND c.organization_id = $org_id
     AND c.created_at >= now() - interval '7 days'
     AND c.turn_count >= 2
   ORDER BY c.created_at DESC
   LIMIT 50;
   ```
5. If < 5 conversations → return `{ error: "insufficient_data", min_required: 5 }`
6. Build meta-prompt (see below)
7. Call Gemini 2.5 Flash
8. Parse + validate response
9. Insert into `copilot_prompt_analyses`
10. Return suggestions

### Meta-prompt (structure)

```
You are an expert WhatsApp sales conversation analyst for a B2B CRM.

## Current Agent Configuration

### Personality
{promptSections.personality}

### Objective
{promptSections.objective}

### Conversation Flow
{promptSections.flow}

### Products/Services
{promptSections.products}

### Instructions (Do's and Don'ts)
{promptSections.instructions}

### Business Context
{JSON.stringify(business_context)}

### Conversation Style
{JSON.stringify(conversation_style)}

## Recent Conversations (last 7 days)
{conversations as JSON array}

## Task

Analyze these conversations and identify:
1. Knowledge gaps — questions customers ask that the agent can't answer well
2. Behavioral failures — responses that don't match the configured personality/style
3. Flow issues — conversations that deviate from the intended flow
4. Missing context — business information the agent needs but doesn't have

Return a JSON array of suggestions. Each suggestion MUST target a specific section
and provide concrete text changes. Sort by confidence (highest first).

Output format:
[
  {
    "id": "sug_01",
    "section": "personality | objective | flow | products | instructions | business_context | conversation_style",
    "type": "add | rewrite | remove",
    "field": "exact_field_key",
    "current_text": "text being replaced (null for add)",
    "suggested_text": "proposed new text",
    "reason": "why this improves the agent",
    "evidence": ["Conversation #3: customer asked about X, agent said Y"],
    "confidence": 0.85
  }
]

Rules:
- Maximum 10 suggestions
- Only suggest changes with confidence >= 0.5
- For business_context fields, use the exact JSONB key (e.g., "productSummary", "pricingPolicy")
- For conversation_style fields, use the exact JSONB key (e.g., "responseLength", "openingStyle")
- For promptSections, use the section key directly as the field
- Provide specific text, not vague advice
- Include conversation evidence for every suggestion
```

### Rate Limiting

- 1 analysis per agent per 24 hours (server-side, not bypassable)
- Check: `SELECT 1 FROM copilot_prompt_analyses WHERE agent_id = $1 AND created_at > now() - interval '24 hours'`

### Error Responses

| Condition | Response |
|-----------|----------|
| No org membership | 403 |
| Agent not found / wrong org | 404 |
| Rate limited | 429 `{ next_available_at }` |
| < 5 conversations | 200 `{ error: "insufficient_data" }` |
| Gemini API error | 502 |

## Frontend

### New files

```
src/components/copilot/playground/
  PromptAnalysisTab.tsx          — main tab component
  PromptAnalysisSuggestionCard.tsx — individual suggestion card with diff
  PromptAnalysisEmptyState.tsx    — no data / idle states

src/hooks/
  usePromptAnalysis.ts           — query + mutations
```

### Tab Integration

In `CopilotPlayground.tsx`, add tab entry:

```tsx
{ key: "analysis", label: "Análise", icon: Sparkles }
```

Lazy-load `PromptAnalysisTab` only when tab is active.

### States

1. **Idle** — "Analise as conversas do seu copilot para receber sugestões de melhoria no prompt." + button
2. **Loading** — Skeleton cards + progress text ("Analisando 47 conversas...")
3. **Results** — Suggestion cards sorted by confidence. Header: "7 sugestões encontradas — 0 aplicadas"
4. **Empty** — "Menos de 5 conversas nos últimos 7 dias. O copilot precisa conversar mais para gerar sugestões."
5. **Rate limited** — "Próxima análise disponível em X horas."
6. **History** — Dropdown to view past analyses

### Suggestion Card

```
┌─────────────────────────────────────────────┐
│ [Personalidade]  [Reescrever]    85% conf.  │
│                                             │
│ Motivo: 40% dos clientes perguntam sobre    │
│ garantia e o agente não sabe responder.     │
│                                             │
│ ┌─ Atual ─────────────────────────────────┐ │
│ │ Seja direto e profissional...           │ │
│ └─────────────────────────────────────────┘ │
│ ┌─ Sugerido ──────────────────────────────┐ │
│ │ Seja direto e profissional. Sempre      │ │
│ │ mencione a garantia de 12 meses...      │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ▸ Ver evidências (3 conversas)              │
│                                             │
│        [Ignorar]        [Aplicar]           │
└─────────────────────────────────────────────┘
```

### Accept Flow

1. User clicks "Aplicar"
2. Confirmation: shows field that will be modified + preview
3. Mutation: UPDATE copilot_agents → patch specific field
4. Update `copilot_prompt_analyses.accepted_ids` (append suggestion id)
5. Invalidate agent query cache
6. Toast: "Sugestão aplicada na seção Personalidade"
7. Card collapses with "Aplicada" badge

### Field Mapping for UPDATE

| Section | DB Column | Update Strategy |
|---------|-----------|-----------------|
| personality | `prompt_sections->>'personality'` | Replace full text |
| objective | `prompt_sections->>'objective'` | Replace full text |
| flow | `prompt_sections->>'flow'` | Replace full text |
| products | `prompt_sections->>'products'` | Replace full text |
| instructions | `prompt_sections->>'instructions'` | Replace full text |
| business_context | `business_context->>'{field}'` | Patch specific JSONB key |
| conversation_style | `conversation_style->>'{field}'` | Patch specific JSONB key |

**Note:** After any accepted suggestion, bump `system_prompt_version` and clear `prompt_hash` to force prompt regeneration on next agent interaction.

## Security

- Edge fn validates org membership via JWT + team_members
- Agent must belong to caller's org
- Rate limit enforced server-side (not client-side)
- Conversation data sent to Gemini — same provider already used by agent-message (no new data exposure)
- RLS on copilot_prompt_analyses scoped to organization_id
- No PII logging in edge function logs

## Estimates

| Metric | Value |
|--------|-------|
| Latency | 5-15s |
| Cost per analysis | ~R$0.15 (Gemini Flash) |
| Max input tokens | ~50k (50 convos × 30 msgs) |
| Storage per analysis | ~2-5 KB |
| Rate limit | 1/agent/24h |
| Min conversations required | 5 |

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/analyze-copilot-prompt/index.ts` | Edge function |
| `supabase/migrations/YYYYMMDD_copilot_prompt_analyses.sql` | Table + RLS |
| `src/components/copilot/playground/PromptAnalysisTab.tsx` | Main tab |
| `src/components/copilot/playground/PromptAnalysisSuggestionCard.tsx` | Card component |
| `src/components/copilot/playground/PromptAnalysisEmptyState.tsx` | Empty/idle states |
| `src/hooks/usePromptAnalysis.ts` | Query + mutations |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/copilot/playground/CopilotPlayground.tsx` | Add "Análise" tab |
| `supabase/config.toml` | Add `analyze-copilot-prompt` with `verify_jwt = true` |
