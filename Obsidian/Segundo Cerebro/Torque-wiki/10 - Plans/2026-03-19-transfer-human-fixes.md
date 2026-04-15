---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-19-transfer-human-fixes.md
---

# Transfer Human Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 problems in the Copilot transfer_to_human flow and add a "waiting for human" chat filter.

**Architecture:** Hybrid approach - immediate inline execution of ai_disabled + WAITING_HUMAN state change in agent-engine, with async queue for side-effects (notification + lead_history). New `sent_by_ai` column on whatsapp_messages for Copilot vs human distinction. Frontend badges, inline timeline events, and a chat filter for WAITING_HUMAN conversations.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), React + TanStack Query, Supabase Realtime, Tailwind CSS, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-03-19-transfer-human-fixes-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260319100000_add_sent_by_ai_to_whatsapp_messages.sql` | Create | Add `sent_by_ai` boolean column + partial index |
| `supabase/functions/_shared/ai-action-executor.ts` | Modify | Add `immediateTransferHuman()`, `executeTransferHumanNotify()`, update history mapping + router |
| `supabase/functions/agent-message/agent-engine.ts` | Modify | Call `immediateTransferHuman` inline, bypass enqueue for TRANSFER_HUMAN, inject handoff context in prompt |
| `supabase/functions/evolution-webhook/index.ts` | Modify | Add `sent_by_ai: true` to AI message INSERTs (~1164, ~1212) |
| `src/hooks/useConversationHistory.ts` | Modify | Add `sent_by_ai` to message types, fetch `lead_history` transfer events, return unified timeline |
| `src/hooks/useLeads.ts` | Modify | Reset `conversations.state` on AI reactivation, insert `lead_history` |
| `src/components/chat/WhatsAppChat.tsx` | Modify | Badge, sender label, transfer event card, "Aguardando humano" filter |

---

## Task 1: Migration - `sent_by_ai` column

**Files:**
- Create: `supabase/migrations/20260319100000_add_sent_by_ai_to_whatsapp_messages.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add sent_by_ai flag to distinguish Copilot messages from human messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by_ai BOOLEAN DEFAULT false;

-- Partial index: only index the few AI messages for efficient filtering
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_by_ai
  ON public.whatsapp_messages(sent_by_ai) WHERE sent_by_ai = true;
```

- [ ] **Step 2: Verify migration syntax**

Run: `grep -c "sent_by_ai" supabase/migrations/20260319100000_add_sent_by_ai_to_whatsapp_messages.sql`
Expected: 3 (one ALTER, one in CREATE INDEX name, one in WHERE clause)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260319100000_add_sent_by_ai_to_whatsapp_messages.sql
git commit -m "feat(db): add sent_by_ai column to whatsapp_messages"
```

---

## Task 2: Backend - `immediateTransferHuman` + `executeTransferHumanNotify`

**Files:**
- Modify: `supabase/functions/_shared/ai-action-executor.ts`

Context: This file has a `HISTORY_MAP` at lines 39-118, a main `executeAiAction` router switch at lines 131-171, and `executeTransferHuman` at lines 493-516. The generic history logging at lines 173-200 handles lead_history inserts using the HISTORY_MAP.

- [ ] **Step 1: Add `immediateTransferHuman` export function**

Add after the existing imports (before `HISTORY_MAP`), approximately line 35:

```typescript
/**
 * Immediate transfer: sets ai_disabled + WAITING_HUMAN synchronously.
 * Called inline from agent-engine before enqueueing side-effects.
 * Does NOT create notifications or lead_history (that's the queue's job).
 */
export async function immediateTransferHuman(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error: leadError } = await supabase
      .from("leads")
      .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
      .eq("id", leadId);

    if (leadError) {
      console.warn("[immediateTransferHuman] Failed to update lead:", leadError.message);
      return { success: false, error: leadError.message };
    }

    const { error: convError } = await supabase
      .from("conversations")
      .update({ state: "WAITING_HUMAN" })
      .eq("lead_id", leadId);

    if (convError) {
      console.warn("[immediateTransferHuman] Failed to update conversation:", convError.message);
      // Lead is already disabled - don't fail completely
    }

    console.log("[immediateTransferHuman] Transfer executed immediately for lead:", leadId);
    return { success: true };
  } catch (err) {
    console.warn("[immediateTransferHuman] Unexpected error:", err);
    return { success: false, error: String(err) };
  }
}
```

