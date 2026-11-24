/**
 * What this token can do, and how to unlock what it cannot — sent as the MCP `instructions`
 * at initialize. A write tool the token lacks the scope for is not even listed (tools/index.ts
 * customerToolFilter), so without this the AI only sees its absence and answers "I can't do
 * that". With it, the AI tells the person exactly what to turn on, and where. Pure.
 *
 * Scope ids and labels mirror the token screen (src/modules/platform/lib/mcp-connect.ts).
 */
import type { WriteScope } from "../tools/actions.ts";

interface ScopeInfo {
  label: string;
  does: string;
  who: string;
}

export const WRITE_SCOPES: Record<WriteScope, ScopeInfo> = {
  "crm:write": {
    label: "Organizar o funil",
    does: "move cards between stages",
    who: "anyone allowed to move cards in Torque",
  },
  "messages:send": {
    label: "Enviar mensagens",
    does:
      "send WhatsApp broadcasts — including a message taken from an automation — to the cards of a funnel/stage",
    who: "an admin of the organization",
  },
  "automations:write": {
    label: "Criar automações",
    does: "create automations and turn them on or off",
    who: "anyone allowed to create automations in Torque",
  },
};

/** The person-facing sentence for a missing scope (Portuguese: the AI relays it as is). */
export function missingScopeHint(scope: WriteScope): string {
  const s = WRITE_SCOPES[scope];
  return `Este token não tem o acesso "${s.label}". Para liberar, gere um token novo no Torque ` +
    `(IA conectada (MCP)) marcando "${s.label}" — o acesso de um token não pode ser ampliado. ` +
    (scope === "messages:send" ? "Só um admin da organização pode marcar essa opção. " : "") +
    "Se a opção não aparecer, a escrita pela IA ainda não foi liberada para a organização: " +
    "fale com o suporte do Torque.";
}

export function serverInstructions(scopes: readonly string[]): string {
  const all = Object.keys(WRITE_SCOPES) as WriteScope[];
  const granted = all.filter((s) => scopes.includes(s));
  const missing = all.filter((s) => !scopes.includes(s));
  const lines = [
    "Torque CRM, as the person who created this token: you see and change exactly what they can in the app.",
    `This token can: read${granted.map((s) => `; ${WRITE_SCOPES[s].does} (${s})`).join("")}.`,
  ];
  if (missing.length) {
    lines.push(
      "Not enabled on this token, so their tools are not listed. If the person asks for one of these, " +
        "do not just say it is impossible — tell them how to unlock it:",
      ...missing.map((s) =>
        `- ${WRITE_SCOPES[s].does}: needs "${WRITE_SCOPES[s].label}" (${s}), granted by ${
          WRITE_SCOPES[s].who
        } on a NEW token (Torque › IA conectada (MCP)); an existing token cannot be widened. ` +
        "If the option is missing there, AI writes are not enabled for the organization yet — Torque support turns it on."
      ),
    );
  }
  lines.push(
    "Where to start: funnels → funnel.overview (counts and stalled cards of every funnel), then " +
      "funnel.review (the cards of one funnel/stage, with their last messages); results → " +
      "metrics.catalog then metrics.query; today's work → followup.list, agenda.list, " +
      "inbox.awaiting_reply; a person → lead.list / lead.get, lead.timeline, conversation.get; " +
      "the team → team.list (ids for owner filters); automations → automation.list then " +
      "automation.get; a WhatsApp send → audience.preview.",
    "Every change is plan → show the person → confirm. Never confirm without the person's explicit OK.",
  );
  return lines.join("\n");
}
