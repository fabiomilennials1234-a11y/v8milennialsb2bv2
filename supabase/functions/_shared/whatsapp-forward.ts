import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SendMediaOptions, WhatsAppProvider } from "./whatsapp-client.ts";

export class ForwardError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export interface ForwardSource {
  id: string;
  message_type: string;
  content: string | null;
  condition_text: string | null;
  media_url: string | null;
  media_expired: boolean | null;
  deleted_at: string | null;
  status: string;
  reply_context?: unknown;
}
export function forwardContent(source: ForwardSource) {
  if (source.deleted_at || ["failed", "pending"].includes(source.status)) {
    throw new ForwardError(422, "Esta mensagem não pode ser encaminhada");
  }
  const text = source.condition_text ?? (source.reply_context ? null : source.content);
  if (["text", "conversation", "extendedTextMessage"].includes(source.message_type)) {
    if (!text?.trim()) throw new ForwardError(422, "Texto original indisponível");
    return { kind: "text" as const, text };
  }
  const mediaTypes: Record<string, SendMediaOptions["type"]> = {
    image: "image",
    video: "video",
    audio: "audio",
    ptt: "ptt",
    document: "document",
    sticker: "sticker",
  };
  const type = mediaTypes[source.message_type];
  if (!type) throw new ForwardError(422, "Este tipo de mensagem ainda não pode ser encaminhado");
  if (source.media_expired || !source.media_url) {
    throw new ForwardError(422, "A mídia não está mais disponível para encaminhar");
  }
  return { kind: "media" as const, type, file: source.media_url, caption: text || undefined };
}

// Read BOTH ends with caller RLS. Never accept content/media URLs from the request.
export async function resolveForward(
  user: SupabaseClient,
  orgId: string,
  instanceId: string,
  rowId: unknown,
  number: unknown,
) {
  if (
    typeof rowId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rowId) ||
    typeof number !== "string" ||
    !/^\d+(?:-\d+)?(?:@(s\.whatsapp\.net|g\.us|lid))?$/.test(number)
  ) throw new ForwardError(400, "Encaminhamento inválido");
  const source = await user.from("whatsapp_messages")
    .select(
      "id,message_type,content,condition_text,media_url,media_expired,deleted_at,status,reply_context",
    )
    .eq("organization_id", orgId).eq("instance_id", instanceId).eq("id", rowId).maybeSingle();
  if (source.error || !source.data) {
    throw new ForwardError(403, "Mensagem de origem indisponível ou sem acesso");
  }
  const target = await user.from("whatsapp_messages").select("lead_id,remote_jid")
    .eq("organization_id", orgId).eq("instance_id", instanceId).eq(
      number.includes("@") ? "remote_jid" : "phone_number",
      number,
    )
    .is("deleted_at", null).order("timestamp", { ascending: false }).limit(1).maybeSingle();
  if (target.error || !target.data) {
    throw new ForwardError(403, "Conversa de destino indisponível ou sem acesso");
  }
  if (!/^\d+(?:-\d+)?@(s\.whatsapp\.net|g\.us|lid)$/.test(target.data.remote_jid)) {
    throw new ForwardError(422, "Destino inválido");
  }
  return {
    content: forwardContent(source.data),
    leadId: target.data.lead_id,
    number: target.data.remote_jid as string,
  };
}

export async function sendForward(
  provider: WhatsAppProvider,
  resolved: Awaited<ReturnType<typeof resolveForward>>,
) {
  if (provider.provider !== "uazapi") {
    throw new ForwardError(422, "Encaminhamento indisponível nesta conexão");
  }
  const common = { number: resolved.number, forward: true, trackSource: "torque_forward" };
  const content = resolved.content;
  const result = content.kind === "text"
    ? await provider.sendText({ ...common, text: content.text })
    : await provider.sendMedia({
      ...common,
      type: content.type,
      file: content.file,
      caption: content.caption,
    });
  if (result.status === "failed") {
    throw new ForwardError(422, "O WhatsApp recusou o encaminhamento");
  }
  return result;
}