- [ ] **Step 2: Add `transfer_to_human_notify` to HISTORY_MAP**

In the `HISTORY_MAP` object (after line 63, the existing `transfer_to_human` entry):

```typescript
  transfer_to_human_notify: {
    action: "ai_toggled",
    descriptionFn: (p) => `Copilot transferiu: ${p.reason || "sem motivo informado"}`,
    source: "agent",
  },
```

- [ ] **Step 3: Add `executeTransferHumanNotify` function**

Add after `executeTransferHuman` (after line 516):

```typescript
/**
 * Side-effects only: notification + lead_history (via generic logger).
 * The actual ai_disabled + WAITING_HUMAN was already set by immediateTransferHuman.
 */
async function executeTransferHumanNotify(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  const reason = (params.reason as string) || "sem motivo informado";

  // Fetch lead for notification content and responsible_id
  const { data: lead } = await supabase
    .from("leads")
    .select("name, company, responsible_id")
    .eq("id", leadId)
    .single();

  const leadLabel = lead?.name
    ? lead.company ? `${lead.name} - ${lead.company}` : lead.name
    : "Lead";

  // Determine who to notify
  let notifyUserIds: string[] = [];

  if (lead?.responsible_id) {
    // Responsible exists - resolve to user_id via team_members
    const { data: member } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("id", lead.responsible_id)
      .not("user_id", "is", null)
      .single();

    if (member?.user_id) {
      notifyUserIds = [member.user_id];
    }
  }

  if (notifyUserIds.length === 0) {
    // No responsible or no user_id - notify all active team members in org
    const { data: members } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("user_id", "is", null);

    notifyUserIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  }

  // Create notifications
  for (const userId of notifyUserIds) {
    try {
      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: userId,
        type: "transfer_to_human",
        title: "Lead precisa de atendimento humano",
        description: `${leadLabel}: ${reason}`,
        lead_id: leadId,
        link: "/pipe-whatsapp",
      });
    } catch (notifErr) {
      console.warn("[executeTransferHumanNotify] Failed to create notification:", notifErr);
    }
  }

  console.log(`[executeTransferHumanNotify] Notified ${notifyUserIds.length} user(s) for lead ${leadId}`);
  return { success: true, message: `Notificação enviada para ${notifyUserIds.length} usuário(s)` };
}
```

Note: This function does NOT insert lead_history itself. The lead_history entry is created automatically by the generic logging mechanism in `executeAiAction` (lines 173-200), which reads from `ACTION_HISTORY_MAP` after the action returns `{ success: true }`. Do NOT add duplicate logging inside this function.

- [ ] **Step 4: Add `transfer_to_human_notify` to router switch**

In `executeAiAction`, add a new case after line 145 (`case "transfer_to_human"`):

```typescript
    case "transfer_to_human_notify":
      result = await executeTransferHumanNotify(supabase, payload, organization_id, lead_id);
      break;
```

- [ ] **Step 5: Verify no TypeScript errors**

