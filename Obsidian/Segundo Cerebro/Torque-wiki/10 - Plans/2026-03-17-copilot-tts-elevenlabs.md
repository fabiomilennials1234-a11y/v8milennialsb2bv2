---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-17-copilot-tts-elevenlabs.md
---

# Copilot TTS via ElevenLabs - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic text-to-speech responses via ElevenLabs to the copilot, so it can reply with voice notes instead of text.

**Architecture:** TTS generation is inline in the `evolution-webhook` flow. After `agent-message` returns a text response, the webhook checks the agent's `tts_config` and optionally generates audio via ElevenLabs, uploading to Storage and sending as a WhatsApp voice note. Falls back to text on failure (10s timeout).

**Tech Stack:** Supabase Edge Functions (Deno), ElevenLabs API, Supabase Storage, Evolution API, React/TypeScript frontend

**Spec:** `docs/superpowers/specs/2026-03-17-copilot-tts-elevenlabs-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260821000000_add_tts_config.sql` | Create | DB migration: tts_config column, elevenlabs_api_key column, RLS |
| `supabase/functions/_shared/tts-elevenlabs.ts` | Create | ElevenLabs TTS: generate audio, upload to Storage, truncation |
| `supabase/functions/elevenlabs-proxy/index.ts` | Create | Proxy for voice listing and cloning (keeps API key server-side) |
| `src/types/copilot.ts` | Modify | Add TtsConfig interface (after OutboundConfig, line ~286) |
| `supabase/functions/agent-message/index.ts` | Modify | Extract incoming_message_type, pass to engine (line 40, 82) |
| `supabase/functions/agent-message/agent-engine.ts` | Modify | Accept incomingMessageType, add audio prompt to system prompt (line 63, 155, 1848) |
| `supabase/functions/evolution-webhook/index.ts` | Modify | Thread messageType, add TTS decision logic after agent response (lines 457, 571, 759, 1024-1079) |
| `src/components/settings/ElevenLabsSettings.tsx` | Create | API key management UI for org settings |
| `src/pages/Configuracoes.tsx` | Modify | Add ElevenLabs tab in integrations (line ~552) |
| `src/components/copilot/AgentTtsSettings.tsx` | Create | TTS configuration panel for agent settings |
| `src/components/copilot/AgentConfigModal.tsx` | Modify | Add TTS tab in agent config modal |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260821000000_add_tts_config.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add TTS config to copilot_agents
ALTER TABLE copilot_agents
ADD COLUMN IF NOT EXISTS tts_config JSONB DEFAULT NULL;

COMMENT ON COLUMN copilot_agents.tts_config IS
'TTS config via ElevenLabs: {provider, voice_id, mode, max_chars, model_id, stability, similarity_boost}. NULL = disabled.';

-- Add ElevenLabs API key to organizations
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT DEFAULT NULL;

-- RLS: Only org admins can read/update the elevenlabs_api_key column.
-- Since RLS operates at row level, we use a security definer function to check admin role
-- and restrict the column in application code (edge functions + frontend).
-- The key is primarily read server-side by edge functions using service_role_key,
-- and saved by the frontend via direct update (restricted to admin role in the component).
-- For additional safety, the elevenlabs-proxy edge function verifies admin role before using the key.
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `cd <repo-root> && npx supabase migration list` (or equivalent local check)
Expected: Migration listed, no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260821000000_add_tts_config.sql
git commit -m "feat(db): add tts_config column to copilot_agents and elevenlabs_api_key to organizations"
```

---

## Task 2: TtsConfig TypeScript Type

**Files:**
- Modify: `src/types/copilot.ts:286` (after CopilotAgentAudio interface)

- [ ] **Step 1: Add TtsConfig interface**

Add after the `CopilotAgentAudio` interface (line ~303) in `src/types/copilot.ts`:

```typescript
/**
 * Configuração de TTS (Text-to-Speech) via ElevenLabs
 * NULL na coluna = feature desabilitada
 */
