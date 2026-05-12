# Copilot Prompt Analyzer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch-analyze copilot conversations via Gemini 2.5 Flash, surface prompt improvement suggestions, let user accept/reject with diff preview, auto-patch agent config on accept.

**Architecture:** New edge function fetches conversations + current prompt, sends to Gemini, returns structured suggestions. New React tab in CopilotPlayground displays results. Accept mutation patches `conversation_style.promptSections` or `business_context` JSONB fields. Fully modular — no changes to existing logic.

**Tech Stack:** Deno (edge fn), Gemini 2.5 Flash API, React 18 + TS, shadcn/ui, TanStack Query v5, Supabase Postgres

**Spec:** `docs/superpowers/specs/2026-05-12-copilot-prompt-analyzer-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20261008000000_copilot_prompt_analyses.sql` | Table + RLS + index |
| `supabase/functions/analyze-copilot-prompt/index.ts` | Edge fn: fetch data → Gemini → return suggestions |
| `src/hooks/usePromptAnalysis.ts` | Query (history) + mutations (analyze, accept, dismiss) |
| `src/components/copilot/playground/PromptAnalysisTab.tsx` | Tab container: states (idle/loading/results/empty/rate-limited) |
| `src/components/copilot/playground/PromptAnalysisSuggestionCard.tsx` | Individual suggestion card with diff + accept/ignore |

### Modified Files

| File | Change |
|------|--------|
| `src/components/copilot/playground/CopilotPlayground.tsx` | Add 4th tab "Análise" (grid-cols-4, new TabsTrigger + TabsContent) |
| `supabase/config.toml` | Add `[functions.analyze-copilot-prompt]` with `verify_jwt = false` |

---

## Task 1: Database — Table + RLS

**Files:**
- Create: `supabase/migrations/20261008000000_copilot_prompt_analyses.sql`

- [ ] **Step 1: Write migration**

```sql
-- Copilot Prompt Analyses — stores conversation analysis results
CREATE TABLE public.copilot_prompt_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepted_ids TEXT[] NOT NULL DEFAULT '{}',
  dismissed_ids TEXT[] NOT NULL DEFAULT '{}',
  conversation_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_prompt_analyses ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prompt_analyses_agent
  ON public.copilot_prompt_analyses (agent_id, created_at DESC);

CREATE INDEX idx_prompt_analyses_org
  ON public.copilot_prompt_analyses (organization_id);

-- RLS: org members can read their own analyses
CREATE POLICY "prompt_analyses_select_own_org"
  ON public.copilot_prompt_analyses FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- RLS: org members can insert for their own org
CREATE POLICY "prompt_analyses_insert_own_org"
  ON public.copilot_prompt_analyses FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- RLS: org members can update their own analyses (accept/dismiss)
CREATE POLICY "prompt_analyses_update_own_org"
  ON public.copilot_prompt_analyses FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- Master access
CREATE POLICY "prompt_analyses_master_all"
  ON public.copilot_prompt_analyses FOR ALL
  USING (public.is_master_user());
```

- [ ] **Step 2: Apply migration to prod**

Use Supabase MCP `apply_migration` tool with project_id `jsjsmuncfkbsbzqzqhfq`.

- [ ] **Step 3: Verify table exists**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'copilot_prompt_analyses';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261008000000_copilot_prompt_analyses.sql
git commit -m "feat: add copilot_prompt_analyses table + RLS"
```

---

## Task 2: Edge Function — analyze-copilot-prompt

**Files:**
- Create: `supabase/functions/analyze-copilot-prompt/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Add config.toml entry**

Append to `supabase/config.toml`:

```toml
# analyze-copilot-prompt: JWT validated inside function; OPTIONS preflight needs passthrough
[functions.analyze-copilot-prompt]
verify_jwt = false
```

- [ ] **Step 2: Create edge function**

Create `supabase/functions/analyze-copilot-prompt/index.ts`:

