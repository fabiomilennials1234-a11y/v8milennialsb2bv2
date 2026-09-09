import { describe, it, expect } from "vitest";
import { DEFAULT_INBOX_FILTER, type InboxFilterState } from "./inboxFilter";
import {
  toServerFilter,
  UNFILTERED_PAGE_LIMIT,
  FILTERED_PAGE_LIMIT,
} from "./inboxFilterServer";

function state(over: Partial<InboxFilterState> = {}): InboxFilterState {
  return { ...DEFAULT_INBOX_FILTER, ...over };
}

describe("toServerFilter — filtro inativo", () => {
  it("não empurra nada e mantém a página e a chave de cache de sempre", () => {
    const r = toServerFilter(state(), "tm-1");
    expect(r.args).toBeNull();
    expect(r.limit).toBe(UNFILTERED_PAGE_LIMIT);
    expect(r.cacheKey).toBe("");
  });

  it('vendor "all" não é dimensão', () => {
    expect(toServerFilter(state({ vendor: "all" }), "tm-1").args).toBeNull();
  });
});

describe("toServerFilter — dimensões", () => {
  it("sobe o teto da página quando há filtro (issue #1277)", () => {
    const r = toServerFilter(state({ stages: ["esfriou"] }), null);
    expect(r.limit).toBe(FILTERED_PAGE_LIMIT);
  });

  it("passa etapa e funil como arrays", () => {
    const r = toServerFilter(state({ stages: ["esfriou"], funnels: ["pipe-1"] }), null);
    expect(r.args?.p_stages).toEqual(["esfriou"]);
    expect(r.args?.p_funnels).toEqual(["pipe-1"]);
  });

  it("mapeia tags, tiers, presença de lead, fonte e os toggles", () => {
    const r = toServerFilter(
      state({
        tags: ["tag-1"],
        tiers: ["ouro"],
        lead: "sem",
        source: "ia",
        unread: true,
        waiting: true,
        needsHuman: true,
      }),
      null,
    );
    expect(r.args).toMatchObject({
      p_tags: ["tag-1"],
      p_tiers: ["ouro"],
      p_lead_presence: "sem",
      p_source: "ia",
      p_unread: true,
      p_waiting: true,
      p_needs_human: true,
    });
  });

  it("toggle desligado não vira false — fica NULL (dimensão inativa)", () => {
    const r = toServerFilter(state({ stages: ["novo"] }), null);
    expect(r.args?.p_unread).toBeNull();
    expect(r.args?.p_waiting).toBeNull();
    expect(r.args?.p_needs_human).toBeNull();
  });
});

describe("toServerFilter — vendedor", () => {
  it('"unassigned" vira p_unassigned, não um id', () => {
    const r = toServerFilter(state({ vendor: "unassigned" }), "tm-1");
    expect(r.args?.p_unassigned).toBe(true);
    expect(r.args?.p_vendor_id).toBeNull();
  });

  it('"mine" resolve pro team_member atual', () => {
    const r = toServerFilter(state({ vendor: "mine" }), "tm-1");
    expect(r.args?.p_vendor_id).toBe("tm-1");
  });

  it('"mine" sem team_member não empurra nada — o cliente é quem esvazia a lista', () => {
    // Empurrar um palpite aqui esconderia conversa; o servidor é superconjunto.
    const r = toServerFilter(state({ vendor: "mine" }), null);
    expect(r.args).toBeNull();
  });

  it("id específico vai como p_vendor_id", () => {
    const r = toServerFilter(state({ vendor: "tm-9" }), "tm-1");
    expect(r.args?.p_vendor_id).toBe("tm-9");
  });
});

describe("toServerFilter — chave de cache", () => {
  it("é estável quando muda só a ordem de seleção", () => {
    const a = toServerFilter(state({ stages: ["novo", "esfriou"] }), null);
    const b = toServerFilter(state({ stages: ["esfriou", "novo"] }), null);
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it("separa recortes diferentes", () => {
    const a = toServerFilter(state({ stages: ["novo"] }), null);
    const b = toServerFilter(state({ stages: ["esfriou"] }), null);
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it("distingue dimensões distintas com o mesmo valor", () => {
    const a = toServerFilter(state({ tags: ["x"] }), null);
    const b = toServerFilter(state({ tiers: ["x"] }), null);
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });
});

describe("toServerFilter — aba de grupos (flag por org)", () => {
  it("sem a flag, a chamada é byte a byte a de hoje", () => {
    const r = toServerFilter(state(), "tm-1", {});
    expect(r.args).toBeNull();
    expect(r.limit).toBe(UNFILTERED_PAGE_LIMIT);
    expect(r.cacheKey).toBe("");
  });

  it("com a flag, empurra p_include_groups mesmo sem nenhum chip", () => {
    const r = toServerFilter(state(), "tm-1", { incluirGrupos: true });
    expect(r.args?.p_include_groups).toBe(true);
    // Grupo é ~40% das mensagens: uma página de 500 com grupo dentro mostraria
    // MENOS conversa individual que a de hoje.
    expect(r.limit).toBe(FILTERED_PAGE_LIMIT);
  });

  it("a org com grupo não divide cache com a org sem grupo", () => {
    // As duas listas dividiriam a mesma entrada com a bolha do kanban e o
    // command palette, e qual delas ganharia dependeria de quem montou antes.
    const sem = toServerFilter(state({ stages: ["novo"] }), null);
    const com = toServerFilter(state({ stages: ["novo"] }), null, { incluirGrupos: true });
    expect(com.cacheKey).not.toBe(sem.cacheKey);
  });

  it("convive com as outras dimensões sem apagá-las", () => {
    const r = toServerFilter(state({ tags: ["t1"], unread: true }), null, { incluirGrupos: true });
    expect(r.args?.p_tags).toEqual(["t1"]);
    expect(r.args?.p_unread).toBe(true);
    expect(r.args?.p_include_groups).toBe(true);
  });
});
