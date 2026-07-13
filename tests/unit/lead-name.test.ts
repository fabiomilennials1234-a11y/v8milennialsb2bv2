/**
 * lead-name — placeholder detection + personalization guards.
 *
 * Origem: incidente Forever Bella 2026-07-13. Lead auto-criado no inbound sem
 * nome estruturado virou "WhatsApp 2952" (últimos 4 dígitos), e um workflow de
 * primeiro toque mandou "Boa tarde WhatsApp 2952, tudo bem?" — vazando o
 * placeholder pro cliente. Estes testes travam a supressão + limpeza da lacuna.
 */

import { describe, it, expect } from "vitest";
import {
  buildPlaceholderLeadName,
  isPlaceholderLeadName,
  personalizationName,
  tidyEmptyVarGaps,
} from "../../supabase/functions/_shared/lead-name.ts";

describe("buildPlaceholderLeadName", () => {
  it("uses last 4 phone digits when phone present", () => {
    expect(buildPlaceholderLeadName("5551993392952")).toBe("WhatsApp 2952");
  });
  it("falls back to Lead <ts> without phone", () => {
    expect(buildPlaceholderLeadName(null)).toMatch(/^Lead \d+$/);
  });
});

describe("isPlaceholderLeadName", () => {
  it.each([
    "WhatsApp 2952",
    "WhatsApp 952",
    "Lead 2952",
    "Lead 1720000000000",
    " WhatsApp 2952 ",
  ])("flags placeholder %s", (name) => {
    expect(isPlaceholderLeadName(name)).toBe(true);
  });

  it.each(["Letícia Ladeira Viegas", "WhatsApp", "Lead", "", null, undefined, "Ana 3"])(
    "keeps real/empty name %s",
    (name) => {
      expect(isPlaceholderLeadName(name)).toBe(false);
    },
  );
});

describe("personalizationName", () => {
  it("blanks placeholder names", () => {
    expect(personalizationName("WhatsApp 2952")).toBe("");
  });
  it("passes through real names", () => {
    expect(personalizationName("Letícia")).toBe("Letícia");
  });
});

describe("tidyEmptyVarGaps", () => {
  it("closes the gap after a blanked greeting name", () => {
    expect(tidyEmptyVarGaps("Boa tarde , tudo bem?")).toBe("Boa tarde, tudo bem?");
  });
  it("closes the gap before punctuation", () => {
    expect(tidyEmptyVarGaps("Oi !")).toBe("Oi!");
  });
  it("strips an orphan leading comma", () => {
    expect(tidyEmptyVarGaps(", seja bem-vindo")).toBe("seja bem-vindo");
  });
  it("leaves well-formed text untouched", () => {
    expect(tidyEmptyVarGaps("Oi Letícia, tudo bem?")).toBe("Oi Letícia, tudo bem?");
  });
});
