/**
 * The message variables a broadcast fills — the Disparos engine freezes exactly these per
 * lead (blast-plan.ts snapshotVars). Anything else in a template is blanked by the engine's
 * resolver, so a broadcast refuses it instead of sending "sua reunião é dia  às ".
 * Automations resolve a larger set ({{dia_reuniao}}, {{saudacao}}, custom fields…), which is
 * why a message copied from one has to be checked here.
 */
import { personalizationFirstName, personalizationName } from "../../_shared/lead-name.ts";
import { templateVariables } from "../../_shared/quick-blast/message-resolver.ts";

export function leadVars(
  l: { name: string | null; company?: string | null; segment?: string | null },
) {
  return {
    nome: personalizationName(l.name),
    primeiro_nome: personalizationFirstName(l.name),
    empresa: l.company ?? "",
    segmento: l.segment ?? "",
  };
}

export const BROADCAST_VARIABLES: readonly string[] = Object.keys(leadVars({ name: null }));

/** Variables of `text` a broadcast cannot fill, in first-seen order. Pure. */
export function unsupportedVariables(text: string): string[] {
  return templateVariables(text).filter((v) => !BROADCAST_VARIABLES.includes(v));
}

export function unsupportedVariablesMessage(vars: string[]): string {
  const list = vars.map((v) => `{{${v}}}`).join(", ");
  const ok = BROADCAST_VARIABLES.map((v) => `{{${v}}}`).join(", ");
  return `O disparo só preenche ${ok}. Esta mensagem usa ${list}, que chegaria em branco ao ` +
    "lead. Reescreva sem essas variáveis (passe o texto em message) ou mantenha o envio pela automação.";
}