Run: `cd supabase/functions && deno check _shared/ai-action-executor.ts 2>&1 | head -20`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai-action-executor.ts
git commit -m "feat(copilot): add immediateTransferHuman and transfer_to_human_notify handler"
```

---

## Task 3: Backend - Immediate transfer in agent-engine + idempotency fix

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

Context: `processMessage()` starts at line 63. After `processLLMResponse()` at line 200, actions are enqueued at line 228 via `enqueueToolAction()`. `buildIdempotencyKey` is at line 2452. Import of `enqueueAiAction` is at line 3.

- [ ] **Step 1: Add import for `immediateTransferHuman`**

At line 3 (after the `enqueueAiAction` import), add:

```typescript
import { immediateTransferHuman } from "../_shared/ai-action-executor.ts";
```

- [ ] **Step 2: Add immediate transfer block in processMessage**

Between the `needsLeadId` injection block (lines 219-225) and the `enqueueToolAction` call (line 228), add the immediate transfer logic. Replace lines 226-232 (keep line 233 which is the closing `}` of the `if (actionToExecute)` block) with:

```typescript
      console.log('[AgentEngine] Step 9: Enqueuing action:', actionToExecute.action);
      try {
        // TRANSFER_HUMAN: execute immediately, enqueue only side-effects
        if (actionToExecute.action === 'TRANSFER_HUMAN') {
          const transferResult = await immediateTransferHuman(this.supabase, this.currentLeadId!);
          if (!transferResult.success) {
            console.warn('[AgentEngine] Immediate transfer failed, will rely on queue:', transferResult.error);
          }
          // Enqueue notification + lead_history only (no db state change)
          const minuteTs = Math.floor(Date.now() / 60_000);
          await enqueueAiAction(this.supabase, {
            organizationId: this.organizationId,
            leadId: this.currentLeadId || undefined,
            conversationId: conversation.id.startsWith('temp_') ? undefined : conversation.id,
            actionType: 'transfer_to_human_notify',
            payload: { ...actionToExecute.params, lead_id: this.currentLeadId },
            idempotencyKey: `transfer_human_notify_${this.currentLeadId}_${minuteTs}`,
          });
          executionResult = { success: true, queued: true, immediate: true };
        } else {
          executionResult = await this.enqueueToolAction(actionToExecute, conversation.id);
        }
      } catch (enqueueError) {
        console.warn('[AgentEngine] Action enqueue failed (non-fatal):', enqueueError);
        executionResult = { error: String(enqueueError), status: 'failed' };
      }
```

This ensures:
- `immediateTransferHuman` runs inline (zero latency)
- Only `transfer_to_human_notify` is enqueued (for notification + lead_history)
- `enqueueToolAction` is skipped for TRANSFER_HUMAN
- All subsequent steps (updateConversationState, logDecision, enqueueAutomationActions) still run normally

- [ ] **Step 3: Fix idempotency key for transfer_to_human_notify**

In `buildIdempotencyKey()` (line 2452), add a case for the new action type. After the `transfer_to_human` case at line 2458, add:

```typescript
      case 'transfer_to_human_notify':
        return `transfer_human_notify_${leadId}_${ts}`;
```

Note: The existing `transfer_to_human` case (line 2457-2458) is now dead code for the agent-engine path but still used by webhook-orchestrator. Keep it.

- [ ] **Step 4: Verify no TypeScript errors**

Run: `cd supabase/functions && deno check agent-message/agent-engine.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "feat(copilot): execute transfer_human immediately, bypass async queue for state change"
```

---

## Task 4: Backend - Handoff context injection in agent prompt

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

Context: The dynamic capabilities section in the prompt builder starts at line 1610. The method that builds `sections[]` has access to `this.supabase`, `leadId`, and `conversation`.

- [ ] **Step 1: Add handoff context injection**

Before the dynamic capabilities block (before line 1610), add:

```typescript
    // =====================================================
    // 1.5. CONTEXTO DE INTERVENÇÃO HUMANA RECENTE
    // =====================================================
    try {
      const { data: recentTransfer } = await this.supabase
        .from("lead_history")
        .select("metadata, created_at")
        .eq("lead_id", leadId)
        .eq("action", "ai_toggled")
        .not("metadata", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentTransfer) {
        const transferTime = new Date(recentTransfer.created_at);
        const minutesAgo = Math.round((Date.now() - transferTime.getTime()) / 60_000);
        const metadata = recentTransfer.metadata as Record<string, unknown>;
        const reason = metadata?.reason as string;

        // Only inject context if transfer was within last 24h and has a reason (copilot-initiated)
        if (minutesAgo < 1440 && reason) {
          sections.push("");
          sections.push("# CONTEXTO IMPORTANTE");
          sections.push(`Esta conversa foi transferida para um vendedor humano há ${minutesAgo} minutos.`);
          sections.push(`Motivo original da transferência: ${reason}`);
          sections.push("O vendedor interveio e devolveu a conversa para você.");
          sections.push("Continue naturalmente, sem repetir perguntas já feitas.");
          sections.push("");
        }
      }
    } catch (e) {
      console.warn("[AgentEngine] Failed to check recent handoff (non-fatal):", e);
    }
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd supabase/functions && deno check agent-message/agent-engine.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "feat(copilot): inject human handoff context into agent prompt"
```

---

## Task 5: Backend - `sent_by_ai: true` in evolution-webhook

**Files:**
- Modify: `supabase/functions/evolution-webhook/index.ts`

Context: Two INSERT sites for AI-generated messages:
- Line 1164: TTS audio response
- Line 1212: Text response

- [ ] **Step 1: Add `sent_by_ai: true` to TTS INSERT**

At line 1175 (before the closing `});` of the first INSERT), add the field:

```typescript
                        timestamp: new Date().toISOString(),
                        sent_by_ai: true,
