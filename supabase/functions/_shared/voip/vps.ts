/**
 * Único ponto de contato HTTP com a VPS do TorqueCalls.
 *
 * Existe para que "falar com a VPS" tenha uma forma só: mesma base URL, mesmo
 * timeout, mesmo mapeamento de erro, mesmo lugar para carimbar a credencial.
 * Duas funções chamando a VPS com fetch cru divergem em três meses — foi assim
 * que autorização copiada virou divergência de `is_active` em outro canto deste
 * repositório.
 *
 * A credencial vai em `Authorization: Bearer <JWS>`. Hoje a VPS ainda não exige
 * (a base MIT nasceu "trusted LAN only" e o middleware é a fatia S5) — mandar
 * antes de ser exigido é deliberado: quando a S5 subir, o plano de controle já
 * está falando a língua certa e o corte não precisa ser simultâneo.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export type VpsResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function baseUrl(): string {
  const url = Deno.env.get("TORQUECALLS_VPS_URL");
  if (!url) throw new Error("voip/vps: TORQUECALLS_VPS_URL ausente");
  return url.replace(/\/+$/, "");
}

/** A URL que o browser usa para mídia e SSE. Pode diferir da interna (túnel vs público). */
export function publicVpsUrl(): string {
  return (Deno.env.get("TORQUECALLS_PUBLIC_URL") ?? baseUrl()).replace(/\/+$/, "");
}

export async function callVps<T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { token: string; body?: unknown; timeoutMs?: number } = { token: "" },
): Promise<VpsResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // A VPS devolve JSON em todo caminho conhecido. Corpo não-JSON significa
        // que quem respondeu não foi ela (proxy, gateway, página de erro) — vale
        // dizer isso em vez de mascarar como falha genérica.
        return {
          ok: false,
          status: res.status,
          error: `resposta não-JSON da VPS (${res.status}): ${text.slice(0, 200)}`,
        };
      }
    }

    if (!res.ok) {
      const msg = (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: msg };
    }

    return { ok: true, status: res.status, data: parsed as T };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return {
      ok: false,
      // 504 e não 500: a distinção entre "a VPS recusou" e "a VPS não respondeu"
      // é a primeira pergunta de qualquer incidente de voz.
      status: aborted ? 504 : 502,
      error: aborted ? "timeout falando com a VPS" : `falha de rede: ${String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