export interface TtsConfig {
  provider: "elevenlabs";
  voice_id: string;
  mode: "always" | "mirror";
  max_chars: number;
  model_id?: string;
  stability?: number;
  similarity_boost?: number;
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd <repo-root> && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/types/copilot.ts
git commit -m "feat(types): add TtsConfig interface for ElevenLabs TTS"
```

---

## Task 3: TTS ElevenLabs Shared Module

**Files:**
- Create: `supabase/functions/_shared/tts-elevenlabs.ts`

- [ ] **Step 1: Create the module**

Create `supabase/functions/_shared/tts-elevenlabs.ts`:

```typescript
/**
 * ElevenLabs TTS - generate audio from text and upload to Supabase Storage.
 *
 * Used by evolution-webhook to convert copilot responses to voice notes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "./logger.ts";

export interface TtsRequest {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  apiKey: string;
  outputFormat?: string;
}

export interface TtsResult {
  success: boolean;
  audioUrl?: string;
  durationMs?: number;
  charCount?: number;
  error?: string;
}

const TTS_TIMEOUT_MS = 10_000;
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_22050_32";
const DEFAULT_STABILITY = 0.5;
const DEFAULT_SIMILARITY_BOOST = 0.75;

/**
 * Truncates text at the last complete sentence before maxChars.
 * Falls back to hard cut at maxChars if no sentence boundary found.
 */
export function truncateForTts(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?")
  );

  if (lastSentenceEnd > maxChars * 0.3) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  // No good sentence boundary - hard cut at last space
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace).trim() + "..." : truncated.trim() + "...";
}

/**
 * Generates audio from text via ElevenLabs API and uploads to Supabase Storage.
 * Returns a public URL to the audio file, or { success: false } on failure.
 * Enforces a 10-second timeout.
 */
