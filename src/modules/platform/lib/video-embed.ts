/**
 * Vídeo do Artigo (Central de Ajuda) — parser + allowlist de embed.
 *
 * ADR-0019: o corpo do artigo é Markdown SEM `rehype-raw`; vídeo nunca é HTML
 * cru. O vídeo é um campo dedicado (`video_url`) e só é embedado se a URL vier
 * de um host da allowlist (Loom ou YouTube). Esta função é a única fronteira:
 * dado qualquer texto, devolve uma URL de embed segura e normalizada, ou `null`.
 * Recusar por padrão — qualquer coisa que não case exatamente um host conhecido
 * e um id extraível volta `null`, incluindo esquemas perigosos (javascript:, data:).
 */
export type VideoProvider = "loom" | "youtube";

export interface VideoEmbed {
  provider: VideoProvider;
  embedUrl: string;
}

export function parseVideoEmbed(url: string): VideoEmbed | null {
  // Fronteira de segurança: só http(s) URLs bem-formadas chegam ao parser de
  // host. Qualquer esquema perigoso (javascript:, data:) ou lixo cai fora aqui.
  const parsed = safeHttpUrl(url);
  if (!parsed) return null;

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  const youtubeId = matchYouTube(host, parsed);
  if (youtubeId) {
    return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${youtubeId}` };
  }

  const loomId = matchLoom(host, parsed);
  if (loomId) {
    return { provider: "loom", embedUrl: `https://www.loom.com/embed/${loomId}` };
  }

  return null;
}

function matchLoom(host: string, url: URL): string | null {
  if (host !== "loom.com") return null;
  // /share/ID e /embed/ID → o id é o segmento após o prefixo conhecido.
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 2 && ["share", "embed"].includes(segments[0])) {
    return sanitizeId(segments[1]);
  }
  return null;
}

/** Aceita só URLs absolutas http/https. Devolve `null` para qualquer outra coisa. */
function safeHttpUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

function matchYouTube(host: string, url: URL): string | null {
  if (host === "youtu.be") {
    return firstPathSegment(url) ?? null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (v) return sanitizeId(v);

    // /embed/ID, /shorts/ID, /v/ID → o id é o segmento após o prefixo conhecido.
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 2 && ["embed", "shorts", "v"].includes(segments[0])) {
      return sanitizeId(segments[1]);
    }
  }
  return null;
}

function firstPathSegment(url: URL): string | undefined {
  const seg = url.pathname.split("/").filter(Boolean)[0];
  return seg ? sanitizeId(seg) ?? undefined : undefined;
}

/** Um id de vídeo é alfanumérico + `-`/`_`. Qualquer outra coisa não é id. */
function sanitizeId(raw: string): string | null {
  return /^[\w-]+$/.test(raw) ? raw : null;
}
