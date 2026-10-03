import { describe, expect, it } from "vitest";
import { metaOAuthErrorMessage } from "./meta-oauth-errors";

describe("metaOAuthErrorMessage", () => {
  it.each(["access_denied", "codigo_ausente", "state_invalido", "erro_ao_salvar_conexao"])(
    "%s tem mensagem própria, sem o código",
    (reason) => {
      const message = metaOAuthErrorMessage(reason);
      expect(message).not.toContain("_");
      expect(message).not.toMatch(/access denied/i);
    },
  );

  it("motivo desconhecido e interno caem na mensagem geral, sem vazar o código", () => {
    expect(metaOAuthErrorMessage("erro_interno")).toMatch(/^Não foi possível conectar ao Facebook/);
    expect(metaOAuthErrorMessage("some_oauth_error")).not.toContain("some");
    expect(metaOAuthErrorMessage(null)).toMatch(/^Não foi possível conectar ao Facebook/);
  });

  it("não confunde propriedade do Object com motivo", () => {
    expect(metaOAuthErrorMessage("constructor")).toMatch(/^Não foi possível conectar ao Facebook/);
  });
});
