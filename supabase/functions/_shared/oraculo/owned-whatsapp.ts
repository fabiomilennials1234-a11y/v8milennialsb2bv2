/** Canal da plataforma. Nunca consulta whatsapp_instances de cliente. */

export interface OwnedWhatsAppConfig {
  baseUrl: string;
  token: string;
  groupJid: string;
}

export function ownedWhatsAppConfig(): OwnedWhatsAppConfig | null {
  const baseUrl = Deno.env.get("UAZAPI_BASE_URL")?.trim();
  const token = Deno.env.get("ORACULO_UAZAPI_TOKEN")?.trim() ||
    Deno.env.get("SUPPORT_UAZAPI_TOKEN")?.trim();
  const groupJid = Deno.env.get("ORACULO_WHATSAPP_GROUP_JID")?.trim() ||
    Deno.env.get("SUPPORT_WHATSAPP_GROUP_JID")?.trim();
  return baseUrl && token && groupJid ? { baseUrl, token, groupJid } : null;
}

export async function sendOwnedWhatsApp(
  text: string,
  config = ownedWhatsAppConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!config) return { ok: false, error: "secrets do canal próprio ausentes" };
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: config.token },
      body: JSON.stringify({ number: config.groupJid, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      await response.body?.cancel();
      return { ok: true };
    }
    const detail = await response.text().catch(() => "");
    return { ok: false, error: `uazapi ${response.status}: ${detail.slice(0, 200)}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
