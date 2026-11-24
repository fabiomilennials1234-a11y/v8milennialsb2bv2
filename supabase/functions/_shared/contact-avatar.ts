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
