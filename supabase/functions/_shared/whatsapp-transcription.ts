import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { WhatsAppProvider } from './whatsapp-client.ts';
import { isChatTargetAllowed } from './chat-owner-guard.ts';
import { transcribeAudio } from './audio-transcription.ts';
import { logRuntime } from './logger.ts';

export class TranscriptionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * On-demand transcription of a chat audio message.
 *
 * The text comes from our own media pipeline (`_shared/audio-transcription.ts`,
 * OpenRouter → Gemini fallback, keys from env secrets). The UAZAPI is NOT asked
 * to transcribe: it only does so with an OpenAI key we deliberately never send.
 *
 * Audio source, in order:
 *  1. our `media` bucket, read with the admin client — only when the object
 *     path carries the caller's organization in its 2nd segment (tenant
 *     isolation: a row can never make us read another org's object);
 *  2. `provider.downloadMedia(message_id)` on the caller's own instance.
 *
 * Every failure after the claim is recorded in `runtime_logs` with a short
 * reason code only — no phone, no URL, no transcript, no upstream detail.
 */
export const TRANSCRIPTION_PROVIDER = 'gemini-2.5-flash';
// 14 MB of audio is ~19 MB of base64: under the ~20 MB inline-request limit of Gemini.
export const MAX_AUDIO_BYTES = 14 * 1024 * 1024;
// Whole request (download + transcription) must end, and log, before the edge
// wall clock (~150 s) kills the isolate without running `finally`.
export const TRANSCRIPTION_BUDGET_MS = 110_000;
// Lease outlives the budget by a wide margin, so a second click can never take
// over (and pay for) a request that is still running.
export const TRANSCRIPTION_LEASE_MS = 240_000;
const GENERIC_FAILURE = 'Não conseguimos transcrever este áudio. Tente novamente em instantes.';
const SOURCE_GONE = 'Este áudio não está mais disponível para transcrição.';
const TOO_LARGE = 'Este áudio é grande demais para transcrever (limite de 14 MB).';
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const STORAGE_MARKER = '/storage/v1/object/public/media/';
const MAX_TRANSCRIPT_CHARS = 100_000;
// Placeholders produced by the Copilot media pipeline must never be saved as a transcript.
const PLACEHOLDER = /^\[O lead enviou/i;

type FailureReason = 'source_not_found' | 'download_failed' | 'empty_transcript' | 'too_large' | 'timeout' | 'claim_failed' | 'persist_failed' | 'unexpected';

class TranscriptionFailure extends Error {
  constructor(public reason: FailureReason, public status: number, public publicMessage: string) { super(reason); }
}

export interface TranscriptionDeps {
  transcribe: (bytes: Uint8Array, mimeType: string, budgetMs: number) => Promise<string | null>;
  log: typeof logRuntime;
  budgetMs?: number;
}

const defaultDeps: TranscriptionDeps = {
  transcribe: (bytes, mimeType, budgetMs) => transcribeAudio(bytes, mimeType, { budgetMs }),
  log: logRuntime,
};

/**
 * Path inside the `media` bucket, or null when the URL is not ours or not this
 * org's. Nothing is decoded: every segment must already be plain
 * `[A-Za-z0-9._-]`, so an encoded `/`, `\`, `.` or `%` can never be turned into
 * a traversal by Storage. The org check runs on the final (URL-normalized) path.
 */
export function ownStoragePath(mediaUrl: unknown, organizationId: string): string | null {
  if (typeof mediaUrl !== 'string') return null;
  let pathname: string;
  try { pathname = new URL(mediaUrl).pathname; } catch { return null; }
  const at = pathname.indexOf(STORAGE_MARKER);
  if (at < 0) return null;
  const segments = pathname.slice(at + STORAGE_MARKER.length).split('/');
  if (segments.length < 3 || segments.some((s) => !SAFE_SEGMENT.test(s) || s === '.' || s === '..')) return null;
  if (segments[1] !== organizationId.toLowerCase()) return null;
  return segments.join('/');
}

class TimeoutFailure extends TranscriptionFailure {
  constructor() { super('timeout', 504, GENERIC_FAILURE); }
}

/** Rejects once `deadline` passes, so the failure is logged while the isolate is still alive. */
function withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutFailure()), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return ({ mp3: 'audio/mpeg', mpeg: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', webm: 'audio/webm', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg' } as Record<string, string>)[ext ?? ''] ?? 'audio/ogg';
}

const tooLarge = () => new TranscriptionFailure('too_large', 413, TOO_LARGE);

type StorageInfo = (path: string) => Promise<{ data: { size?: number | null } | null; error: unknown }>;

async function fromStorage(admin: SupabaseClient, path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const bucket = admin.storage.from('media');
  // Size from metadata first, so an oversized object is never pulled into memory.
  const info = (bucket as unknown as { info?: StorageInfo }).info;
  if (typeof info === 'function') {
    const { data: meta } = await info.call(bucket, path);
    if (typeof meta?.size === 'number' && meta.size > MAX_AUDIO_BYTES) throw tooLarge();
  }
  const { data, error } = await bucket.download(path);
  if (error || !data) return null;
  if (data.size > MAX_AUDIO_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length === 0) return null;
  const mime = data.type && data.type.startsWith('audio/') ? data.type : mimeFromPath(path);
  return { bytes, mime };
}

