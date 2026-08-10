// deno-lint-ignore-file no-explicit-any
/**
 * whatsapp-media — shared helpers for downloading WhatsApp CDN media via the
 * Uazapi `/message/download` endpoint and persisting the result into Supabase
 * Storage.
 *
 * Used by:
 *   - whatsapp-webhook (best-effort first attempt + enqueue if it fails)
 *   - whatsapp-media-retry (cron-driven retry of pending jobs)
 *
 * Contract: never throws. Returns a structured result so callers can stamp
 * the corresponding `whatsapp_media_jobs` row deterministically.
 */

// `SupabaseClient` e NÃO `ReturnType<typeof createClient>`: `ReturnType`
// instancia os genéricos nos *defaults declarados*, que no supabase-js 2.10x
// viraram `Database = unknown` / `SchemaName = never`. Com isso `whatsapp_media_jobs`
// resolvia para `never` e os três `.update()`/`.upsert()` deste arquivo eram erro
// de tipo. `createClient(url, key)` devolve outra coisa (`<any, "public", …>`).
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_TIMEOUT_MS = 25_000;

const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/ogg; codecs=opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/octet-stream": "bin",
};

export type MediaJobInput = {
  instanceId: string;
  organizationId: string;
  messageId: string;
  sourceUrl: string;
  messageType: string | null;
};

export type MediaPersistResult =
  | { ok: true; storagePath: string; publicUrl: string | null }
  | { ok: false; error: string };

export function isWhatsAppCdnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(".whatsapp.net/") || url.includes(".whatsapp.com/");
}

/**
 * Idempotent enqueue. UPSERT on (message_id, instance_id) — safe to call
 * multiple times for the same media without creating duplicate jobs.
 */
export async function enqueueMediaJob(
  supabase: SupabaseClient,
  input: MediaJobInput,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("whatsapp_media_jobs")
      .upsert(
        {
          instance_id: input.instanceId,
          organization_id: input.organizationId,
          message_id: input.messageId,
          source_url: input.sourceUrl,
          message_type: input.messageType,
        },
        { onConflict: "message_id,instance_id", ignoreDuplicates: true },
      );
    if (error) {
      console.error("[whatsapp-media] enqueue failed:", error.message);
    }
  } catch (err) {
    console.error("[whatsapp-media] enqueue threw:", err);
  }
}

/**
 * Path do objeto no Storage, derivado do CONTEÚDO — não da mensagem.
 *
 * Antes o path era `<org>/<message_id>.<ext>`, e message_id é único por
 * mensagem. Um disparo do mesmo catálogo para 290 clientes gravava 290 cópias
 * idênticas: medido em prod (2026-08-10) isso valia 42 dos 43 GB de duplicata
 * do bucket, com um caso real de 1 PDF de 22 MB em 299 cópias.
 *
 * A causa é o eco: o WhatsApp devolve pelo webhook cada mensagem que nós
 * enviamos, e nós rebaixávamos da CDN um arquivo que já era nosso, uma vez por
 * destinatário.
 *
 * Com o hash do conteúdo no path, o mesmo binário resolve para o mesmo caminho
 * e o `upsert` sobrescreve em vez de multiplicar. Vale para mídia recebida
 * também, não só para disparo.
 *
 * O org fica no path de propósito: o bucket é público e serve várias orgs, e
 * um path global por hash faria duas orgs compartilharem o mesmo objeto —
 * apagar mídia de uma quebraria a outra, e o isolamento multi-tenant viraria
 * ficção. Cópia por org é o preço do isolamento.
 *
 * CONSEQUÊNCIA: várias mensagens passam a apontar para o mesmo objeto. Apagar
 * mídia de uma mensagem deixou de ser seguro sem antes checar se outra ainda
 * referencia o mesmo path.
 */
export async function buildMediaPath(
  organizationId: string,
  bin: Uint8Array<ArrayBuffer>,
  ext: string,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bin);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `whatsapp-media/${organizationId}/${hash}.${ext}`;
}

/**
 * Stamp a media job as resolved (storage_path set) or failed (attempts++).
 * Best-effort — failure to stamp does not propagate.
 */
