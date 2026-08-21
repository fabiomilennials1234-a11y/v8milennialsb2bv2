import { describe, it, expect } from "vitest";
import { buildPermissionMap, type PermissionLayers } from "./resolvePermissionLayers";

const catalog = [
  { key: "leads.view_all", default_value: true },
  { key: "leads.delete", default_value: true },
  { key: "leads.export", default_value: false },
];

function layers(over: Partial<PermissionLayers> = {}): PermissionLayers {
  return { catalog, orgDefaults: {}, memberOverrides: {}, localOverrides: {}, ...over };
}

describe("buildPermissionMap — cascata de permissão", () => {
  it("sem nenhuma camada, vale o catálogo global", () => {
    expect(buildPermissionMap(layers())).toEqual({
      "leads.view_all": true,
      "leads.delete": true,
      "leads.export": false,
    });
  });

  it("o default da org sobrepõe o catálogo global", () => {
    const m = buildPermissionMap(layers({ orgDefaults: { "leads.view_all": false } }));
    expect(m["leads.view_all"]).toBe(false);
    expect(m["leads.delete"]).toBe(true); // não contaminou o resto
  });

  it("o override do membro sobrepõe o default da org", () => {
    const m = buildPermissionMap(
      layers({
        orgDefaults: { "leads.view_all": false },
        memberOverrides: { "leads.view_all": true },
      }),
    );
    expect(m["leads.view_all"]).toBe(true);
  });

  it("o override do membro vale mesmo sendo restritivo sobre org permissiva", () => {
    const m = buildPermissionMap(
      layers({
        orgDefaults: { "leads.view_all": true },
        memberOverrides: { "leads.view_all": false },
      }),
    );
    expect(m["leads.view_all"]).toBe(false);
  });

  it("a edição local em curso vence todas — é o que o usuário acabou de clicar", () => {
    const m = buildPermissionMap(
      layers({
        orgDefaults: { "leads.view_all": false },
        memberOverrides: { "leads.view_all": false },
        localOverrides: { "leads.view_all": true },
      }),
    );
    expect(m["leads.view_all"]).toBe(true);
  });

  it("`false` numa camada não é confundido com ausência", () => {
    // O bug clássico desta cascata: `orgDefaults[key] || global` trataria
    // false como "não definido" e cairia no global.
    const m = buildPermissionMap(layers({ orgDefaults: { "leads.delete": false } }));
    expect(m["leads.delete"]).toBe(false);
  });

  it("chave fora do catálogo é ignorada — a tela só mostra o que existe", () => {
    const m = buildPermissionMap(layers({ orgDefaults: { "inexistente.key": true } }));
    expect("inexistente.key" in m).toBe(false);
  });

  it("no modo 'padrão da organização' o override do membro não participa", () => {
    // Editando a política da ORG, o que está na linha de um membro específico
    // é irrelevante — senão o admin veria o valor de outra pessoa no toggle.
    const m = buildPermissionMap(
      layers({
        orgDefaults: { "leads.view_all": false },
        memberOverrides: { "leads.view_all": true },
      }),
      { scope: "org" },
    );
    expect(m["leads.view_all"]).toBe(false);
  });
});
