/**
 * message-preview — pure template resolver for the blast preview (#907).
 *
 * Renders the authored message as a sample Lead will receive it: known
 * variables are replaced with the sample's values, {{primeiro_nome}} takes the
 * first word of the name, and any unknown/absent token renders as empty string
 * (no fallback) — mirroring the Template Variable rule in CONTEXT.md.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePreview,
  type PreviewSample,
} from "@/modules/campaigns/components/disparo-wizard/message-preview";

const joao: PreviewSample = {
  nome: "João da Silva",
  empresa: "Petshop Amigo Fiel",
  segmento: "Petshop",
};

describe("resolvePreview", () => {
  it("replaces known variables with the sample's values", () => {
    expect(
      resolvePreview("Oi {{nome}}, aqui é da {{empresa}}.", joao),
    ).toBe("Oi João da Silva, aqui é da Petshop Amigo Fiel.");
  });

  it("uses only the first word for {{primeiro_nome}}", () => {
    expect(resolvePreview("Oi {{primeiro_nome}}!", joao)).toBe("Oi João!");
  });

  it("renders an unknown token as empty string (no fallback)", () => {
    expect(resolvePreview("Oi {{telefone}}fim", joao)).toBe("Oi fim");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(resolvePreview("{{ empresa }}", joao)).toBe("Petshop Amigo Fiel");
  });
});