```

- [ ] **Step 2: Add `sent_by_ai: true` to text INSERT**

At line 1222 (before the closing `});` of the second INSERT), add the field:

```typescript
                  timestamp: new Date().toISOString(),
                  sent_by_ai: true,
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd supabase/functions && deno check evolution-webhook/index.ts 2>&1 | head -20`
Expected: No errors (or pre-existing warnings only)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/evolution-webhook/index.ts
git commit -m "feat(copilot): mark AI-generated whatsapp messages with sent_by_ai flag"
```

---

## Task 6: Frontend - Add `sent_by_ai` to WhatsApp message type

**Files:**
- Modify: `src/hooks/useWhatsAppChat.ts`

Context: The chat component (`WhatsAppChat.tsx`) gets its messages from `useWhatsAppMessages` in this file, NOT from `useConversationHistory`. The `WhatsAppMessage` interface (lines 7-23) is the type used by `MessageBubble`. The query at line 344 uses an **explicit column list** (not `select("*")`), so `sent_by_ai` must be added to the select string too.

- [ ] **Step 1: Add `sent_by_ai` to WhatsAppMessage interface**

In the `WhatsAppMessage` interface (after line 22, `created_at`), add:

```typescript
  /** Whether this message was sent by the Copilot AI agent */
  sent_by_ai: boolean | null;
```

- [ ] **Step 2: Add `sent_by_ai` to the select column list in `useWhatsAppMessages`**

At line 344, the select string is:

```typescript
.select("id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, push_name, status, lead_id, timestamp, created_at")
```

Add `sent_by_ai` to the end:

```typescript
.select("id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, push_name, status, lead_id, timestamp, created_at, sent_by_ai")
```

- [ ] **Step 3: Add `sent_by_ai` to optimistic update objects**

In `useSendWhatsAppMessage` (line 478-494), add `sent_by_ai: false` to the `optimisticMsg` object:

```typescript
      const optimisticMsg: WhatsAppMessage = {
        // ... existing fields ...
        created_at: new Date().toISOString(),
        sent_by_ai: false,
      };
```

In `useSendWhatsAppMedia` (line 684-700), add the same:

```typescript
      const optimisticMsg: WhatsAppMessage = {
        // ... existing fields ...
        created_at: new Date().toISOString(),
        sent_by_ai: false,
      };
```

- [ ] **Step 4: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/hooks/useWhatsAppChat.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWhatsAppChat.ts
git commit -m "feat(chat): add sent_by_ai field to WhatsAppMessage interface and queries"
```

---

## Task 7: Frontend - Toggle reset + lead_history on reactivation

**Files:**
- Modify: `src/hooks/useLeads.ts`

Context: `useToggleLeadAI` at lines 454-604. The `mutationFn` (lines 459-481) updates leads table. The hook has access to `supabase` and `organizationId`.

- [ ] **Step 1: Add conversation reset and lead_history on reactivation**

In the `mutationFn` (after the lead UPDATE at line 478, before `if (error) throw error`), add:

```typescript
      // When reactivating AI: reset conversation state and log
      if (!disabled) {
        // Reset conversation state from WAITING_HUMAN to QUALIFYING
        await supabase
          .from("conversations")
          .update({ state: "QUALIFYING" })
          .eq("lead_id", leadId);

        // Log reactivation in lead_history
        await supabase.from("lead_history").insert({
          lead_id: leadId,
          action: "ai_reactivated",
          description: "IA Copilot reativada pelo vendedor",
          source: "manual",
          metadata: { reactivated_by: user?.id },
        });
      }
