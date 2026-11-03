import { describe, expect, it } from "vitest";

import { hojeLocal, novidadeNoPrazo } from "./novidade";

describe("novidadeNoPrazo", () => {
  const item = { novo: { id: "x", ate: "2026-12-03" } };
  it("vale até o último dia, inclusive", () => {
    expect(novidadeNoPrazo(item, "2026-11-03")).toBe(true);
    expect(novidadeNoPrazo(item, "2026-12-03")).toBe(true);
    expect(novidadeNoPrazo(item, "2026-12-04")).toBe(false);
  });
  it("item sem novidade ou com data ilegível não mostra", () => {
    expect(novidadeNoPrazo({}, "2026-11-03")).toBe(false);
    expect(novidadeNoPrazo({ novo: { id: "x", ate: "amanhã" } }, "2026-11-03")).toBe(false);
  });
  it("hojeLocal usa o calendário local, com zero à esquerda", () => {
    expect(hojeLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
