/**
 * Foto de perfil do contato WhatsApp (Uazapi).
 *
 * O webhook só REGISTRA a URL candidata (`registerAvatarCandidate`); quem baixa,
 * valida e grava no bucket privado `contact-avatars` é o cron
 * `contact-avatar-sync`. Tudo que decide aqui é puro e testado em
 * tests/unit/contact-avatar-pure.test.ts e uazapi-chat-avatar-candidate.test.ts.
 *
 * A URL vem de fora (payload do provedor): a allowlist é a única porta para o
 * cron fazer `fetch` nela. Só https, host do CDN do WhatsApp, sem userinfo nem
 * porta — o banco repete a mesma regra em `registrar_avatar_candidato`.
 */

export const AVATAR_URL_MAX_LENGTH = 2048;
const ALLOWED_HOST_SUFFIX = ".whatsapp.net";

/** URL que o cron pode baixar: https, `*.whatsapp.net`, sem userinfo/porta, ≤ 2048. */
export function isAllowedAvatarUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > AVATAR_URL_MAX_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  // O texto cru também precisa começar pelo host: barra invertida, espaço e
  // afins são normalizados pelo parser e não podem passar pela regex do banco.
  if (!raw.toLowerCase().startsWith(`https://${host}/`)) return false;
  return host.endsWith(ALLOWED_HOST_SUFFIX) && host.length > ALLOWED_HOST_SUFFIX.length;
}

/** Chave de identidade da foto: a URL sem query nem fragmento (o `oe=` muda, a foto não). */
export function avatarCandidateKey(url: string): string {
  return url.split("?")[0].split("#")[0];
}

// ── Memo por isolate ─────────────────────────────────────────────────────────
// Um contato ativo manda dezenas de mensagens por hora; a candidata quase nunca
// muda. LRU por inserção (Map preserva ordem), 5k entradas, TTL 1 h.
export const AVATAR_MEMO_MAX = 5000;
export const AVATAR_MEMO_TTL_MS = 60 * 60 * 1000;

export class AvatarCandidateMemo {
  private readonly entries = new Map<string, { key: string; expiresAt: number }>();
  constructor(
    private readonly max = AVATAR_MEMO_MAX,
    private readonly ttlMs = AVATAR_MEMO_TTL_MS,
  ) {}

  /** true quando esta candidata já foi registrada há menos de TTL. */
  seen(id: string, candidateKey: string, now = Date.now()): boolean {
    const hit = this.entries.get(id);
    if (!hit) return false;
    if (hit.expiresAt <= now || hit.key !== candidateKey) {
      this.entries.delete(id);
      return false;
    }
    // Toque: volta para o fim da fila do LRU.
    this.entries.delete(id);
    this.entries.set(id, hit);
    return true;
  }

