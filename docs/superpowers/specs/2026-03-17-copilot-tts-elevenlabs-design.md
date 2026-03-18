# Copilot TTS via ElevenLabs — Design Spec

**Date:** 2026-03-17
**Status:** Approved
**Author:** AI-assisted design

## Summary

When a lead sends an audio message, the copilot already transcribes it via OpenAI Whisper. This feature adds dynamic text-to-speech (TTS) responses via ElevenLabs, so the copilot can reply with voice notes instead of text — making the conversation feel like a real person sending audios.

Audio responses are configurable per agent: always on, mirror the lead's behavior, or off.

**Note:** This is a Brazil-focused product. System prompt instructions and UI labels are in Portuguese (pt-BR).

## Goals

- Lead receives voice notes from the copilot (not text) when audio mode is active
- Configurable per agent with two active modes: always, mirror (disabled = `tts_config` is NULL)
- Voice selection: pick from ElevenLabs catalog or clone a custom voice
- Resilient: falls back to text if TTS fails (timeout 10s)
- Zero impact on existing flows when disabled

## Non-Goals

- Audio caching (each response is unique, generated and discarded)
- Multiple voice notes per response (single voice note with character limit)
- Sending both text + audio (only audio when active)
- New edge functions (inline in existing webhook flow)
- Cost controls / character budgets (can be added later)

---

## Architecture

### Flow Overview

```
Lead sends message (text or audio)
  → evolution-webhook receives
  → If audio: Whisper transcribes to text (existing)
  → triggerAgentMessage() sends text + incoming_message_type to agent-message
  → agent-message/index.ts extracts incoming_message_type, passes to AgentEngine
  → AgentEngine.processMessage(leadId, userMessage, incomingMessageType)
    → if TTS active for this message: appends audio prompt instructions to system prompt
    → generates text response via LLM
    → returns response
  → evolution-webhook receives agent response
  → NEW: check tts_config on agent
    → tts_config is NULL → send text (existing flow, no change)
    → mode === "always" → generate TTS audio
    → mode === "mirror" → check if incoming was audio/ptt → if yes, generate TTS; if text, send text
  → If generating TTS:
    → truncate text if > max_chars (smart truncation at last sentence boundary)
    → resolve API key: org DB → ELEVENLABS_API_KEY env var
    → call ElevenLabs API with 10s timeout
    → if success → upload to Storage (audio/mpeg) → sendWhatsAppAudio() (voice note)
    → if failure → fallback: sendWhatsAppResponse() (text)
```

### Components

#### 1. Database Migration

**`copilot_agents` table — new column:**

```sql
ALTER TABLE copilot_agents
ADD COLUMN tts_config JSONB DEFAULT NULL;

COMMENT ON COLUMN copilot_agents.tts_config IS
'TTS config via ElevenLabs: {provider, voice_id, mode, max_chars, model_id, stability, similarity_boost}. NULL = disabled.';
```

**`organizations` table — new column:**

```sql
ALTER TABLE organizations
ADD COLUMN elevenlabs_api_key TEXT DEFAULT NULL;
```

**RLS for API key:** Add policy restricting `elevenlabs_api_key` read access to org admins only (role = 'admin'). Regular org members should NOT be able to read this column. The frontend never reads this key directly — voice browsing/cloning is proxied through an edge function (see Section 6).

**Backward compatibility:** `tts_config` defaults to NULL = feature disabled. Zero impact on existing agents.

#### 2. TTS Config Type

```typescript
interface TtsConfig {
  provider: "elevenlabs";                    // Future: other providers
  voice_id: string;                          // ElevenLabs voice ID (catalog or cloned)
  mode: "always" | "mirror";                 // When to respond with audio
  max_chars: number;                         // Character limit for TTS (e.g., 500)
  model_id?: string;                         // ElevenLabs model (default: eleven_multilingual_v2)
  stability?: number;                        // 0-1, voice stability control (default: 0.5)
  similarity_boost?: number;                 // 0-1, voice similarity control (default: 0.75)
}
```

**Disabled state:** `tts_config = NULL` on the `copilot_agents` row means TTS is off. No separate `enabled` boolean — NULL is the off switch. When the user disables TTS in the UI, the column is set to NULL.

**Mode behavior:**
- `always` — every copilot response becomes a voice note, regardless of lead's message type
- `mirror` — only responds with audio when the lead sent audio/ptt; text messages get text replies

#### 3. New Shared Module: `_shared/tts-elevenlabs.ts`

Responsible for generating audio via ElevenLabs and uploading to Storage.

```typescript
interface TtsRequest {
  text: string;
  voiceId: string;
  modelId?: string;          // default: "eleven_multilingual_v2"
  stability?: number;        // default: 0.5
  similarityBoost?: number;  // default: 0.75
  apiKey: string;
  outputFormat?: string;     // default: "mp3_22050_32" (low bitrate, fine for WhatsApp voice notes)
}

interface TtsResult {
  success: boolean;
  audioUrl?: string;         // Public Storage URL (temporary)
  durationMs?: number;       // Generation duration
  charCount?: number;        // Characters sent to ElevenLabs (for cost tracking)
  error?: string;
}
```

