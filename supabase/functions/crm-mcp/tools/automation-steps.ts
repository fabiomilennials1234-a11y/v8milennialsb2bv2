/**
 * An automation's messages, read the way the engine sends them (fatia 5 do v2) — pure.
 *
 * The visual builder keeps each send in a node's `data`, and which field holds the text
 * depends on the node. The executor is the contract: workflow-action-handler.ts routes by
 * actionType (and, for the unified node, by messageType); send-whatsapp.ts reads
 * messageTemplate; send-whatsapp-media.ts reads imageUrl + imageCaption and documentUrl +
 * documentName + documentCaption; send-meta.ts reads semiAutoMessage. Mirroring those reads
 * is what lets the AI show — and a broadcast copy — exactly what the automation sends, never
 * a transcription of it.
 */
import { modoDoNo } from "../../_shared/decisao-de-envio.ts";
import { templateVariables } from "../../_shared/quick-blast/message-resolver.ts";
import type { WorkflowDefinition, WorkflowNode } from "../../_shared/workflow-schema/definition.ts";
import { unsupportedVariables } from "./message-vars.ts";

export type SendKind =
  | "texto"
  | "imagem"
  | "documento"
  | "audio"
  | "video"
  | "figurinha"
  | "template"
  | "menu"
  | "pix"
  | "texto_ia"
  | "canal_oficial"
  | "equipe";

export interface StepMedia {
  type: "image" | "document";
  url: string;
  name: string | null;
}

/** One send of the automation, as the engine would perform it. */
export interface SendStep {
  node_id: string;
  /** 1-based position along the flow, breadth-first from the trigger. */
  order: number;
  label: string | null;
  kind: SendKind;
  /** What the lead reads: the text, or the caption of the media. */
  text: string;
  media: StepMedia | null;
  /** Why a broadcast cannot send this step at all (the text aside), or null. */
  blocked: string | null;
}

/** A send step as the AI sees it: plus its variables and whether broadcast.plan takes it. */
export interface AutomationMessage extends Omit<SendStep, "blocked"> {
  variables: string[];
  broadcastable: boolean;
  not_broadcastable_because: string | null;
}

const BLOCKED: Partial<Record<SendKind, string>> = {
  audio: "O Disparo não envia áudio.",
  video: "O Disparo não envia vídeo.",
  figurinha: "O Disparo não envia figurinha.",
  menu: "O Disparo não envia menu interativo.",
  pix: "O Disparo não envia botão de Pix.",
  template:
    "Usa um template oficial da Meta; o disparo pela IA sai pelo WhatsApp comum, sem template.",
  texto_ia:
    "O texto é escrito pela IA para cada lead na hora do envio; não existe um texto fixo para disparar.",
  canal_oficial: "Sai pelo Canal Oficial (Meta); o disparo pela IA sai pelo WhatsApp comum.",
  equipe: "Vai para um número ou grupo da equipe, não para o lead.",
};

/** Only a public object of the project's `media` bucket travels in a Disparo (blast-media.ts). */
const PUBLIC_MEDIA_PATH = "/storage/v1/object/public/media/";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function fileNameOf(url: string): string | null {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last).trim() || null;
  } catch {
    return null;
  }
}

function mediaBlocked(url: string, what: string): string | null {
  if (!url) return `O passo não tem ${what} configurada.`;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && u.pathname.startsWith(PUBLIC_MEDIA_PATH)) return null;
  } catch { /* fall through */ }
  return `A ${what} não está no armazenamento do Torque, e o Disparo só envia arquivos de lá.`;
}

type Send = Pick<SendStep, "kind" | "text" | "media" | "blocked">;

const only = (kind: SendKind, text = ""): Send => ({
  kind,
  text,
  media: null,
  blocked: BLOCKED[kind] ?? null,
});

function image(d: Record<string, unknown>): Send {
  const url = str(d.imageUrl).trim();
  const blocked = mediaBlocked(url, "imagem");
  return {
    kind: "imagem",
    text: str(d.imageCaption),
    media: blocked ? null : { type: "image", url, name: null },
    blocked,
  };
}

function document(d: Record<string, unknown>): Send {
  const url = str(d.documentUrl).trim();
  const blocked = mediaBlocked(url, "arquivo");
  // The Disparo never sends a document without the name the lead sees (blast-media.ts).
  const name = str(d.documentName).trim() || fileNameOf(url);
  return {
    kind: "documento",
    text: str(d.documentCaption),
    media: blocked ? null : { type: "document", url, name },
    blocked: blocked ?? (name ? null : "O arquivo não tem nome."),
  };
}

