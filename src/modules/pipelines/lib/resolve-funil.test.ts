import { describe, expect, it } from "vitest";
import { resolveFunil } from "./resolve-funil";

const funis = [
  { id: "5f0e8a3c-1111-4222-8333-444455556666", slug: "whatsapp", is_active: true },
  { id: "5f0e8a3c-aaaa-4bbb-8ccc-ddddeeee0000", slug: "prospeccao-cnae", is_active: true },
  { id: "5f0e8a3c-9999-4888-8777-666655554444", slug: "desativado", is_active: false },
];

describe("resolveFunil — rota única /funil/:slug (SCRUM-632)", () => {
  it("resolve por slug (alias)", () => {
    expect(resolveFunil(funis, "prospeccao-cnae")?.id).toBe("5f0e8a3c-aaaa-4bbb-8ccc-ddddeeee0000");
  });

  it("resolve por uuid (canônico)", () => {
    expect(resolveFunil(funis, "5f0e8a3c-1111-4222-8333-444455556666")?.slug).toBe("whatsapp");
  });

  it("uuid não vaza pra busca por slug (e vice-versa)", () => {
    // Um uuid que não existe NÃO pode casar um slug por coincidência textual.
    expect(resolveFunil(funis, "5f0e8a3c-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("funil desativado não resolve — nem por slug, nem por id", () => {
    expect(resolveFunil(funis, "desativado")).toBeUndefined();
    expect(resolveFunil(funis, "5f0e8a3c-9999-4888-8777-666655554444")).toBeUndefined();
  });

  it("param ausente devolve undefined", () => {
    expect(resolveFunil(funis, undefined)).toBeUndefined();
    expect(resolveFunil(funis, "")).toBeUndefined();
  });
});