export async function stampMediaJob(
  supabase: SupabaseClient,
  jobId: string | null,
  filter: { messageId: string; instanceId: string },
  result: MediaPersistResult,
): Promise<void> {
  try {
    if (result.ok) {
      const update = {
        resolved_at: new Date().toISOString(),
        storage_path: result.storagePath,
        last_error: null,
      };
      const q = supabase.from("whatsapp_media_jobs").update(update);
      const scoped = jobId
        ? q.eq("id", jobId)
        : q.eq("message_id", filter.messageId).eq("instance_id", filter.instanceId);
      const { error } = await scoped;
      if (error) console.error("[whatsapp-media] stamp resolved failed:", error.message);
    } else {
      const next = (await currentAttempts(supabase, filter)) + 1;
      const plain = supabase
        .from("whatsapp_media_jobs")
        .update({
          attempts: next,
          last_attempt_at: new Date().toISOString(),
          last_error: result.error,
        });
      const scoped = jobId
        ? plain.eq("id", jobId)
        : plain.eq("message_id", filter.messageId).eq("instance_id", filter.instanceId);
      const { error } = await scoped;
      if (error) console.error("[whatsapp-media] stamp failed:", error.message);
    }
  } catch (err) {
    console.error("[whatsapp-media] stamp threw:", err);
  }
}

async function currentAttempts(
  supabase: SupabaseClient,
  filter: { messageId: string; instanceId: string },
): Promise<number> {
  const { data } = await supabase
    .from("whatsapp_media_jobs")
    .select("attempts")
    .eq("message_id", filter.messageId)
    .eq("instance_id", filter.instanceId)
    .maybeSingle();
  return (data as any)?.attempts ?? 0;
}

/**
 * Download media from Uazapi CDN and upload it to Storage. Updates
 * whatsapp_messages.media_url to point at the Storage public URL on success.
 */
export async function downloadAndPersistMedia(
  supabase: SupabaseClient,
  uazapiBaseUrl: string,
  input: MediaJobInput,
  options: { timeoutMs?: number } = {},
): Promise<MediaPersistResult> {
  if (!uazapiBaseUrl) return { ok: false, error: "uazapi_base_url_missing" };

  const { data: secrets } = await supabase
    .from("whatsapp_instance_secrets")
    .select("uazapi_token")
    .eq("instance_id", input.instanceId)
    .maybeSingle();
  const token = (secrets as any)?.uazapi_token;
  if (!token) return { ok: false, error: "uazapi_token_missing" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${uazapiBaseUrl}/message/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ id: input.messageId }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, error: `download_http_${res.status}` };
    }

    const result = await res.json().catch(() => ({} as any));
    const mimetype: string = result?.mimetype ?? "application/octet-stream";

    // Uint8Array<ArrayBuffer>, e não o Uint8Array genérico: crypto.subtle.digest
    // recusa ArrayBufferLike (que admite SharedArrayBuffer). Ambos os caminhos
    // abaixo produzem buffer próprio, então a restrição é honesta.
    let bin: Uint8Array<ArrayBuffer>;

    // Uazapi v2 returns fileURL; legacy/Evolution returned base64
    const fileURL: string = result?.fileURL ?? "";
    const rawB64: string = result?.base64 ?? "";

    if (fileURL) {
      const fileRes = await fetch(fileURL, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
      if (!fileRes.ok) return { ok: false, error: `fileurl_http_${fileRes.status}` };
      bin = new Uint8Array(await fileRes.arrayBuffer());
    } else if (rawB64) {
      const pure = rawB64.includes(",") ? rawB64.split(",")[1] : rawB64;
      try {
        bin = Uint8Array.from(atob(pure), (c) => c.charCodeAt(0));
      } catch (e) {
        return { ok: false, error: `base64_decode_failed: ${(e as Error).message}` };
      }
    } else {
      return { ok: false, error: "empty_payload" };
    }

    const ext = MIME_TO_EXT[mimetype] ?? mimetype.split("/")[1] ?? "bin";
    const storagePath = await buildMediaPath(input.organizationId, bin, ext);

    const { error: upErr } = await supabase.storage
      .from("media")
      .upload(storagePath, bin, { contentType: mimetype, upsert: true });
    if (upErr) return { ok: false, error: `storage_upload: ${upErr.message}` };

    const { data: urlData } = supabase.storage.from("media").getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl ?? null;

    if (publicUrl) {
      await supabase
        .from("whatsapp_messages")
        .update({ media_url: publicUrl })
        .eq("message_id", input.messageId)
        .eq("instance_id", input.instanceId);
    }

    return { ok: true, storagePath, publicUrl };
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).name === "AbortError" ? "timeout" : (err as Error).message;
    return { ok: false, error: msg };
  }
}