**Internal flow:**
1. Call `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with text and `output_format: "mp3_22050_32"`
2. Receive audio as stream (mp3)
3. Upload to Supabase Storage bucket `media` at path `tts-audio/{orgId}/{uuid}.mp3` with MIME type `audio/mpeg`
4. Return public URL
5. **10-second timeout** — if API doesn't respond, return `{ success: false }`

**Smart text truncation:**
- If `text.length > max_chars`, cut at the last complete sentence (`.`, `!`, `?`) before the limit
- Helper function: `truncateForTts(text: string, maxChars: number): string`

**Logging:** On every TTS call (success or failure), log via `logRuntime`:
- `generation_duration_ms`: time taken
- `char_count`: characters sent to ElevenLabs
- `file_size_bytes`: audio file size (on success)
- `fallback_to_text`: boolean (on failure)

**Storage cleanup:** Audio files in `tts-audio/` can be periodically cleaned (e.g., cron deleting files older than 24h). Minimum retention: 1 hour (to avoid race conditions where WhatsApp is still downloading the audio). Optional, can be added after initial implementation.

#### 4. Integration in `evolution-webhook/index.ts`

**Changes to the agent select join (line ~571):**

Add `tts_config` to the existing `copilot_agents` select:

```typescript
copilot_agents:copilot_agent_id (
  id, name, is_active, is_default,
  availability, response_delay_seconds,
  attend_unknown_contacts, natural_messaging_config,
  tts_config   // ← NEW
)
```

Update the TypeScript interface for the instance object (line ~758) to include `tts_config`:

```typescript
copilot_agents?: {
  id: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  attend_unknown_contacts?: boolean;
  natural_messaging_config?: NaturalMessagingConfig | null;
  tts_config?: TtsConfig | null;   // ← NEW
} | null;
```

**Loading the API key at runtime:**

After determining TTS should be generated, fetch the org's API key:

```typescript
// Separate query — only executed when TTS is active
const { data: orgData } = await supabase
  .from('organizations')
  .select('elevenlabs_api_key')
  .eq('id', instance.organization_id)
  .single();

const apiKey = orgData?.elevenlabs_api_key || Deno.env.get('ELEVENLABS_API_KEY');
if (!apiKey) {
  // No API key → skip TTS, send text
}
```

This is a separate query (not joined into the instance query) to keep the API key out of the main select and to only fetch it when actually needed.

**Changes to `handleMessagesUpsert`:**

After receiving the agent-message response and before sending to lead:

1. Check if `tts_config` exists on the agent (not NULL)
2. Determine if audio should be generated based on `mode` and `incoming_message_type`:
   - `mode === "always"` → generate audio
   - `mode === "mirror"` and incoming `messageType` is `"audio"` or `"ptt"` → generate audio
   - Otherwise → send text (existing flow)
3. If generating audio: fetch API key → truncate → call `generateTtsAudio()` → send voice note (or fallback to text)
4. If not → send text as usual (existing flow, untouched)

**Natural messaging does NOT apply** when sending audio — single voice note, no chunk splitting.

**Message batching interaction:** When multiple messages from a lead are batched (existing batching logic at lines ~951-991), the concatenated input is treated as a single message. The LLM's response is already constrained by the audio prompt instructions. If the response still exceeds `max_chars`, it is truncated by `truncateForTts()`.

**`whatsapp_messages` record for outgoing TTS audio:**

The outgoing message insert (currently at line ~1061) will be modified:
- `message_type`: set to `'ptt'` (instead of `'text'`)
- `media_url`: set to the Storage URL of the generated audio
- `content`: **still contains the text response** — this is important for chat display, search, and conversation history. The UI shows the text in the chat bubble even though the lead received audio.
- The `send.message` webhook from Evolution API (line ~1148) should be handled with deduplication — check `whatsapp_message_id` to avoid duplicate records.

#### 5. System Prompt Modification in `agent-engine.ts`

When `tts_config` is not NULL and audio should be generated for this message, append to system prompt:

```
[MODO ÁUDIO ATIVO]
Suas respostas serão convertidas em áudio (voice note). Por isso:
- Mantenha respostas curtas e diretas (máximo {max_chars} caracteres)
- Use linguagem falada, natural, como se estivesse gravando um áudio
- Evite listas, bullet points, formatação markdown — nada disso aparece em áudio
- Evite siglas ou abreviações que não soam bem quando faladas
- Não use emojis
```

**When to apply:**
- `mode === "always"` → always add instruction
- `mode === "mirror"` → add only when incoming message is audio/ptt
- `tts_config === NULL` → don't add (feature disabled)

**Full call chain for `incoming_message_type`:**

The `incoming_message_type` must be threaded through the entire call chain:

1. **`handleMessagesUpsert`** — `messageType` is already determined at line ~795 (`"text"`, `"audio"`, `"ptt"`, etc.). Pass it to `triggerAgentMessage()`.

2. **`triggerAgentMessage()`** — new parameter added:
   ```typescript
   async function triggerAgentMessage(
     organizationId: string,
     phoneNumber: string,
     messageText: string,
     pushName?: string,
     incomingMessageType?: string  // ← NEW
   ): Promise<...>
   ```
   Add to the JSON body: `incoming_message_type: incomingMessageType || "text"`

3. **`agent-message/index.ts`** — extract from request body:
   ```typescript
   const { from, message, channel, organization_id, push_name, incoming_message_type } = await req.json();
   ```
   Pass to engine: `engine.processMessage(leadId, message, incoming_message_type)`

4. **`AgentEngine.processMessage()`** — new parameter:
   ```typescript
   async processMessage(leadId: string, userMessage: string, incomingMessageType?: string)
   ```
   Store `incomingMessageType` and use it when building the system prompt to decide whether to append audio instructions.

#### 6. Frontend Configuration

**Agent wizard/settings — new TTS section:**
- Toggle to enable TTS (when disabled, sets `tts_config = NULL`)
- Mode selector: always / mirror
- Voice picker: catalog list or voice clone upload
- `max_chars` slider (range: 200-1000, default: 500)
- Voice stability/similarity sliders (advanced, collapsible)

**Organization settings — ElevenLabs API key:**
- Input field in org integrations/settings page
- Stored in `organizations.elevenlabs_api_key`
- Only visible to org admins

**Voice selection — proxied through edge function:**

The frontend does NOT call ElevenLabs directly. Instead, voice browsing and cloning are proxied through a lightweight edge function to avoid exposing the API key to the browser.

**New edge function: `elevenlabs-proxy`**

Handles two operations:
- `GET /voices` → proxies to `GET https://api.elevenlabs.io/v1/voices` — returns available voices
- `POST /voices/add` → proxies to `POST https://api.elevenlabs.io/v1/voices/add` — creates cloned voice

