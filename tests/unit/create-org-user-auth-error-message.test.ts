/**
 * create-org-user → tela: a frase que a edge devolve quando o Supabase Auth
 * recusa a criação tem de chegar intacta ao admin.
 *
 * 2026-10-13: Auth recusou senha vazada (weak_password/pwned) em inglês; a edge
 * repassou o texto cru; `toAppError` o descartou (não é PT) e a tela mostrou
 * erro genérico com referência. Agora a edge traduz (`mapAuthCreateError`) e
 * este teste prova o elo do front: Equipe.tsx e MasterUsers.tsx passam o corpo
 * por `functionsErrorFromResponse` → `notifyError` → `toAppError`.
 */
import { describe, expect, it } from "vitest";
import { mapAuthCreateError } from "../../supabase/functions/_shared/auth-create-error";
import { isHumanPortugueseMessage, toAppError } from "@/shared/errors/to-app-error";
import { functionsErrorFromResponse } from "@/shared/errors/unwrap-functions-error";

const FALLBACK = "Não foi possível criar o usuário.";

const AUTH_REFUSALS = [
  {
    label: "caso real: senha vazada",
    err: {
      code: "weak_password",
      status: 422,
      message: "Password is known to be weak and easy to guess, please choose a different one.",
      reasons: ["pwned"],
    },
  },
  { label: "senha curta", err: { code: "weak_password", status: 422, message: "x", reasons: ["length"] } },
  { label: "tipos de caractere", err: { code: "weak_password", status: 422, message: "x", reasons: ["characters"] } },
  { label: "senha fraca genérica", err: { code: "weak_password", status: 422, message: "x" } },
  { label: "e-mail inválido", err: { code: "email_address_invalid", status: 400, message: "x" } },
  { label: "e-mail já cadastrado", err: { code: "email_exists", status: 422, message: "x" } },
  { label: "limite de tentativas", err: { code: "over_request_rate_limit", status: 429, message: "x" } },
  { label: "desconhecido", err: { code: "nope", status: 400, message: "Some technical failure" } },
];

describe("create-org-user: mensagem do Auth chega em português na tela", () => {
  for (const { label, err } of AUTH_REFUSALS) {
    it(label, () => {
      const mapped = mapAuthCreateError(err);
      expect(isHumanPortugueseMessage(mapped.message)).toBe(true);

      const body = {
        success: false,
        error: mapped.kind === "email_exists" ? "Conflict" : "Create failed",
        message: mapped.message,
      };
      const appError = toAppError(functionsErrorFromResponse(mapped.status, body), FALLBACK);
      expect(appError.userMessage).toBe(mapped.message);
    });
  }

  it("caso real não cai mais no genérico", () => {
    const mapped = mapAuthCreateError(AUTH_REFUSALS[0].err);
    const appError = toAppError(
      functionsErrorFromResponse(mapped.status, { success: false, error: "Create failed", message: mapped.message }),
      FALLBACK,
    );
    expect(appError.userMessage).not.toBe(FALLBACK);
    expect(appError.userMessage).toMatch(/vazamentos/);
  });
});