/** The send a node performs, or null when the node does not message anyone. Pure. */
export function sendOf(node: WorkflowNode): Send | null {
  if (!node || node.type !== "action") return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  switch (str(d.actionType)) {
    case "send_whatsapp":
      return modoDoNo(d) === "template" ? only("template") : only("texto", str(d.messageTemplate));
    case "send_whatsapp_message": {
      // Semi-automatic: the engine queues one text for a person to approve (ADR-0012).
      if (d.semiAutomatic) {
        return only(
          "texto",
          str(d.semiAutoMessage) || str(d.messageTemplate) || str(d.imageCaption) ||
            str(d.videoCaption),
        );
      }
      switch (str(d.messageType) || "texto") {
        case "texto":
          if (str(d.templateMode) === "ai") return only("texto_ia");
          return modoDoNo(d) === "template"
            ? only("template")
            : only("texto", str(d.messageTemplate));
        case "imagem":
          return image(d);
        case "video":
          return only("video", str(d.videoCaption));
        case "audio":
          return only("audio");
        case "sticker":
          return only("figurinha");
        case "menu":
          return only("menu");
        case "pix":
          return only("pix");
        default:
          return null; // the engine fails this node ("Unknown message type")
      }
    }
    case "send_whatsapp_image":
      return image(d);
    case "send_whatsapp_document":
      return document(d);
    case "send_whatsapp_audio":
      return only("audio");
    case "send_whatsapp_video":
      return only("video", str(d.videoCaption));
    case "send_whatsapp_sticker":
      return only("figurinha");
    case "send_whatsapp_template":
      return only("template");
    case "send_whatsapp_menu":
      return only("menu");
    case "send_whatsapp_pix_button":
      return only("pix");
    case "send_meta_message":
      return only("canal_oficial");
    case "send_semi_automatic":
      return only("texto", str(d.semiAutoMessage));
    case "send_to_number":
    case "send_to_group":
      return only("equipe", str(d.messageTemplate));
    default:
      return null;
  }
}

/**
 * Node ids along the flow: breadth-first from the trigger node(s), following edges in the
 * order they are stored; nodes the walk does not reach come last, in storage order. Pure.
 */
export function flowOrder(def: WorkflowDefinition | null | undefined): string[] {
  const nodes = Array.isArray(def?.nodes) ? def!.nodes : [];
  const edges = Array.isArray(def?.edges) ? def!.edges : [];
  const next = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const e of edges) {
    if (typeof e?.source !== "string" || typeof e?.target !== "string") continue;
    const list = next.get(e.source) ?? [];
    list.push(e.target);
    next.set(e.source, list);
    hasIncoming.add(e.target);
  }
  const ids = nodes.map((n) => n?.id).filter((id): id is string => typeof id === "string");
  const known = new Set(ids);
  const triggers = nodes.filter((n) => n?.type === "trigger").map((n) => n.id);
  const queue = triggers.length ? [...triggers] : ids.filter((id) => !hasIncoming.has(id));
  const seen = new Set<string>();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !known.has(id)) continue; // an edge to a missing node is ignored
    seen.add(id);
    order.push(id);
    for (const t of next.get(id) ?? []) if (!seen.has(t)) queue.push(t);
  }
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/** Every send of the automation, in flow order. Pure. */
export function sendSteps(def: WorkflowDefinition | null | undefined): SendStep[] {
  const byId = new Map((def?.nodes ?? []).map((n) => [n.id, n]));
  const steps: SendStep[] = [];
  for (const id of flowOrder(def)) {
    const node = byId.get(id)!;
    const send = sendOf(node);
    if (!send) continue;
    const label = str(node.data?.label).trim();
    steps.push({ node_id: id, order: steps.length + 1, label: label || null, ...send });
  }
  return steps;
}

/** A step plus what a broadcast needs to know: its variables and whether it can go as is. */
export function asMessage(s: SendStep): AutomationMessage {
  const { blocked, ...rest } = s;
  const unsupported = unsupportedVariables(s.text);
  const because = blocked ??
    (unsupported.length
      ? `Usa ${unsupported.map((v) => `{{${v}}}`).join(", ")}, que o disparo não preenche.`
      : s.media === null && !s.text.trim()
      ? "O passo não tem texto."
      : null);
  return {
    ...rest,
    variables: templateVariables(s.text),
    broadcastable: because === null,
    not_broadcastable_because: because,
  };
}

/** The compact shape of the whole flow, so the AI can say where each message sits. Pure. */
export function flowOverview(
  def: WorkflowDefinition | null | undefined,
  max = 80,
): Array<{ node_id: string; type: string; label: string | null }> {
  const byId = new Map((def?.nodes ?? []).map((n) => [n.id, n]));
  return flowOrder(def).slice(0, max).map((id) => {
    const n = byId.get(id)!;
    const label = str(n.data?.label).trim().slice(0, 120);
    return { node_id: id, type: str(n.type) || "?", label: label || null };
  });
}