export async function generateTtsAudio(
  request: TtsRequest,
  organizationId: string
): Promise<TtsResult> {
  const startTime = Date.now();
  const charCount = request.text.length;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    const outputFormat = request.outputFormat || DEFAULT_OUTPUT_FORMAT;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${request.voiceId}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": request.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: request.modelId || DEFAULT_MODEL,
          voice_settings: {
            stability: request.stability ?? DEFAULT_STABILITY,
            similarity_boost: request.similarityBoost ?? DEFAULT_SIMILARITY_BOOST,
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[tts-elevenlabs] ElevenLabs API error:", response.status, errorText);

      await logRuntime({
        organizationId,
        module: "tts",
        action: "generate_audio",
        status: "error",
        errorMessage: `ElevenLabs ${response.status}: ${errorText.slice(0, 200)}`,
        payloadSnapshot: { charCount, durationMs: Date.now() - startTime, fallbackToText: true },
      });

      return { success: false, error: `ElevenLabs API error: ${response.status}`, charCount };
    }

    // Read audio blob
    const audioBlob = await response.blob();
    const fileSizeBytes = audioBlob.size;

    // Upload to Supabase Storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const uuid = crypto.randomUUID();
    const storagePath = `tts-audio/${organizationId}/${uuid}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(storagePath, audioBlob, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("[tts-elevenlabs] Storage upload error:", uploadError);

      await logRuntime({
        organizationId,
        module: "tts",
        action: "generate_audio",
        status: "error",
        errorMessage: `Storage upload: ${uploadError.message}`,
        payloadSnapshot: { charCount, fileSizeBytes, durationMs: Date.now() - startTime, fallbackToText: true },
      });

      return { success: false, error: `Storage upload failed: ${uploadError.message}`, charCount };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("media")
      .getPublicUrl(storagePath);

    const durationMs = Date.now() - startTime;

    await logRuntime({
      organizationId,
      module: "tts",
      action: "generate_audio",
      status: "success",
      payloadSnapshot: { charCount, fileSizeBytes, durationMs, fallbackToText: false },
    });

    console.log("[tts-elevenlabs] Audio generated:", {
      durationMs,
      charCount,
      fileSizeBytes,
      storagePath,
    });

    return {
      success: true,
      audioUrl: publicUrlData.publicUrl,
      durationMs,
      charCount,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    const errorMessage = isTimeout
      ? `Timeout after ${TTS_TIMEOUT_MS}ms`
      : error instanceof Error ? error.message : String(error);

    console.error("[tts-elevenlabs] Error:", errorMessage);

    await logRuntime({
      organizationId,
      module: "tts",
      action: "generate_audio",
      status: "error",
      errorMessage,
      payloadSnapshot: { charCount, durationMs, fallbackToText: true, isTimeout },
    });

    return { success: false, error: errorMessage, charCount };
  }
}
```

- [ ] **Step 2: Verify file has no syntax errors**

Run: `cd <repo-root> && deno check supabase/functions/_shared/tts-elevenlabs.ts 2>&1 | head -20`
Expected: No errors (or only Deno-specific warnings about missing deps that resolve at runtime)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/tts-elevenlabs.ts
git commit -m "feat(tts): add ElevenLabs TTS shared module with audio generation and Storage upload"
```

---

## Task 4: Thread incoming_message_type through agent-message

**Files:**
- Modify: `supabase/functions/agent-message/index.ts:40,82`
- Modify: `supabase/functions/agent-message/agent-engine.ts:63,155,1848`

- [ ] **Step 1: Modify agent-message/index.ts - extract incoming_message_type from body**

In `supabase/functions/agent-message/index.ts`, line 40, change:

```typescript
const { from, message, channel, organization_id, push_name } = body;
```

to:

```typescript
const { from, message, channel, organization_id, push_name, incoming_message_type } = body;
```

- [ ] **Step 2: Modify agent-message/index.ts - pass to processMessage**

In `supabase/functions/agent-message/index.ts`, line 82, change:

```typescript
const response = await engine.processMessage(lead.id, message);
```

to:

```typescript
const response = await engine.processMessage(lead.id, message, incoming_message_type);
```

- [ ] **Step 3: Modify AgentEngine.processMessage - accept incomingMessageType**

In `supabase/functions/agent-message/agent-engine.ts`, line 63, change:

```typescript
async processMessage(leadId: string, userMessage: string) {
```

to:

```typescript
async processMessage(leadId: string, userMessage: string, incomingMessageType?: string) {
```

- [ ] **Step 4: Store incomingMessageType as instance property**

Add a property to the AgentEngine class (near line 38, after `private conversationContext`):

```typescript
private incomingMessageType: string = "text";
```

Then in `processMessage`, after `this.currentLeadId = leadId;` (line 65), add:

```typescript
this.incomingMessageType = incomingMessageType || "text";
```

- [ ] **Step 5: Add audio prompt instructions to buildDynamicPrompt**

In `supabase/functions/agent-message/agent-engine.ts`, just before `return sections.join("\n");` (line 1853), add:

```typescript
    // =====================================================
    // AUDIO MODE INSTRUCTIONS (TTS)
    // =====================================================
    if (capabilities.tts_config) {
      const ttsConfig = capabilities.tts_config as { mode: string; max_chars: number };
      const shouldAddAudioInstructions =
        ttsConfig.mode === "always" ||
        (ttsConfig.mode === "mirror" && (this.incomingMessageType === "audio" || this.incomingMessageType === "ptt"));

      if (shouldAddAudioInstructions) {
        sections.push("");
        sections.push("# [MODO ÁUDIO ATIVO]");
        sections.push("Suas respostas serão convertidas em áudio (voice note). Por isso:");
        sections.push(`- Mantenha respostas curtas e diretas (máximo ${ttsConfig.max_chars} caracteres)`);
        sections.push("- Use linguagem falada, natural, como se estivesse gravando um áudio");
        sections.push("- Evite listas, bullet points, formatação markdown - nada disso aparece em áudio");
        sections.push("- Evite siglas ou abreviaçoes que não soam bem quando faladas");
        sections.push("- Não use emojis");
      }
    }
```

- [ ] **Step 6: Verify tts_config is included in capabilities**

The `loadCapabilities` method in `agent-engine.ts` uses `SELECT *` on `copilot_agents`, so `tts_config` is **automatically included** after the migration. No code change needed here - just verify:

Run: `grep -n "copilot_agents.*select\|SELECT.*copilot" supabase/functions/agent-message/agent-engine.ts | head -5`
Expected: The select uses `*`, confirming `tts_config` is included.

- [ ] **Step 7: Verify no syntax errors**

Run: `cd <repo-root> && deno check supabase/functions/agent-message/agent-engine.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/agent-message/index.ts supabase/functions/agent-message/agent-engine.ts
git commit -m "feat(agent): thread incoming_message_type and add audio prompt instructions for TTS"
```

---

## Task 5: Integrate TTS in evolution-webhook

**Files:**
- Modify: `supabase/functions/evolution-webhook/index.ts:457,571,759,1024-1079`

This is the core integration. Four changes are needed:

- [ ] **Step 1: Add tts_config to the copilot_agents select join**

In `evolution-webhook/index.ts`, line 579, after `natural_messaging_config`, add `tts_config`:

```typescript
          attend_unknown_contacts,
          natural_messaging_config,
          tts_config
```

- [ ] **Step 2: Update the instance interface in handleMessagesUpsert**

In `evolution-webhook/index.ts`, line 759, update the `copilot_agents` type in the instance parameter:

```typescript
    copilot_agents?: { id: string; name: string; is_active: boolean; is_default: boolean; attend_unknown_contacts?: boolean; natural_messaging_config?: NaturalMessagingConfig | null; tts_config?: { provider: string; voice_id: string; mode: "always" | "mirror"; max_chars: number; model_id?: string; stability?: number; similarity_boost?: number } | null } | null;
```

- [ ] **Step 3: Add incoming_message_type to triggerAgentMessage**

In `evolution-webhook/index.ts`, line 457, update the function signature:

```typescript
async function triggerAgentMessage(
  organizationId: string,
  phoneNumber: string,
  messageText: string,
  pushName?: string,
  incomingMessageType?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
```

And in the JSON body (line ~479), add the new field:

```typescript
        body: JSON.stringify({
          from: phoneNumber,
          message: messageText,
          channel: "whatsapp",
          organization_id: organizationId,
          push_name: pushName,
          incoming_message_type: incomingMessageType || "text",
        }),
```

- [ ] **Step 4: Pass messageType to triggerAgentMessage call**

In `evolution-webhook/index.ts`, line 1024, where `triggerAgentMessage` is called, the `messageType` variable is already in scope (determined at line ~807). Update the call:

```typescript
          const agentResult = await triggerAgentMessage(
            instance.organization_id,
            phoneNumber,
            batchedMessageText,
            msg.pushName,
            messageType
          );
```

**Important:** `messageType` is determined per-message at line ~802. For batched messages, use the type of the **last** (most recent) message, since the batching logic processes the latest message. The `messageType` variable is in scope.

- [ ] **Step 5: Add TTS decision logic after agent response**

In `evolution-webhook/index.ts`, at line ~1044 (the block `if (agentResult.success && agentResult.message)`), add the import at the top of the file:

```typescript
import { generateTtsAudio, truncateForTts } from "../_shared/tts-elevenlabs.ts";
import { sendWhatsAppAudio } from "../_shared/audio-sender.ts";
```

Then replace the block at lines 1044-1079 with:

```typescript
          if (agentResult.success && agentResult.message) {
            // @ts-ignore - tts_config vem do join
            const ttsConfig = instance.copilot_agents?.tts_config;

            // Decide if we should generate TTS audio
            const shouldGenerateAudio = ttsConfig && (
              ttsConfig.mode === "always" ||
              (ttsConfig.mode === "mirror" && (messageType === "audio" || messageType === "ptt"))
            );

            let sentAsAudio = false;

            if (shouldGenerateAudio) {
              // Resolve API key: org DB → env var
              const { data: orgData } = await supabase
                .from("organizations")
                .select("elevenlabs_api_key")
                .eq("id", instance.organization_id)
                .single();

              const apiKey = orgData?.elevenlabs_api_key || Deno.env.get("ELEVENLABS_API_KEY");

              if (apiKey) {
                // Truncate text for audio
                const audioText = truncateForTts(agentResult.message, ttsConfig.max_chars || 500);

                // Generate TTS audio
                const ttsResult = await generateTtsAudio(
                  {
                    text: audioText,
                    voiceId: ttsConfig.voice_id,
                    modelId: ttsConfig.model_id,
                    stability: ttsConfig.stability,
                    similarityBoost: ttsConfig.similarity_boost,
                    apiKey,
                  },
                  instance.organization_id
                );

                if (ttsResult.success && ttsResult.audioUrl) {
                  // Send as voice note
                  const audioResult = await sendWhatsAppAudio(
                    instance.instance_name,
                    phoneNumber,
                    ttsResult.audioUrl
                  );

                  if (audioResult.success) {
                    sentAsAudio = true;
                    console.log("[Evolution Webhook] TTS audio sent successfully");

                    // Save outgoing message as ptt with text content for chat display
                    const { error: outMsgError } = await supabase.from("whatsapp_messages").insert({
                      organization_id: instance.organization_id,
                      instance_id: instance.id,
                      message_id: audioResult.messageId || `agent_tts_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      remote_jid: `${phoneNumber}@s.whatsapp.net`,
                      phone_number: phoneNumber,
                      direction: "outgoing",
                      message_type: "ptt",
                      content: agentResult.message,
                      media_url: ttsResult.audioUrl,
                      status: "sent",
                      timestamp: new Date().toISOString(),
                    });

                    if (outMsgError) {
                      console.error("[Evolution Webhook] Error saving TTS outgoing message:", outMsgError);
                    } else {
                      console.log("[Evolution Webhook] TTS outgoing message saved");
                    }
                  } else {
                    console.warn("[Evolution Webhook] TTS audio send failed, falling back to text:", audioResult.error);
                  }
                } else {
                  console.warn("[Evolution Webhook] TTS generation failed, falling back to text:", ttsResult.error);
                }
              } else {
                console.warn("[Evolution Webhook] No ElevenLabs API key found, falling back to text");
              }
            }

            // Fallback: send as text (or if audio was not requested)
            if (!sentAsAudio) {
              // @ts-ignore - natural_messaging_config vem do join
              const rawNaturalConfig = instance.copilot_agents?.natural_messaging_config;
              const naturalConfig: NaturalMessagingConfig = rawNaturalConfig?.enabled != null
                ? rawNaturalConfig as NaturalMessagingConfig
                : { enabled: true, intensity: "natural" };
              const sent = await sendWhatsAppResponse(
                instance.instance_name,
                phoneNumber,
                agentResult.message,
                naturalConfig
              );

              if (sent) {
                const { error: outMsgError } = await supabase.from("whatsapp_messages").insert({
                  organization_id: instance.organization_id,
                  instance_id: instance.id,
                  message_id: `agent_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  remote_jid: `${phoneNumber}@s.whatsapp.net`,
                  phone_number: phoneNumber,
                  direction: "outgoing",
                  message_type: "text",
                  content: agentResult.message,
                  status: "sent",
                  timestamp: new Date().toISOString(),
                });

                if (outMsgError) {
                  console.error("[Evolution Webhook] Error saving outgoing message:", outMsgError);
                } else {
                  console.log("[Evolution Webhook] Outgoing agent message saved");
                }
              }
            }
          } else if (!agentResult.success) {
            console.warn("[Evolution Webhook] Agent processing failed:", agentResult.error);
          }
```

- [ ] **Step 6: Verify no syntax errors**

Run: `cd <repo-root> && deno check supabase/functions/evolution-webhook/index.ts 2>&1 | head -20`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/evolution-webhook/index.ts
git commit -m "feat(webhook): integrate TTS audio generation with fallback to text"
```

---

## Task 6: ElevenLabs Proxy Edge Function

**Files:**
- Create: `supabase/functions/elevenlabs-proxy/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

/**
 * ElevenLabs Proxy
 *
 * Proxies requests to ElevenLabs API, keeping the API key server-side.
 * Used by frontend for voice listing and voice cloning.
 *
 * Supported actions:
 * - { action: "list_voices" } - GET /v1/voices
 * - { action: "clone_voice", name, files } - POST /v1/voices/add
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface ProxyRequest {
  action: "list_voices" | "clone_voice";
  name?: string;
  description?: string;
  // For clone_voice, audio files are sent as base64 in the files array
  files?: Array<{ name: string; data: string; mime_type: string }>;
}

Deno.serve(withSentry('elevenlabs-proxy', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userSupabase = createClient(SUPABASE_URL, authHeader.replace("Bearer ", ""));

    // Get current user
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's organization and check admin role
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "No organization found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (membership.role !== "admin" && membership.role !== "owner") {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve API key
    const { data: orgData } = await supabase
      .from("organizations")
      .select("elevenlabs_api_key")
      .eq("id", membership.organization_id)
      .single();

    const apiKey = orgData?.elevenlabs_api_key || Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured. Add it in organization settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: ProxyRequest = await req.json();

    if (body.action === "list_voices") {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      });

      const result = await response.json();
      return new Response(JSON.stringify(result), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "clone_voice") {
      if (!body.name || !body.files?.length) {
        return new Response(
          JSON.stringify({ error: "name and files are required for voice cloning" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const formData = new FormData();
      formData.append("name", body.name);
      if (body.description) formData.append("description", body.description);

      for (const file of body.files) {
        const binaryData = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
        const blob = new Blob([binaryData], { type: file.mime_type });
        formData.append("files", blob, file.name);
      }

      const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        await logRuntime({
          organizationId: membership.organization_id,
          module: "tts",
          action: "clone_voice",
          status: "success",
          payloadSnapshot: { voiceName: body.name, voiceId: result.voice_id },
        });
      }

      return new Response(JSON.stringify(result), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use list_voices or clone_voice" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[elevenlabs-proxy] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd <repo-root> && deno check supabase/functions/elevenlabs-proxy/index.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/elevenlabs-proxy/index.ts
git commit -m "feat(proxy): add elevenlabs-proxy edge function for voice listing and cloning"
```

---

## Task 7: ElevenLabs Settings Component (Organization)

**Files:**
- Create: `src/components/settings/ElevenLabsSettings.tsx`
- Modify: `src/pages/Configuracoes.tsx:548-553`

- [ ] **Step 1: Create ElevenLabsSettings component**

Create `src/components/settings/ElevenLabsSettings.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Mic, Eye, EyeOff, Save, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function ElevenLabsSettings() {
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState("");

  // Only admins can manage the API key
  const isAdmin = role === "admin" || role === "owner";

  // Fetch current API key from org
  const { data: orgData, isLoading } = useQuery({
    queryKey: ["org-elevenlabs-key", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("elevenlabs_api_key")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && isAdmin,
  });

  useEffect(() => {
    if (orgData?.elevenlabs_api_key) {
      setApiKey(orgData.elevenlabs_api_key);
    }
  }, [orgData]);

  const hasKey = !!orgData?.elevenlabs_api_key;

  const handleSave = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ elevenlabs_api_key: apiKey || null })
        .eq("id", organizationId);

      if (error) throw error;
      toast.success("Chave da API ElevenLabs salva com sucesso");
      queryClient.invalidateQueries({ queryKey: ["org-elevenlabs-key"] });
    } catch (err) {
      toast.error("Erro ao salvar chave da API");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-violet-500/10 rounded-lg">
          <Mic className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <h3 className="font-semibold">ElevenLabs</h3>
          <p className="text-sm text-muted-foreground">
            Text-to-Speech para respostas do copilot via áudio
          </p>
        </div>
        {hasKey && (
          <Badge variant="outline" className="ml-auto text-green-600 border-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Configurado
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="elevenlabs-key">API Key</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="elevenlabs-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_..."
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Obtenha sua API key em elevenlabs.io. Necessaria para habilitar respostas por audio no copilot.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add ElevenLabsSettings to Configuracoes page**

In `src/pages/Configuracoes.tsx`, add the import (near line ~60):

```typescript
import { ElevenLabsSettings } from "@/components/settings/ElevenLabsSettings";
```

In the integrations TabsContent (line ~548), add after `<TinyErpSettings />`:

```tsx
                <div className="border-t" />
                <ElevenLabsSettings />
```

- [ ] **Step 3: Verify no type errors**

Run: `cd <repo-root> && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/ElevenLabsSettings.tsx src/pages/Configuracoes.tsx
git commit -m "feat(ui): add ElevenLabs API key settings in organization integrations"
```

---

## Task 8: Agent TTS Settings Component

**Files:**
- Create: `src/components/copilot/AgentTtsSettings.tsx`
- Modify: `src/components/copilot/AgentConfigModal.tsx`

- [ ] **Step 1: Create AgentTtsSettings component**

Create `src/components/copilot/AgentTtsSettings.tsx`. This component manages:
- Toggle to enable/disable TTS
- Mode selector (always / mirror)
- Voice picker (list from ElevenLabs catalog via proxy)
- Voice cloning (upload audio samples via proxy)
- max_chars slider
- Advanced: stability/similarity sliders

```tsx
import { useState, useEffect } from "react";
import { Mic, Volume2, Upload, Loader2, Play, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import { toast } from "sonner";
import type { TtsConfig } from "@/types/copilot";

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
}

interface AgentTtsSettingsProps {
  agentId: string;
  ttsConfig: TtsConfig | null;
  onSave: (config: TtsConfig | null) => void;
}

export function AgentTtsSettings({ agentId, ttsConfig, onSave }: AgentTtsSettingsProps) {
  const supabase = useSupabaseClient();
  const [enabled, setEnabled] = useState(!!ttsConfig);
  const [mode, setMode] = useState<"always" | "mirror">(ttsConfig?.mode || "mirror");
  const [voiceId, setVoiceId] = useState(ttsConfig?.voice_id || "");
  const [maxChars, setMaxChars] = useState(ttsConfig?.max_chars || 500);
  const [stability, setStability] = useState(ttsConfig?.stability ?? 0.5);
  const [similarityBoost, setSimilarityBoost] = useState(ttsConfig?.similarity_boost ?? 0.75);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const [cloneName, setCloneName] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloningVoice, setCloningVoice] = useState(false);

  // Load voices from ElevenLabs via proxy
  const loadVoices = async () => {
    setLoadingVoices(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-proxy", {
        body: { action: "list_voices" },
      });
      if (error) throw error;
      setVoices(data?.voices || []);
    } catch (err) {
      console.error("Failed to load voices:", err);
      toast.error("Erro ao carregar vozes do ElevenLabs");
    } finally {
      setLoadingVoices(false);
    }
  };

  const handleCloneVoice = async () => {
    if (!cloneConsent || !cloneName || cloneFiles.length === 0) return;
    setCloningVoice(true);
    try {
      // Convert files to base64
      const filesBase64 = await Promise.all(
        cloneFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          return { name: file.name, data: base64, mime_type: file.type };
        })
      );

      const { data, error } = await supabase.functions.invoke("elevenlabs-proxy", {
        body: { action: "clone_voice", name: cloneName, files: filesBase64 },
      });

      if (error) throw error;
      if (data?.voice_id) {
        setVoiceId(data.voice_id);
        toast.success(`Voz "${cloneName}" clonada com sucesso`);
        setCloneFiles([]);
        setCloneName("");
        setCloneConsent(false);
        await loadVoices(); // Refresh voice list
      }
    } catch (err) {
      console.error("Voice cloning failed:", err);
      toast.error("Erro ao clonar voz");
    } finally {
      setCloningVoice(false);
    }
  };

  useEffect(() => {
    if (enabled && voices.length === 0) {
      loadVoices();
    }
  }, [enabled]);

  const handleToggle = (value: boolean) => {
    setEnabled(value);
    if (!value) {
      onSave(null);
    }
  };

  const handleSave = () => {
    if (!enabled) {
      onSave(null);
      return;
    }
    if (!voiceId) {
      toast.error("Selecione uma voz antes de salvar");
      return;
    }
    onSave({
      provider: "elevenlabs",
      voice_id: voiceId,
      mode,
      max_chars: maxChars,
      stability,
      similarity_boost: similarityBoost,
    });
  };

  const selectedVoice = voices.find(v => v.voice_id === voiceId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-violet-500" />
          <Label className="font-medium">Resposta por Audio (TTS)</Label>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {enabled && (
        <div className="space-y-4 pl-6 border-l-2 border-violet-500/20">
          {/* Mode */}
          <div className="space-y-2">
            <Label>Modo</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "always" | "mirror")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Sempre responder com audio</SelectItem>
                <SelectItem value="mirror">Espelhar - audio so quando lead mandar audio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Voice selection */}
          <div className="space-y-2">
            <Label>Voz</Label>
            {loadingVoices ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando vozes...
              </div>
            ) : (
              <Select value={voiceId} onValueChange={setVoiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma voz" />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((voice) => (
                    <SelectItem key={voice.voice_id} value={voice.voice_id}>
                      {voice.name} {voice.category === "cloned" ? "(clonada)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedVoice?.preview_url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => new Audio(selectedVoice.preview_url).play()}
              >
                <Play className="h-3 w-3 mr-1" /> Ouvir preview
              </Button>
            )}

            {/* Voice cloning section */}
            <div className="border-t pt-3 mt-3">
              <p className="text-sm font-medium mb-2">Ou clonar uma voz</p>
              <Input
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => {
                  // Store files for cloning - handled by handleCloneVoice
                  const files = Array.from(e.target.files || []);
                  setCloneFiles(files);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Envie 1-5 amostras de audio (minimo ~1 minuto total)
              </p>
              {cloneFiles.length > 0 && (
                <>
                  <Input
                    className="mt-2"
                    placeholder="Nome da voz clonada"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <Checkbox
                      id="clone-consent"
                      checked={cloneConsent}
                      onCheckedChange={(v) => setCloneConsent(!!v)}
                    />
                    <Label htmlFor="clone-consent" className="text-xs">
                      Confirmo que tenho permissao para clonar esta voz
                    </Label>
                  </div>
                  <Button
                    className="mt-2 w-full"
                    variant="outline"
                    disabled={!cloneConsent || !cloneName || cloningVoice}
                    onClick={handleCloneVoice}
                  >
                    {cloningVoice ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                    Clonar voz
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Max chars slider */}
          <div className="space-y-2">
            <Label>Limite de caracteres: {maxChars}</Label>
            <Slider
              value={[maxChars]}
              onValueChange={([v]) => setMaxChars(v)}
              min={200}
              max={1000}
              step={50}
            />
            <p className="text-xs text-muted-foreground">
              Respostas maiores serao truncadas para caber neste limite
            </p>
          </div>

          {/* Advanced settings */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                Configuracoes avancadas
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Estabilidade: {stability.toFixed(2)}</Label>
                <Slider
                  value={[stability]}
                  onValueChange={([v]) => setStability(v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
              <div className="space-y-2">
                <Label>Similaridade: {similarityBoost.toFixed(2)}</Label>
                <Slider
                  value={[similarityBoost]}
                  onValueChange={([v]) => setSimilarityBoost(v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button onClick={handleSave} className="w-full">
            Salvar configuracao de audio
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add TTS tab to AgentConfigModal**

In `src/components/copilot/AgentConfigModal.tsx`:

**2a. Add imports** (at the top, with other imports):

```typescript
import { AgentTtsSettings } from "./AgentTtsSettings";
import { Volume2 } from "lucide-react";
import type { TtsConfig } from "@/types/copilot";
```

**2b. Add the save handler** inside the component function (near the other handlers):

```typescript
const handleTtsSave = async (config: TtsConfig | null) => {
  const { error } = await supabase
    .from("copilot_agents")
    .update({ tts_config: config })
    .eq("id", agent.id);

  if (error) {
    toast.error("Erro ao salvar configuracao de audio");
  } else {
    toast.success("Configuracao de audio salva");
  }
};
```

**2c. Add TabsTrigger** - in the `<TabsList>` element, after the existing triggers (e.g., after "Funis"):

```tsx
<TabsTrigger value="audio" className="gap-2">
  <Volume2 className="h-4 w-4" />
  Audio
</TabsTrigger>
```

**2d. Add TabsContent** - after the last `</TabsContent>`, add:

```tsx
<TabsContent value="audio">
  <Card className="glass-card">
    <CardContent className="pt-6">
      <AgentTtsSettings
        agentId={agent.id}
        ttsConfig={(agent as any).tts_config || null}
        onSave={handleTtsSave}
      />
    </CardContent>
  </Card>
</TabsContent>
```

Note: `(agent as any).tts_config` is used because the generated Supabase types may not yet include the new column. After running `supabase gen types`, the cast can be removed.

- [ ] **Step 3: Verify no type errors**

Run: `cd <repo-root> && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/AgentTtsSettings.tsx src/components/copilot/AgentConfigModal.tsx
git commit -m "feat(ui): add TTS configuration panel in agent settings"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: Verify migration applies**

Run: `cd <repo-root> && npx supabase db reset --linked 2>&1 | tail -20` (or local equivalent)
Expected: All migrations apply successfully

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd <repo-root> && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Verify Deno edge functions**

Run the following for each modified/new edge function:
```bash
deno check supabase/functions/_shared/tts-elevenlabs.ts
deno check supabase/functions/elevenlabs-proxy/index.ts
deno check supabase/functions/evolution-webhook/index.ts
deno check supabase/functions/agent-message/index.ts
deno check supabase/functions/agent-message/agent-engine.ts
```
Expected: No errors

- [ ] **Step 4: Manual test plan**

1. Set an `elevenlabs_api_key` on an organization (via Configuracoes > Integracoes)
2. Configure `tts_config` on an agent (via Copilot > Agent Config > Audio tab):
   - mode: "always", voice_id: pick from catalog, max_chars: 500
3. Send a text message to the copilot from a lead
4. Expected: Lead receives a voice note (not text)
5. Send an audio message to the copilot from a lead
6. Expected: Lead receives a voice note
7. Change mode to "mirror", send a text message
8. Expected: Lead receives text (not audio)
9. Send an audio message
10. Expected: Lead receives voice note
11. Disable TTS (toggle off), send audio
12. Expected: Lead receives text (original behavior)

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: cleanup and verify TTS integration"
```


## Links relacionados

- [[Visao Geral]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[TinyERP]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