The edge function:
1. Authenticates the request (existing auth pattern)
2. Verifies user is org admin
3. Loads `elevenlabs_api_key` from the org (or env var fallback)
4. Proxies the request to ElevenLabs
5. Returns the response

**Voice cloning consent:** The UI includes a consent checkbox before voice cloning, acknowledging that the user has permission to clone the voice. ElevenLabs requires this for their terms of service.

**Path 1: Catalog voice**
- Frontend calls `elevenlabs-proxy` → lists available voices
- Displays list with name, preview sample, language
- Operator selects → saves `voice_id` to `tts_config`

**Path 2: Voice cloning**
- Operator records or uploads 1-5 audio samples (minimum ~1 minute total)
- Consent checkbox: "I confirm I have permission to clone this voice"
- Frontend calls `elevenlabs-proxy` → creates cloned voice
- ElevenLabs returns a `voice_id` for the cloned voice
- Saves `voice_id` to `tts_config`

---

## API Key Resolution Order

When generating TTS at runtime, the API key is resolved in this order:
1. `organizations.elevenlabs_api_key` (per-org, fetched via separate query)
2. Environment variable `ELEVENLABS_API_KEY` (global fallback)

If neither is found, TTS is skipped and text is sent instead.

---

## What Does NOT Change

- **Whisper transcription** (incoming audio) — already works, untouched
- **`sendWhatsAppAudio`** — already exists, reused as-is
- **Outbound pre-recorded audios** — separate system, untouched
- **Agents without TTS** — `tts_config = NULL`, zero impact
- **Campaign audio** — separate system, untouched
- **Workflow audio actions** — separate system, untouched

---

## Error Handling

| Scenario | Behavior |
|---|---|
| ElevenLabs API timeout (>10s) | Fallback to text response |
| ElevenLabs API error (4xx/5xx) | Fallback to text response |
| Storage upload fails | Fallback to text response |
| `sendWhatsAppAudio` fails | Fallback to text response |
| No API key configured | Skip TTS, send text |
| Voice ID invalid | Fallback to text, log error |

All failures are logged via `logRuntime`. The lead always receives a response (audio or text).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ELEVENLABS_API_KEY` | Optional | Global fallback API key for ElevenLabs |

Per-org keys in `organizations.elevenlabs_api_key` take precedence.

---

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `supabase/migrations/YYYYMMDD_add_tts_config.sql` | Create | Migration: tts_config on copilot_agents, elevenlabs_api_key on organizations, RLS policy |
| `supabase/functions/_shared/tts-elevenlabs.ts` | Create | ElevenLabs TTS module: generate audio, upload to Storage, truncation |
| `supabase/functions/elevenlabs-proxy/index.ts` | Create | Proxy for voice listing and voice cloning (keeps API key server-side) |
| `supabase/functions/evolution-webhook/index.ts` | Modify | Add TTS decision logic after agent response, add tts_config to agent select, thread incoming_message_type |
| `supabase/functions/agent-message/agent-engine.ts` | Modify | Accept incomingMessageType, add audio prompt instructions to system prompt |
| `supabase/functions/agent-message/index.ts` | Modify | Extract incoming_message_type from body, pass to AgentEngine |
| `src/types/copilot.ts` | Modify | Add TtsConfig interface |
| `src/components/copilot/` (settings) | Modify | Add TTS configuration section in agent settings |
| `src/pages/` or `src/components/` (org settings) | Modify | Add ElevenLabs API key input (admin only) |
