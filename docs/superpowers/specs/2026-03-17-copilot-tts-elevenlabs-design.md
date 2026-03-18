# Copilot TTS via ElevenLabs — Design Spec

**Date:** 2026-03-17
**Status:** Approved
**Author:** AI-assisted design

## Summary

When a lead sends an audio message, the copilot already transcribes it via OpenAI Whisper. This feature adds dynamic text-to-speech (TTS) responses via ElevenLabs, so the copilot can reply with voice notes instead of text — making the conversation feel like a real person sending audios.

Audio responses are configurable per agent: always on, mirror the lead's behavior, or off.

## Goals

- Lead receives voice notes from the copilot (not text) when audio mode is active
- Configurable per agent with three modes: always, mirror, never
- Voice selection: pick from ElevenLabs catalog or clone a custom voice
- Resilient: falls back to text if TTS fails (timeout 10s)
- Zero impact on existing flows when disabled

## Non-Goals

- Audio caching (each response is unique, generated and discarded)
- Multiple voice notes per response (single voice note with character limit)
- Sending both text + audio (only audio when active)
- New edge functions (inline in existing webhook flow)

---

## Architecture

### Flow Overview

```
Lead sends audio
  → evolution-webhook receives
  → Whisper transcribes to text (existing)
  → agent-message generates text response (existing)
  → NEW: check tts_config on agent
    → mode === "never" → send text (existing flow, no change)
    → mode === "always" → generate TTS audio
    → mode === "mirror" → check if incoming was audio/ptt → if yes, generate TTS
  → If generating TTS:
    → truncate text if > max_chars (smart truncation at last sentence boundary)
    → call ElevenLabs API with 10s timeout
    → if success → upload to Storage → sendWhatsAppAudio() (voice note)
    → if failure → fallback: sendWhatsAppResponse() (text)
```

### Components

#### 1. Database Migration

**`copilot_agents` table — new column:**

```sql
ALTER TABLE copilot_agents
ADD COLUMN tts_config JSONB DEFAULT NULL;

COMMENT ON COLUMN copilot_agents.tts_config IS
'TTS configuration via ElevenLabs: {enabled, provider, voice_id, mode, max_chars, model_id, stability, similarity_boost}';
```

**`organizations` table — new column:**

```sql
ALTER TABLE organizations
ADD COLUMN elevenlabs_api_key TEXT DEFAULT NULL;
```

**Backward compatibility:** `tts_config` defaults to NULL = feature disabled. Zero impact on existing agents.

**RLS:** Follows existing policies on `copilot_agents` and `organizations`.

#### 2. TTS Config Type

```typescript
interface TtsConfig {
  enabled: boolean;                          // Master switch
  provider: "elevenlabs";                    // Future: other providers
  voice_id: string;                          // ElevenLabs voice ID (catalog or cloned)
  mode: "always" | "mirror" | "never";       // When to respond with audio
  max_chars: number;                         // Character limit for TTS (e.g., 500)
  model_id?: string;                         // ElevenLabs model (default: eleven_multilingual_v2)
  stability?: number;                        // 0-1, voice stability control
  similarity_boost?: number;                 // 0-1, voice similarity control
}
```

**Mode behavior:**
- `always` — every copilot response becomes a voice note, regardless of lead's message type
- `mirror` — only responds with audio when the lead sent audio/ptt
- `never` — never generates TTS (default, backward compatible)

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
}

interface TtsResult {
  success: boolean;
  audioUrl?: string;         // Public Storage URL (temporary)
  durationMs?: number;       // Generation duration
  error?: string;
}
```

**Internal flow:**
1. Call `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with text
2. Receive audio as stream (mp3)
3. Upload to Supabase Storage bucket `media` at path `tts-audio/{orgId}/{uuid}.mp3`
4. Return public URL
5. **10-second timeout** — if API doesn't respond, return `{ success: false }`

**Smart text truncation:**
- If `text.length > max_chars`, cut at the last complete sentence (`.`, `!`, `?`) before the limit
- Helper function: `truncateForTts(text: string, maxChars: number): string`

**Storage cleanup:** Audio files in `tts-audio/` can be periodically cleaned (e.g., cron deleting files older than 24h). Optional, can be added later.

#### 4. Integration in `evolution-webhook/index.ts`

**Changes to `handleMessagesUpsert`:**

After receiving the agent-message response and before sending to lead:

1. Load `tts_config` from the agent (add to existing select join on `copilot_agents`)
2. Determine if audio should be generated based on `mode` and `incoming_message_type`
3. If yes: truncate → generate TTS → send voice note (or fallback to text)
4. If no: send text as usual (existing flow, untouched)

**Natural messaging does NOT apply** when sending audio — single voice note, no chunk splitting.

**`whatsapp_messages` record** for the response will have `message_type: 'ptt'` and `media_url` pointing to the generated audio (instead of `message_type: 'text'`).

#### 5. System Prompt Modification in `agent-engine.ts`

When `tts_config.enabled = true` and mode is active, append to system prompt:

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
- `mode === "never"` → don't add

**Payload change:** `triggerAgentMessage()` receives new field `incoming_message_type: "text" | "audio" | "ptt"` so the agent-engine can decide whether to apply audio prompt instructions in mirror mode.

#### 6. Frontend Configuration

**Agent wizard/settings — new TTS section:**
- Toggle to enable TTS
- Mode selector: always / mirror
- Voice picker: catalog list (from `GET /v1/voices`) or voice clone upload
- `max_chars` slider (range: 200-1000, default: 500)
- Voice stability/similarity sliders (advanced, collapsible)

**Organization settings — ElevenLabs API key:**
- Input field in org integrations/settings page
- Stored in `organizations.elevenlabs_api_key`

**Voice selection — two paths:**

**Path 1: Catalog voice**
- Frontend calls `GET https://api.elevenlabs.io/v1/voices` with org's API key
- Displays list with name, preview sample, language
- Operator selects → saves `voice_id` to `tts_config`

**Path 2: Voice cloning**
- Operator uploads 1-5 audio samples (minimum ~1 minute total)
- Frontend calls `POST https://api.elevenlabs.io/v1/voices/add` (instant voice clone)
- ElevenLabs returns a `voice_id` for the cloned voice
- Saves `voice_id` to `tts_config`

**Frontend calls ElevenLabs API directly** (with org's API key) since these are configuration-time operations, not runtime.

---

## API Key Resolution Order

When generating TTS at runtime, the API key is resolved in this order:
1. `organizations.elevenlabs_api_key` (per-org)
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

All failures are logged. The lead always receives a response (audio or text).

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
| `supabase/migrations/YYYYMMDD_add_tts_config.sql` | Create | Migration: tts_config on copilot_agents, elevenlabs_api_key on organizations |
| `supabase/functions/_shared/tts-elevenlabs.ts` | Create | ElevenLabs TTS module: generate audio, upload to Storage |
| `supabase/functions/evolution-webhook/index.ts` | Modify | Add TTS decision logic after agent response, add tts_config to agent select |
| `supabase/functions/agent-message/agent-engine.ts` | Modify | Add audio prompt instructions, accept incoming_message_type |
| `supabase/functions/agent-message/index.ts` | Modify | Pass incoming_message_type to AgentEngine |
| `src/types/copilot.ts` | Modify | Add TtsConfig interface |
| `src/components/copilot/` (settings) | Modify | Add TTS configuration section |
| `src/pages/` or `src/components/` (org settings) | Modify | Add ElevenLabs API key input |