```typescript
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 30;
const MIN_CONVERSATIONS = 5;
const LOOKBACK_DAYS = 7;
const RATE_LIMIT_HOURS = 24;

interface Suggestion {
  id: string;
  section: string;
  type: "add" | "rewrite" | "remove";
  field: string;
  current_text: string | null;
  suggested_text: string;
  reason: string;
  evidence: string[];
  confidence: number;
}

function buildMetaPrompt(
  agentConfig: Record<string, unknown>,
  conversations: unknown[],
): string {
  const promptSections = (agentConfig.conversation_style as any)?.promptSections || {};
  const businessContext = agentConfig.business_context || {};
  const conversationStyle = { ...(agentConfig.conversation_style || {}) } as Record<string, unknown>;
  delete conversationStyle.promptSections;
  delete conversationStyle.toolInstructions;

  return `You are an expert WhatsApp sales conversation analyst for a B2B CRM called Torque CRM.

## Current Agent Configuration

### Agent Name
${agentConfig.name || "Unnamed"}

### Personality Section
${promptSections.personality || "(empty)"}

### Objective Section
${promptSections.objective || "(empty)"}

### Conversation Flow Section
${promptSections.flow || "(empty)"}

### Products/Services Section
${promptSections.products || "(empty)"}

### Instructions (Do's and Don'ts) Section
${promptSections.instructions || "(empty)"}

### Business Context (JSONB)
${JSON.stringify(businessContext, null, 2)}

### Conversation Style (JSONB)
${JSON.stringify(conversationStyle, null, 2)}

### Custom Instructions
${agentConfig.custom_instructions || "(empty)"}

## Recent Conversations (last ${LOOKBACK_DAYS} days)
${JSON.stringify(conversations, null, 2)}

## Task

Analyze these conversations and identify:
1. **Knowledge gaps** — questions customers ask that the agent cannot answer well or at all
2. **Behavioral failures** — responses that don't match the configured personality/style/tone
3. **Flow issues** — conversations that deviate from the intended flow or get stuck
4. **Missing context** — business information the agent needs but doesn't have in its prompt

Return a JSON array of suggestions. Each suggestion MUST target a specific section and provide concrete text changes. Sort by confidence (highest first). Maximum 10 suggestions.

IMPORTANT RULES:
- Only suggest changes with confidence >= 0.5
- For prompt sections (personality, objective, flow, products, instructions): set "field" to the section key itself
- For business_context fields: set "section" to "business_context" and "field" to the exact JSONB key (e.g., "productSummary", "pricingPolicy")
- For conversation_style fields: set "section" to "conversation_style" and "field" to the exact JSONB key (e.g., "responseLength", "openingStyle")
- Provide specific, ready-to-use text (not vague advice)
- Include conversation evidence for every suggestion (quote actual messages)
- If the agent is performing well and no improvements are needed, return an empty array []