  remember(id: string, candidateKey: string, now = Date.now()): void {
    this.entries.delete(id);
    this.entries.set(id, { key: candidateKey, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

const isolateMemo = new AvatarCandidateMemo();

export interface AvatarRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: unknown }>;
}

/**
 * Registra a candidata (RPC `registrar_avatar_candidato`, service_role). Pula a
 * ida ao banco quando o memo já viu a mesma foto. Erro sobe para o chamador —
 * que no webhook é fire-and-forget com log, nunca o ack.
 */
export async function registerAvatarCandidate(
  supabase: AvatarRpcClient,
  organizationId: string,
  instanceId: string,
  candidate: { phone: string; url: string },
  memo: AvatarCandidateMemo = isolateMemo,
): Promise<"skipped" | "registered"> {
  const id = `${organizationId}:${candidate.phone}`;
  const key = avatarCandidateKey(candidate.url);
  if (memo.seen(id, key)) return "skipped";
  const { error } = await supabase.rpc("registrar_avatar_candidato", {
    p_organization_id: organizationId,
    p_instance_id: instanceId,
    p_phone: candidate.phone,
    p_url: candidate.url,
  });
  if (error) {
    const message = typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : String(error);
    throw new Error(`registrar_avatar_candidato: ${message}`);
  }
  memo.remember(id, key);
  return "registered";
}

// ════════════════════════════════════════════════════════════════════════════
// Cron (contact-avatar-sync): decisões puras
// ════════════════════════════════════════════════════════════════════════════

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_FETCH_TIMEOUT_MS = 8_000;
export const AVATAR_BUCKET = "contact-avatars";
export const AVATAR_MAX_ATTEMPTS = 3;
/** Margem para não baixar uma URL que vence no meio do fetch. */
const OE_MARGIN_MS = 60_000;

/** Path determinístico do objeto: nada vindo de fora (nem telefone) entra nele. */
export function avatarStoragePath(organizationId: string, avatarId: string): string {
  return `${organizationId}/avatars/${avatarId}.jpg`;
}

/**
 * A URL do CDN carrega `oe=<epoch em hex>`: depois dele o CDN responde 403.
 * Sem `oe` (ou ilegível) = não sabemos — tenta.
 */
export function avatarUrlExpired(url: string, nowMs: number): boolean {
  let oe: string | null;
  try {
    oe = new URL(url).searchParams.get("oe");
  } catch {
    return true;
  }
  if (!oe || !/^[0-9a-f]{1,12}$/i.test(oe)) return false;
  return parseInt(oe, 16) * 1000 <= nowMs + OE_MARGIN_MS;
}

export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";

/** Tipo pelo conteúdo (magic bytes), nunca pelo header do servidor. */
export function sniffAvatarMime(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lê o corpo cortando no teto: nunca segura mais que `max + 1 chunk` em memória. */
export async function readCapped(
  res: Response,
  max: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" }> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: "too_large" };
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > max ? { ok: false, reason: "too_large" } : { ok: true, bytes: buf };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes: out };
}

export type AvatarDownload =
  | { kind: "ok"; bytes: Uint8Array; contentType: AvatarMime; sha256: string }
  /** 403/404 do CDN: URL vencida ou foto trocada — vale tentar o fallback. */
  | { kind: "gone"; reason: string }
  | { kind: "error"; reason: string };

/**
 * Baixa a foto com as travas anti-SSRF e anti-abuso: allowlist antes e depois,
 * sem seguir redirect, timeout, corte em 2 MB, 0 byte recusado, tipo pelo
 * conteúdo e sha256 para pular upload igual.
 */
export async function downloadAvatar(
  url: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<AvatarDownload> {
  if (!isAllowedAvatarUrl(url)) return { kind: "error", reason: "url_not_allowed" };
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? AVATAR_FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { Accept: "image/jpeg,image/png,image/webp" },
      });
    } catch (err) {
      return { kind: "error", reason: controller.signal.aborted ? "timeout" : `fetch_failed:${errorName(err)}` };
    }
    if (res.url && !isAllowedAvatarUrl(res.url)) {
      await res.body?.cancel().catch(() => {});
      return { kind: "error", reason: "final_url_not_allowed" };
    }
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => {});
      return { kind: "gone", reason: `http_${res.status}` };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { kind: "error", reason: `http_${res.status}` };
    }
    const read = await readCapped(res, opts.maxBytes ?? AVATAR_MAX_BYTES);
    if (!read.ok) return { kind: "error", reason: read.reason };
    if (read.bytes.length === 0) return { kind: "error", reason: "empty" };
    const contentType = sniffAvatarMime(read.bytes);
    if (!contentType) return { kind: "error", reason: "not_image" };
    return { kind: "ok", bytes: read.bytes, contentType, sha256: await sha256Hex(read.bytes) };
  } catch (err) {
    return { kind: "error", reason: controller.signal.aborted ? "timeout" : `read_failed:${errorName(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

export type DetailsImage =
  | { kind: "url"; url: string }
  /** O campo de foto VEIO, vazio ou null: contato sem foto ou com privacidade. */
  | { kind: "none" }
  /** Veio algo que não passa na allowlist: não baixa, conta como erro. */
  | { kind: "rejected" }
  /**
   * Nenhum campo de foto (inclusive `{}`, `{ error }` ou corpo não-objeto):
   * formato desconhecido. NUNCA vira `none` — `none` apaga a foto gravada.
   */
  | { kind: "unknown" };

const DETAILS_NESTED_KEYS = ["chat", "data", "contact", "details", "result", "info"] as const;
const DETAILS_IMAGE_FIELDS = ["imagePreview", "image"] as const;

/**
 * Lê a foto da resposta de POST /chat/details. O formato NÃO foi verificado
 * contra uma resposta real (falta fixture): procura `imagePreview`/`image` no
 * topo e em um nível de objeto aninhado comum. A URL passa pela MESMA
 * allowlist do webhook. "Sem foto" só quando o campo existe e veio vazio/null;
 * ausência do campo é formato desconhecido (erro, a foto fica).
 */
export function extractDetailsImageUrl(body: unknown): DetailsImage {
  const layers: Record<string, unknown>[] = [];
  const asRecord = (v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const root = asRecord(Array.isArray(body) ? body[0] : body);
  if (!root) return { kind: "unknown" };
  layers.push(root);
  for (const key of DETAILS_NESTED_KEYS) {
    const nested = asRecord(root[key]);
    if (nested) layers.push(nested);
  }
  let emptyField = false;
  for (const layer of layers) {
    for (const field of DETAILS_IMAGE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(layer, field)) continue;
      const value = layer[field];
      if (value === null || (typeof value === "string" && value.trim() === "")) {
        emptyField = true;
        continue;
      }
      if (typeof value !== "string") return { kind: "unknown" };
      return isAllowedAvatarUrl(value.trim()) ? { kind: "url", url: value.trim() } : { kind: "rejected" };
    }
  }
  return emptyField ? { kind: "none" } : { kind: "unknown" };
}

export type AvatarOutcome =
  | { kind: "ok"; storagePath: string; sha256: string }
  /** Mesmo conteúdo que já está no bucket: só carimba. */
  | { kind: "same" }
  | { kind: "none" }
  | { kind: "error"; reason: string }
  /** Não deu para tentar nesta rodada (teto do /chat/details, kill switch). */
  | { kind: "deferred"; reason: string };

export interface ClaimedAvatar {
  id: string;
  organization_id: string;
  normalized_phone: string;
  candidate_url: string | null;
  storage_path: string | null;
  content_sha256: string | null;
  status: "pending" | "ok" | "none" | "error";
  attempts: number;
  details_instance_id: string | null;
  details_number: string | null;
}

/**
 * O UPDATE de fechamento. Sempre carimba `avatar_updated_at` e solta o claim.
 * Erro numa linha já resolvida (`ok`/`none`) é transitório: mantém o estado e a
 * foto, só conta a tentativa. Pendente com 3 erros vira `error` (revisita em 7d).
 */
export function closePatch(row: ClaimedAvatar, outcome: AvatarOutcome, nowIso: string): Record<string, unknown> {
  const base = { avatar_updated_at: nowIso, claimed_until: null };
  switch (outcome.kind) {
    case "ok":
      return { ...base, status: "ok", storage_path: outcome.storagePath, content_sha256: outcome.sha256, attempts: 0, last_error: null };
    case "same":
      return { ...base, status: "ok", attempts: 0, last_error: null };
    case "none":
      return { ...base, status: "none", storage_path: null, content_sha256: null, attempts: 0, last_error: null };
    case "deferred":
      return { ...base, last_error: outcome.reason.slice(0, 500) };
    case "error": {
      const attempts = Math.min(row.attempts + 1, 32767);
      const settled = row.status === "ok" || row.status === "none";
      return {
        ...base,
        attempts,
        last_error: outcome.reason.slice(0, 500),
        status: settled ? row.status : attempts >= AVATAR_MAX_ATTEMPTS ? "error" : "pending",
      };
    }
  }
}

/** Número para o /chat/details: o telefone cru da conversa; senão DDI 55 + normalizado. */
export function detailsNumber(row: Pick<ClaimedAvatar, "details_number" | "normalized_phone">): string {
  const raw = row.details_number?.replace(/\D/g, "") ?? "";
  if (/^\d{8,15}$/.test(raw)) return raw;
  return row.normalized_phone.length <= 11 ? `55${row.normalized_phone}` : row.normalized_phone;
}