```

Note: The conversations UPDATE may silently fail for non-admin users without RLS permission - this is acceptable per spec (ai_disabled toggle still works, agent handles gracefully on next message).

- [ ] **Step 2: Also invalidate conversation-history queries on toggle**

In the `onSuccess` callback (line 594), add after the existing invalidations:

```typescript
      // Invalidate conversation data so badge/timeline updates
      queryClient.invalidateQueries({ queryKey: ["conversation-history", variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-human-leads"], refetchType: 'active' });
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/hooks/useLeads.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLeads.ts
git commit -m "feat(copilot): reset conversation state and log on AI reactivation"
```

---

## Task 8: Frontend - Badge, sender label, transfer card, and filter in WhatsAppChat

**Files:**
- Modify: `src/components/chat/WhatsAppChat.tsx`

This is the largest frontend task. It has 4 sub-changes.

**CRITICAL context:** The chat component uses `useWhatsAppMessages` from `useWhatsAppChat.ts` for its messages (line 1325), NOT `useConversationHistory`. The `WhatsAppMessage` type is from `useWhatsAppChat.ts`. The `MessageBubble` component (line 1017) takes `message: WhatsAppMessage`.

Existing imports already include: `Bot` (line 28), `Badge` (line 43), `useQueryClient` (line 3).
Missing imports needed: `UserPlus`, `useQuery`, `supabase`.

The `ChatWindow` component (line ~1290) receives props: `phoneNumber`, `instanceId`, `instanceName`, `leadId`, `hasLead`, `leadAiDisabled`, `selectedContact`. The `ContactList` component (line ~225) receives filter-related props from parent.

- [ ] **Step 1: Add missing imports**

At the top of the file, update the lucide-react import (line 5-38) to include `UserPlus`:

```typescript
import { UserPlus } from "lucide-react";
```

Add `useQuery` to the react-query import (line 3):

```typescript
import { useQueryClient, useQuery } from "@tanstack/react-query";
```

Add `supabase` import:

```typescript
import { supabase } from "@/integrations/supabase/client";
```

- [ ] **Step 2: Add conversation state query and WAITING_HUMAN badge in ChatWindow**

Inside the `ChatWindow` component (after line 1325 where `useWhatsAppMessages` is called), add:

```typescript
  // Fetch conversation state for transfer badge
  const { data: conversationState } = useQuery({
    queryKey: ['conversation-state', leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data } = await supabase
        .from('conversations')
        .select('state')
        .eq('lead_id', leadId)
        .maybeSingle();
      return data?.state ?? null;
    },
    enabled: !!leadId,
  });

  const isWaitingHuman = conversationState === 'WAITING_HUMAN';
```

Then after the AI toggle `motion.div` closing tag (after line 1603), add the badge:

```tsx
        {/* Transfer / AI state badge */}
        {hasLead && leadId && isWaitingHuman && (
          <Badge variant="outline" className="border-amber-400 text-amber-600 gap-1.5 text-xs">
            <UserPlus className="h-3 w-3" />
            Aguardando humano
          </Badge>
        )}
        {hasLead && leadId && currentAiDisabled && !isWaitingHuman && (
          <Badge variant="outline" className="text-muted-foreground gap-1.5 text-xs">
            IA desativada
          </Badge>
        )}
```

- [ ] **Step 3: Add sender label to MessageBubble**

The `MessageBubble` component (line 1017) already receives `message: WhatsAppMessage`. After Task 6, `WhatsAppMessage` now includes `sent_by_ai: boolean | null`. No type change needed.

Inside the component, after line 1044 (after the opening of the bubble `div` with the styling), add the sender label before the text content (before line 1047 `{/* Texto / Legenda */}`):

```tsx
        {/* Sender label for AI messages */}
        {isOutgoing && message.sent_by_ai && (
          <div className="flex items-center gap-1 mb-1">
            <Bot className="h-3 w-3 text-primary-foreground/70" />
            <span className="text-[10px] text-primary-foreground/70 font-medium">Copilot</span>
          </div>
        )}
```

- [ ] **Step 4: Fetch and render transfer events inline in chat**

Inside `ChatWindow`, add a query for transfer events (near the `conversationState` query):

```typescript
  // Fetch transfer events for inline timeline cards
  const { data: transferEvents = [] } = useQuery({
    queryKey: ['transfer-events', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data } = await supabase
        .from('lead_history')
        .select('id, metadata, created_at')
        .eq('lead_id', leadId)
        .eq('action', 'ai_toggled')
        .not('metadata', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data ?? [])
        .filter((e: any) => (e.metadata as Record<string, unknown>)?.reason)
        .map((e: any) => ({
          id: e.id,
          type: 'transfer_event' as const,
          reason: ((e.metadata as Record<string, unknown>)?.reason as string) || '',
          timestamp: e.created_at,
        }));
    },
    enabled: !!leadId,
  });
```

Then in the messages rendering loop (line 1626), replace the `messages.map` with a merged timeline that interleaves transfer events:

```tsx
                {(() => {
                  // Merge messages + transfer events, sorted by timestamp
                  const timeline = [
                    ...messages.map(m => ({ ...m, _type: 'message' as const })),
                    ...transferEvents.map(e => ({ ...e, _type: 'transfer' as const })),
                  ].sort((a, b) => {
                    const timeA = new Date(a.timestamp).getTime();
                    const timeB = new Date(b.timestamp).getTime();
                    return timeA - timeB;
                  });

                  let lastDate = "";
                  return timeline.map((item, index) => {
                    // Transfer event card
                    if (item._type === 'transfer') {
                      return (
                        <div key={`transfer-${item.id}`} className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-400 mx-4 my-2 rounded-r">
                          <UserPlus className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Transferido para humano</p>
                            {item.reason && (
                              <p className="text-xs text-amber-700 dark:text-amber-300">{item.reason}</p>
                            )}
                            <p className="text-xs text-amber-500 mt-0.5">
                              {new Date(item.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // Normal message (same logic as existing, with date separators)
                    const message = item;
                    const ts = message?.timestamp;
                    const date = ts ? new Date(ts) : new Date();
                    const validDate = !Number.isNaN(date.getTime());
                    const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
                    const showDateSeparator = msgDate !== lastDate;
                    if (showDateSeparator) lastDate = msgDate;
                    const dateLabel = validDate
                      ? isToday(date)
                        ? "Hoje"
                        : isYesterday(date)
                          ? "Ontem"
                          : format(date, "dd/MM/yyyy", { locale: ptBR })
                      : "";
                    const safeKey = message?.id || `msg-${index}-${ts || index}`;
                    return (
                      <div key={safeKey}>
                        {showDateSeparator && (
                          <div className="flex justify-center py-3">
                            <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                              {dateLabel}
                            </span>
                          </div>
                        )}
                        <MessageBubble
                          message={message}
                          onImagePreview={setPreviewImageUrl}
                        />
                      </div>
                    );
                  });
                })()}
```

This replaces lines 1624-1657 entirely (the existing IIFE that maps messages).

- [ ] **Step 5: Add "Aguardando humano" filter state and query in parent component**

The filter state should live in the parent `WhatsAppChat` component (same level as `showOnlyWithLead`), following the established pattern. The parent component accesses org ID via `teamMember?.organization_id` (line 1830: `const { data: teamMember } = useCurrentTeamMember()`). Find where `showOnlyWithLead` state is defined and add nearby:

```typescript
const [showOnlyWaitingHuman, setShowOnlyWaitingHuman] = useState(false);

// Query for leads waiting for human - used by ContactList filter
const { data: waitingHumanLeadIds } = useQuery({
  queryKey: ['waiting-human-leads', teamMember?.organization_id],
  queryFn: async () => {
    if (!teamMember?.organization_id) return new Set<string>();
    const { data } = await supabase
      .from('conversations')
      .select('lead_id')
      .eq('organization_id', teamMember.organization_id)
      .eq('state', 'WAITING_HUMAN');
    return new Set((data ?? []).map((c: any) => c.lead_id as string));
  },
  enabled: !!teamMember?.organization_id,
  refetchInterval: 30000,
});

const waitingHumanCount = waitingHumanLeadIds?.size ?? 0;
```

Pass these as props to `ContactList`:

```typescript
showOnlyWaitingHuman={showOnlyWaitingHuman}
onToggleShowOnlyWaitingHuman={() => setShowOnlyWaitingHuman(!showOnlyWaitingHuman)}
waitingHumanCount={waitingHumanCount}
waitingHumanLeadIds={waitingHumanLeadIds}
```

- [ ] **Step 6: Add filter toggle UI and filter logic in ContactList**

Update `ContactList` props type (line ~225) to include the new props:

```typescript
  showOnlyWaitingHuman: boolean;
  onToggleShowOnlyWaitingHuman: () => void;
  waitingHumanCount: number;
  waitingHumanLeadIds?: Set<string>;
```

Add the toggle button after the "Com lead" button (after line 338, inside the `flex items-center justify-between` div):

```tsx
          <button
            type="button"
            onClick={onToggleShowOnlyWaitingHuman}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
              showOnlyWaitingHuman
                ? "bg-amber-500/15 text-amber-600 font-medium"
                : "text-muted-foreground hover:bg-muted"
            )}
            title={showOnlyWaitingHuman ? "Mostrando apenas aguardando humano" : "Filtrar aguardando humano"}
          >
            <UserPlus className="w-3 h-3" />
            Humano
            {waitingHumanCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {waitingHumanCount}
              </span>
            )}
          </button>
```

In the `filteredContacts` filter chain (line 258-265), add the waiting human filter:

```typescript
  const filteredContacts = contacts.filter((c) => {
    if (showOnlyWithLead && !c.lead_id) return false;
    if (showOnlyWaitingHuman && !(c.lead_id && waitingHumanLeadIds?.has(c.lead_id))) return false;
    // Filtrar por tab
    if (activeTab === "active" && c.archived_at) return false;
    if (activeTab === "archived" && !c.archived_at) return false;
    return (
      c.phone_number.includes(searchQuery) ||
```

- [ ] **Step 7: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/components/chat/WhatsAppChat.tsx 2>&1 | head -30`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/WhatsAppChat.tsx
git commit -m "feat(chat): add transfer badge, sender labels, transfer cards, and waiting-human filter"
```

---

## Task 9: Deploy

- [ ] **Step 1: Deploy edge functions**

```bash
supabase functions deploy agent-message --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy process-ai-actions --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy evolution-webhook --project-ref jsjsmuncfkbsbzqzqhfq
```

Note: `evolution-webhook` also needs deploy since `sent_by_ai` was added there.

- [ ] **Step 2: Apply migration**

Apply via Supabase dashboard or:
```bash
supabase db push --project-ref jsjsmuncfkbsbzqzqhfq
```

- [ ] **Step 3: Verify deployment**

Check function logs for any startup errors:
```bash
supabase functions logs agent-message --project-ref jsjsmuncfkbsbzqzqhfq | head -20
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: deploy transfer_human fixes"
```

---

## Verification Checklist

After all tasks are complete, verify each criterion:

1. [ ] Agent decides to transfer → `ai_disabled = true` immediately (check DB, no 1min delay)
2. [ ] Same lead can be transferred again after reactivation (idempotency with timestamp)
3. [ ] Badge amber "Aguardando humano" appears in chat when `state = WAITING_HUMAN`
4. [ ] Transfer reason appears as inline amber card in chat timeline
5. [ ] Notification sent to responsible user (or all active team members if none)
6. [ ] AI messages show Bot icon + "Copilot" label, human messages have no label
7. [ ] Toggle AI ON resets `conversations.state` to `QUALIFYING` and logs `ai_reactivated`
8. [ ] "Aguardando humano" filter in chat works with count badge
9. [ ] Agent prompt includes handoff context when resuming after human intervention
10. [ ] TypeScript compiles with 0 errors


## Links relacionados

- [[Chat WhatsApp]]

- [[Visao Geral]]

- [[Analise Logging SaaS]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