Respond ONLY with the JSON array (no markdown fences, no explanation):
[
  {
    "id": "sug_01",
    "section": "personality",
    "type": "rewrite",
    "field": "personality",
    "current_text": "current text being replaced",
    "suggested_text": "proposed new text",
    "reason": "human-readable explanation",
    "evidence": ["Conversation #3: customer asked X, agent said Y"],
    "confidence": 0.85
  }
]`;
}

function parseSuggestions(raw: string): Suggestion[] {
  let cleaned = raw.trim();
  // Strip markdown fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (s: any) =>
        s.id && s.section && s.type && s.field && s.suggested_text && s.reason &&
        typeof s.confidence === "number" && s.confidence >= 0.5,
    )
    .slice(0, 10);
}

Deno.serve(
  withSentry("analyze-copilot-prompt", async (req) => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: extract JWT from Authorization header
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!;

    // Create user-scoped client to get user info
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service client for data queries
    const db = createClient(supabaseUrl, serviceKey);

    // Get user's org
    const { data: membership } = await db
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!membership?.organization_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgId = membership.organization_id;

    // Parse body
    const { agent_id } = await req.json();
    if (!agent_id) {
      return new Response(JSON.stringify({ error: "agent_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify agent belongs to org
    const { data: agent } = await db
      .from("copilot_agents")
      .select("id, name, business_context, conversation_style, custom_instructions, objective_composite")
      .eq("id", agent_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 1 analysis per agent per 24h
    const { data: recentAnalysis } = await db
      .from("copilot_prompt_analyses")
      .select("id, created_at")
      .eq("agent_id", agent_id)
      .gte("created_at", new Date(Date.now() - RATE_LIMIT_HOURS * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentAnalysis) {
      const nextAvailable = new Date(
        new Date(recentAnalysis.created_at).getTime() + RATE_LIMIT_HOURS * 3600_000,
      ).toISOString();
      return new Response(
        JSON.stringify({ error: "rate_limited", next_available_at: nextAvailable }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch conversations (last 7 days, min 2 turns, max 50)
    const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
    const { data: conversations, error: convError } = await db
      .from("conversations")
      .select("id, state, context, turn_count, created_at")
      .eq("agent_id", agent_id)
      .eq("organization_id", orgId)
      .gte("created_at", lookbackDate)
      .gte("turn_count", 2)
      .order("created_at", { ascending: false })
      .limit(MAX_CONVERSATIONS);

    if (convError) {
      return new Response(JSON.stringify({ error: "Failed to fetch conversations" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!conversations || conversations.length < MIN_CONVERSATIONS) {
      return new Response(
        JSON.stringify({
          error: "insufficient_data",
          min_required: MIN_CONVERSATIONS,
          found: conversations?.length ?? 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch messages for each conversation
    let totalMessages = 0;
    const conversationsWithMessages = [];
    for (const conv of conversations) {
      const { data: msgs } = await db
        .from("conversation_messages")
        .select("role, content, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true })
        .limit(MAX_MESSAGES_PER_CONVERSATION);

      const messages = msgs ?? [];
      totalMessages += messages.length;
      conversationsWithMessages.push({
        id: conv.id,
        state: conv.state,
        turn_count: conv.turn_count,
        messages,
      });
    }

    // Build meta-prompt and call Gemini
    const metaPrompt = buildMetaPrompt(agent, conversationsWithMessages);

    const geminiResponse = await fetch(
      `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: metaPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errBody);
      return new Response(JSON.stringify({ error: "Gemini API error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    let suggestions: Suggestion[];
    try {
      suggestions = parseSuggestions(rawText);
    } catch (e) {
      console.error("Failed to parse Gemini response:", e, rawText);
      suggestions = [];
    }

    // Persist analysis
    const { data: analysis, error: insertError } = await db
      .from("copilot_prompt_analyses")
      .insert({
        agent_id,
        organization_id: orgId,
        suggestions,
        conversation_count: conversations.length,
        message_count: totalMessages,
        created_by: user.id,
      })
      .select("id, created_at")
      .single();

    if (insertError) {
      console.error("Failed to persist analysis:", insertError);
    }

    return new Response(
      JSON.stringify({
        analysis_id: analysis?.id ?? null,
        suggestions,
        conversation_count: conversations.length,
        message_count: totalMessages,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/analyze-copilot-prompt/index.ts supabase/config.toml
git commit -m "feat: add analyze-copilot-prompt edge function"
```

---

## Task 3: Frontend Hook — usePromptAnalysis

**Files:**
- Create: `src/hooks/usePromptAnalysis.ts`

- [ ] **Step 1: Create hook**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PromptSuggestion {
  id: string;
  section: string;
  type: "add" | "rewrite" | "remove";
  field: string;
  current_text: string | null;
  suggested_text: string;
  reason: string;
  evidence: string[];
  confidence: number;
}

export interface PromptAnalysis {
  id: string;
  agent_id: string;
  suggestions: PromptSuggestion[];
  accepted_ids: string[];
  dismissed_ids: string[];
  conversation_count: number;
  message_count: number;
  created_at: string;
}

export function usePromptAnalysisHistory(agentId: string | undefined) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["prompt_analyses", agentId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilot_prompt_analyses" as any)
        .select("*")
        .eq("agent_id", agentId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as PromptAnalysis[];
    },
    enabled: !!agentId && !!organizationId,
  });
}

export function useRunPromptAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("analyze-copilot-prompt", {
        body: { agent_id: agentId },
      });

      if (res.error) throw res.error;
      const body = res.data as any;

      if (body.error === "rate_limited") {
        throw new Error(`rate_limited:${body.next_available_at}`);
      }
      if (body.error === "insufficient_data") {
        throw new Error(`insufficient_data:${body.min_required}:${body.found}`);
      }
      if (body.error) throw new Error(body.error);

      return body as {
        analysis_id: string;
        suggestions: PromptSuggestion[];
        conversation_count: number;
        message_count: number;
      };
    },
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", agentId] });
    },
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      analysisId,
      suggestion,
      agentId,
    }: {
      analysisId: string;
      suggestion: PromptSuggestion;
      agentId: string;
    }) => {
      // 1. Fetch current agent data
      const { data: agent, error: fetchErr } = await supabase
        .from("copilot_agents")
        .select("conversation_style, business_context")
        .eq("id", agentId)
        .single();
      if (fetchErr || !agent) throw fetchErr ?? new Error("Agent not found");

      const conversationStyle = (agent.conversation_style ?? {}) as Record<string, any>;
      const businessContext = (agent.business_context ?? {}) as Record<string, any>;

      // 2. Apply patch based on section
      if (["personality", "objective", "flow", "products", "instructions"].includes(suggestion.section)) {
        const promptSections = conversationStyle.promptSections ?? {};
        if (suggestion.type === "remove") {
          promptSections[suggestion.field] = "";
        } else {
          promptSections[suggestion.field] = suggestion.suggested_text;
        }
        conversationStyle.promptSections = promptSections;

        const { error } = await supabase
          .from("copilot_agents")
          .update({
            conversation_style: conversationStyle,
            system_prompt_version: (agent as any).system_prompt_version
              ? (agent as any).system_prompt_version + 1
              : 1,
          } as any)
          .eq("id", agentId);
        if (error) throw error;
      } else if (suggestion.section === "business_context") {
        if (suggestion.type === "remove") {
          delete businessContext[suggestion.field];
        } else {
          businessContext[suggestion.field] = suggestion.suggested_text;
        }
        const { error } = await supabase
          .from("copilot_agents")
          .update({ business_context: businessContext } as any)
          .eq("id", agentId);
        if (error) throw error;
      } else if (suggestion.section === "conversation_style") {
        if (suggestion.type === "remove") {
          delete conversationStyle[suggestion.field];
        } else {
          conversationStyle[suggestion.field] = suggestion.suggested_text;
        }
        const { error } = await supabase
          .from("copilot_agents")
          .update({ conversation_style: conversationStyle } as any)
          .eq("id", agentId);
        if (error) throw error;
      }

      // 3. Mark suggestion as accepted in analysis record
      const { data: analysis } = await supabase
        .from("copilot_prompt_analyses" as any)
        .select("accepted_ids")
        .eq("id", analysisId)
        .single();
      const currentAccepted = (analysis as any)?.accepted_ids ?? [];
      await supabase
        .from("copilot_prompt_analyses" as any)
        .update({ accepted_ids: [...currentAccepted, suggestion.id] })
        .eq("id", analysisId);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", vars.agentId] });
      qc.invalidateQueries({ queryKey: ["copilot_agents"] });
      qc.invalidateQueries({ queryKey: ["copilot_agent_for_edit"] });
    },
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      analysisId,
      suggestionId,
      agentId,
    }: {
      analysisId: string;
      suggestionId: string;
      agentId: string;
    }) => {
      const { data: analysis } = await supabase
        .from("copilot_prompt_analyses" as any)
        .select("dismissed_ids")
        .eq("id", analysisId)
        .single();
      const currentDismissed = (analysis as any)?.dismissed_ids ?? [];
      await supabase
        .from("copilot_prompt_analyses" as any)
        .update({ dismissed_ids: [...currentDismissed, suggestionId] })
        .eq("id", analysisId);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", vars.agentId] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePromptAnalysis.ts
git commit -m "feat: add usePromptAnalysis hook (query + mutations)"
```

---

## Task 4: Suggestion Card Component

**Files:**
- Create: `src/components/copilot/playground/PromptAnalysisSuggestionCard.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Check, X, ChevronDown, MessageSquare } from "lucide-react";
import type { PromptSuggestion } from "@/hooks/usePromptAnalysis";

const SECTION_LABELS: Record<string, string> = {
  personality: "Personalidade",
  objective: "Objetivo",
  flow: "Fluxo",
  products: "Produtos",
  instructions: "Instruções",
  business_context: "Contexto de Negócio",
  conversation_style: "Estilo de Conversa",
};

const TYPE_LABELS: Record<string, string> = {
  add: "Adicionar",
  rewrite: "Reescrever",
  remove: "Remover",
};

interface Props {
  suggestion: PromptSuggestion;
  isAccepted: boolean;
  isDismissed: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  isApplying: boolean;
}

export function PromptAnalysisSuggestionCard({
  suggestion,
  isAccepted,
  isDismissed,
  onAccept,
  onDismiss,
  isApplying,
}: Props) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  if (isDismissed) return null;

  const confidencePercent = Math.round(suggestion.confidence * 100);

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-colors ${
        isAccepted
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/50 bg-card"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {SECTION_LABELS[suggestion.section] ?? suggestion.section}
          </Badge>
          <Badge
            variant="secondary"
            className={`text-xs ${
              suggestion.type === "add"
                ? "bg-blue-500/10 text-blue-400"
                : suggestion.type === "remove"
                  ? "bg-red-500/10 text-red-400"
                  : "bg-amber-500/10 text-amber-400"
            }`}
          >
            {TYPE_LABELS[suggestion.type] ?? suggestion.type}
          </Badge>
          {isAccepted && (
            <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
              Aplicada
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {confidencePercent}%
        </span>
      </div>

      {/* Reason */}
      <p className="text-sm text-muted-foreground">{suggestion.reason}</p>

      {/* Diff */}
      {suggestion.current_text && suggestion.type !== "add" && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs font-medium text-red-400 mb-1">Atual</p>
          <p className="text-sm whitespace-pre-wrap">{suggestion.current_text}</p>
        </div>
      )}
      {suggestion.suggested_text && suggestion.type !== "remove" && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-400 mb-1">Sugerido</p>
          <p className="text-sm whitespace-pre-wrap">{suggestion.suggested_text}</p>
        </div>
      )}

      {/* Evidence */}
      {suggestion.evidence.length > 0 && (
        <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <MessageSquare className="w-3 h-3" />
            Ver evidências ({suggestion.evidence.length} conversa{suggestion.evidence.length > 1 ? "s" : ""})
            <ChevronDown
              className={`w-3 h-3 transition-transform ${evidenceOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {suggestion.evidence.map((e, i) => (
              <p
                key={i}
                className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5"
              >
                {e}
              </p>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Actions */}
      {!isAccepted && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="text-muted-foreground"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Ignorar
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            disabled={isApplying}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            {isApplying ? "Aplicando..." : "Aplicar"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/copilot/playground/PromptAnalysisSuggestionCard.tsx
git commit -m "feat: add PromptAnalysisSuggestionCard component"
```

---

## Task 5: Analysis Tab Component

**Files:**
- Create: `src/components/copilot/playground/PromptAnalysisTab.tsx`

- [ ] **Step 1: Create tab component**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  useRunPromptAnalysis,
  usePromptAnalysisHistory,
  useAcceptSuggestion,
  useDismissSuggestion,
  type PromptSuggestion,
} from "@/hooks/usePromptAnalysis";
import { PromptAnalysisSuggestionCard } from "./PromptAnalysisSuggestionCard";

interface Props {
  agentId: string | undefined;
}

export function PromptAnalysisTab({ agentId }: Props) {
  const [activeSuggestions, setActiveSuggestions] = useState<PromptSuggestion[] | null>(null);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ conversations: number; messages: number } | null>(null);

  const runAnalysis = useRunPromptAnalysis();
  const history = usePromptAnalysisHistory(agentId);
  const acceptMutation = useAcceptSuggestion();
  const dismissMutation = useDismissSuggestion();

  const latestAnalysis = history.data?.[0];
  const acceptedIds = new Set(latestAnalysis?.accepted_ids ?? []);
  const dismissedIds = new Set(latestAnalysis?.dismissed_ids ?? []);

  const currentSuggestions = activeSuggestions ?? latestAnalysis?.suggestions ?? [];
  const currentAnalysisId = activeAnalysisId ?? latestAnalysis?.id ?? null;
  const currentStats = stats ?? (latestAnalysis ? {
    conversations: latestAnalysis.conversation_count,
    messages: latestAnalysis.message_count,
  } : null);

  const visibleSuggestions = currentSuggestions.filter((s) => !dismissedIds.has(s.id));
  const appliedCount = currentSuggestions.filter((s) => acceptedIds.has(s.id)).length;

  const handleAnalyze = async () => {
    if (!agentId) return;
    try {
      const result = await runAnalysis.mutateAsync(agentId);
      setActiveSuggestions(result.suggestions);
      setActiveAnalysisId(result.analysis_id);
      setStats({ conversations: result.conversation_count, messages: result.message_count });

      if (result.suggestions.length === 0) {
        toast.success("Nenhuma sugestao encontrada — o prompt esta bem configurado!");
      } else {
        toast.success(`${result.suggestions.length} sugestoes encontradas`);
      }
    } catch (err: any) {
      const msg = err.message ?? "";
      if (msg.startsWith("rate_limited:")) {
        const nextAt = new Date(msg.split(":")[1]);
        const hours = Math.ceil((nextAt.getTime() - Date.now()) / 3600_000);
        toast.error(`Limite atingido. Proxima analise disponivel em ${hours}h.`);
      } else if (msg.startsWith("insufficient_data:")) {
        const [, min, found] = msg.split(":");
        toast.error(`Conversas insuficientes: ${found} encontradas, minimo ${min}.`);
      } else {
        toast.error("Erro ao analisar conversas.");
      }
    }
  };

  const handleAccept = (suggestion: PromptSuggestion) => {
    if (!currentAnalysisId || !agentId) return;
    acceptMutation.mutate(
      { analysisId: currentAnalysisId, suggestion, agentId },
      {
        onSuccess: () => {
          toast.success(`Sugestao aplicada na secao ${suggestion.section}`);
        },
        onError: () => {
          toast.error("Erro ao aplicar sugestao.");
        },
      },
    );
  };

  const handleDismiss = (suggestion: PromptSuggestion) => {
    if (!currentAnalysisId || !agentId) return;
    dismissMutation.mutate({
      analysisId: currentAnalysisId,
      suggestionId: suggestion.id,
      agentId,
    });
  };

  // No agent yet (creating new)
  if (!agentId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm">Salve o agente primeiro para poder analisar conversas.</p>
      </div>
    );
  }

  // Loading analysis
  if (runAnalysis.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-50" />
        <p className="text-sm font-medium">Analisando conversas...</p>
        <p className="text-xs mt-1">Isso pode levar de 5 a 15 segundos.</p>
      </div>
    );
  }

  // Has results
  if (currentSuggestions.length > 0 && currentAnalysisId) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">
              {visibleSuggestions.length} sugestao{visibleSuggestions.length !== 1 ? "es" : ""}
              {appliedCount > 0 && (
                <span className="text-emerald-400 ml-1">
                  — {appliedCount} aplicada{appliedCount !== 1 ? "s" : ""}
                </span>
              )}
            </h3>
            {currentStats && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Baseado em {currentStats.conversations} conversas ({currentStats.messages} mensagens)
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAnalyze}
            disabled={runAnalysis.isPending}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Nova analise
          </Button>
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {visibleSuggestions.map((s) => (
            <PromptAnalysisSuggestionCard
              key={s.id}
              suggestion={s}
              isAccepted={acceptedIds.has(s.id)}
              isDismissed={dismissedIds.has(s.id)}
              onAccept={() => handleAccept(s)}
              onDismiss={() => handleDismiss(s)}
              isApplying={acceptMutation.isPending && acceptMutation.variables?.suggestion.id === s.id}
            />
          ))}
        </div>

        {visibleSuggestions.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Todas sugestoes foram aplicadas ou ignoradas.
          </p>
        )}
      </div>
    );
  }

  // Idle state — no analysis yet or empty results
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 mb-4">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-sm font-medium mb-1">Analise de conversas</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-6">
        Analise as conversas recentes do copilot para receber sugestoes de melhoria no prompt.
        Usa as ultimas 50 conversas dos ultimos 7 dias.
      </p>
      <Button onClick={handleAnalyze} disabled={runAnalysis.isPending}>
        <Sparkles className="w-4 h-4 mr-2" />
        Analisar conversas
      </Button>

      {/* History */}
      {latestAnalysis && (
        <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Ultima analise: {new Date(latestAnalysis.created_at).toLocaleDateString("pt-BR")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/copilot/playground/PromptAnalysisTab.tsx
git commit -m "feat: add PromptAnalysisTab component"
```

---

## Task 6: Integrate Tab in CopilotPlayground

**Files:**
- Modify: `src/components/copilot/playground/CopilotPlayground.tsx`

- [ ] **Step 1: Add import**

At the top of CopilotPlayground.tsx, add alongside existing lucide imports:

```typescript
import { Sparkles } from "lucide-react";
```

Add lazy import for the tab:

```typescript
import { PromptAnalysisTab } from "./PromptAnalysisTab";
```

- [ ] **Step 2: Add editId variable access**

Verify `editId` is already available (it is — used in handleSave at line 385). The tab will receive it as prop.

- [ ] **Step 3: Change grid-cols-3 to grid-cols-4 and add tab trigger**

Replace the TabsList line:

```tsx
<TabsList className="grid w-full grid-cols-3 rounded-none border-b bg-background h-11 shrink-0">
```

with:

```tsx
<TabsList className="grid w-full grid-cols-4 rounded-none border-b bg-background h-11 shrink-0">
```

After the "knowledge" TabsTrigger (line 543), add:

```tsx
              <TabsTrigger value="analysis" className="gap-2 data-[state=active]:bg-muted/50">
                <Sparkles className="w-4 h-4" />
                Análise
              </TabsTrigger>
```

- [ ] **Step 4: Add TabsContent for analysis**

After the knowledge TabsContent closing tag (line 588), add:

```tsx
            <TabsContent value="analysis" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PromptAnalysisTab agentId={editId ?? undefined} />
            </TabsContent>
```

- [ ] **Step 5: Build check**

```bash
npm run build
```

Expected: success with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/copilot/playground/CopilotPlayground.tsx
git commit -m "feat: integrate Análise tab in CopilotPlayground"
```

---

## Task 7: Deploy Edge Function + Smoke Test

- [ ] **Step 1: Deploy edge function**

```bash
supabase functions deploy analyze-copilot-prompt --project-ref jsjsmuncfkbsbzqzqhfq
```

- [ ] **Step 2: Verify GEMINI_API_KEY is set**

Check Supabase secrets include `GEMINI_API_KEY` (already used by embeddings.ts).

- [ ] **Step 3: Test via browser**

1. Open app in browser
2. Go to Copilot → edit an existing agent
3. Click "Análise" tab
4. Click "Analisar conversas"
5. Verify: loading state → results (or insufficient_data message)
6. If results: test Accept on one suggestion, verify toast + badge
7. If results: test Ignore on one suggestion, verify card hides

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: copilot prompt analyzer — complete feature"
```
