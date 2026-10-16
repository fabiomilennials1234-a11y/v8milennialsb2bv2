/**
 * useSubmitFeatureSuggestion — grava a sugestão do prompt de primeira abertura.
 *
 * O payload leva só o que o cliente tem grant para escrever: organização, tipo
 * e texto. Dono (`user_id`) e origem (`source`) vêm de DEFAULT no banco.
 *
 * 23505 = o UNIQUE parcial (uma sugestão por usuário vinda deste prompt) já tem
 * a linha: um duplo clique ou uma segunda aba. Para quem enviou, é sucesso.
 *
 * O texto é PII livre. O erro que sai daqui carrega só o código do Postgres —
 * nunca a mensagem, `details` ou o corpo — porque o MutationCache global relata
 * toda falha de mutation para o Sentry.
 */
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  isBodyValid,
  normalizeBody,
  type SuggestionKind,
} from "@/modules/platform/components/feedback/feature-suggestion";

export interface FeatureSuggestionInput {
  organizationId: string;
  kind: SuggestionKind;
  body: string;
}

export class FeatureSuggestionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`feature_suggestion_insert_failed:${code}`);
    this.name = "FeatureSuggestionError";
    this.code = code;
  }
}

const UNIQUE_VIOLATION = "23505";

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "string" && /^[\w-]{1,16}$/.test(code)) return code;
  }
  return "unknown";
}

export async function submitFeatureSuggestion({ organizationId, kind, body }: FeatureSuggestionInput): Promise<void> {
  if (!isBodyValid(body)) throw new FeatureSuggestionError("invalid_body");
  let code: string | null = null;
  try {
    const { error } = await supabase
      .from("feature_suggestions")
      .insert({ organization_id: organizationId, kind, body: normalizeBody(body) });
    if (error) code = errorCode(error);
  } catch {
    code = "network";
  }
  if (code && code !== UNIQUE_VIOLATION) throw new FeatureSuggestionError(code);
}

export function useSubmitFeatureSuggestion() {
  return useMutation({
    mutationKey: ["feature-suggestion-submit"],
    mutationFn: submitFeatureSuggestion,
  });
}