async function fromProvider(provider: WhatsAppProvider, messageId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  let media: { base64: string; mimetype: string };
  try {
    media = await provider.downloadMedia(messageId);
  } catch (error) {
    const detail = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: unknown }).status : undefined;
    if (status === 404 || /not found/i.test(detail)) throw new TranscriptionFailure('source_not_found', 502, SOURCE_GONE);
    throw new TranscriptionFailure('download_failed', 502, GENERIC_FAILURE);
  }
  const base64 = typeof media?.base64 === 'string' ? media.base64.replace(/^data:[^,]*,/, '') : '';
  if (!base64) throw new TranscriptionFailure('source_not_found', 502, SOURCE_GONE);
  if (Math.floor(base64.length * 3 / 4) > MAX_AUDIO_BYTES) throw tooLarge();
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { throw new TranscriptionFailure('download_failed', 502, GENERIC_FAILURE); }
  return { bytes, mime: media.mimetype || 'audio/ogg' };
}

export async function transcribeChatAudio(user: SupabaseClient, admin: SupabaseClient,
  provider: WhatsAppProvider, organizationId: string, instanceId: string, rowId: unknown,
  deps: TranscriptionDeps = defaultDeps) {
  if (typeof rowId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rowId)) throw new TranscriptionError(400, 'Mensagem inválida');
  const { data: message, error } = await user.from('whatsapp_messages')
    .select('id,message_id,phone_number,message_type,media_url,deleted_at,transcription_text,transcription_provider,transcription_created_at')
    .eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId).maybeSingle();
  if (error || !message || message.deleted_at) throw new TranscriptionError(404, 'Mensagem indisponível');
  if (!await isChatTargetAllowed(user, organizationId, instanceId, { leadId: null, rawPhone: message.phone_number, messageId: message.message_id })) {
    throw new TranscriptionError(403, 'Conversa indisponível');
  }
  if (!['audio', 'ptt'].includes(message.message_type)) throw new TranscriptionError(400, 'Selecione uma mensagem de áudio');
  if (message.transcription_text && message.transcription_provider && message.transcription_created_at) return {
    text: message.transcription_text, provider: message.transcription_provider, createdAt: message.transcription_created_at, cached: true,
  };
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - TRANSCRIPTION_LEASE_MS).toISOString();
  const { data: claim, error: claimError } = await admin.from('whatsapp_messages').update({ transcription_requested_at: now })
    .eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId).is('deleted_at', null)
    .is('transcription_text', null).or(`transcription_requested_at.is.null,transcription_requested_at.lt.${expired}`).select('id').maybeSingle();
  // The proxy's error port does not log: this is the only trace of a failure.
  const recordFailure = (reason: FailureReason) => deps.log({
    organizationId, module: 'whatsapp', action: 'transcribeAudio', status: 'error',
    errorMessage: reason, entityType: 'whatsapp_messages', entityId: rowId,
  }).catch(() => {});
  if (claimError) {
    await recordFailure('claim_failed');
    throw new TranscriptionError(503, 'Não foi possível iniciar a transcrição');
  }
  if (!claim) throw new TranscriptionError(409, 'Transcrição já solicitada. Aguarde e tente novamente.');
  try {
    const deadline = Date.now() + (deps.budgetMs ?? TRANSCRIPTION_BUDGET_MS);
    const raw = await withDeadline((async () => {
      const storagePath = ownStoragePath(message.media_url, organizationId);
      const audio = (storagePath ? await fromStorage(admin, storagePath) : null) ?? await fromProvider(provider, message.message_id);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TimeoutFailure();
      return deps.transcribe(audio.bytes, audio.mime, remaining);
    })(), deadline);
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text || PLACEHOLDER.test(text) || text.length > MAX_TRANSCRIPT_CHARS) throw new TranscriptionFailure('empty_transcript', 502, GENERIC_FAILURE);
    const createdAt = new Date().toISOString();
    const { data: saved, error: saveError } = await admin.from('whatsapp_messages').update({
      transcription_text: text, transcription_provider: TRANSCRIPTION_PROVIDER, transcription_created_at: createdAt, transcription_requested_at: null,
    }).eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId)
      .eq('transcription_requested_at', now).is('deleted_at', null).select('id').maybeSingle();
    if (saveError || !saved) throw new TranscriptionFailure('persist_failed', 502, GENERIC_FAILURE);
    return { text, provider: TRANSCRIPTION_PROVIDER, createdAt, cached: false };
  } catch (error) {
    const failure = error instanceof TranscriptionFailure ? error : new TranscriptionFailure('unexpected', 502, GENERIC_FAILURE);
    await recordFailure(failure.reason);
    throw new TranscriptionError(failure.status, failure.publicMessage);
  } finally {
    await admin.from('whatsapp_messages').update({ transcription_requested_at: null })
      .eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId).eq('transcription_requested_at', now);
  }
}
