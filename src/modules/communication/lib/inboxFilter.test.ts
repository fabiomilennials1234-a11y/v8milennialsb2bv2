import { describe, it, expect } from "vitest";
import {
  applyInboxFilters,
  countActiveFilters,
  isDefaultFilter,
  DEFAULT_INBOX_FILTER,
  type InboxFilterState,
  type InboxFilterContext,
} from "./inboxFilter";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

// ─── Fixtures ───────────────────────────────────────────────────────────────

let seq = 0;
function contact(over: Partial<ChatContact> = {}): ChatContact {
  seq += 1;
  return {
    channel: "whatsapp",
    instance_id: `inst-${seq}`,
    phone_number: `5548999${String(seq).padStart(6, "0")}`,
    push_name: `Contato ${seq}`,
    last_message: "oi",
    last_message_time: "2026-07-23T00:00:00Z",
    last_message_direction: "outgoing",
    last_message_sent_source: "manual",
    unread_count: 0,
    lead_id: `lead-${seq}`,
    lead_name: `Lead ${seq}`,
    conversation_id: `conv-${seq}`,
    archived_at: null,
    tags: [],
    is_group: false,
    funnels: [],
    qualification_tier: null,
    ...over,
  };
}

function state(over: Partial<InboxFilterState> = {}): InboxFilterState {
  return { ...DEFAULT_INBOX_FILTER, ...over };
}

const ctx = (over: Partial<InboxFilterContext> = {}): InboxFilterContext => ({
  currentTeamMemberId: "me",
  resolveVendorId: (c) => (c.lead_id === "lead-vendor-x" ? "vendor-x" : null),
  waitingHumanLeadIds: new Set<string>(),
  ...over,
});

const names = (cs: ChatContact[]) => cs.map((c) => c.lead_name);

// ─── Escopo básico ──────────────────────────────────────────────────────────

describe("applyInboxFilters — escopo", () => {
  it("remove grupos por padrão (org sem a aba nunca passa tab)", () => {
    const cs = [contact({ lead_name: "individual" }), contact({ is_group: true, lead_name: "grupo" })];
    const out = applyInboxFilters(cs, state(), ctx());
    expect(names(out)).toEqual(["individual"]);
  });

  it("remove grupos mesmo com o estado antigo pedindo showGroups", () => {
    // O toggle "Grupos" saiu do produto (#1632): a captura já está desligada
    // nas 104 orgs e o webhook dropa mensagem de grupo, então o que sobrava era
    // histórico congelado atrás de um controle que o próprio membro ligava.
    //
    // Este caso existe porque REMOVER o controle não basta: estado antigo
    // persistido, uma saved view ou um chamador que ainda passe o campo
    // ressuscitariam a lista. O engine tem que recusar grupo sem consultar
    // ninguém.
    const cs = [contact({ lead_name: "individual" }), contact({ is_group: true, lead_name: "grupo" })];
    const legado = { ...state(), showGroups: true } as unknown as InboxFilterState;
    const out = applyInboxFilters(cs, legado, ctx());
    expect(names(out)).toEqual(["individual"]); // controle positivo junto
  });

  it("showGroups não existe mais no estado padrão", () => {
    expect("showGroups" in DEFAULT_INBOX_FILTER).toBe(false);
  });

  it("tab active esconde arquivadas; archived só mostra arquivadas", () => {
    const cs = [
      contact({ lead_name: "viva", archived_at: null }),
      contact({ lead_name: "morta", archived_at: "2026-07-01T00:00:00Z" }),
    ];
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "active" }))).toEqual(["viva"]);
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "archived" }))).toEqual(["morta"]);
  });

  it("tab grupos: só grupo, e nenhuma das outras duas abas o mostra", () => {
    const cs = [
      contact({ lead_name: "individual" }),
      contact({ is_group: true, lead_name: "grupo" }),
    ];
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "grupos" }))).toEqual(["grupo"]);
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "active" }))).toEqual(["individual"]);
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "archived" }))).toEqual([]);
  });

  it("tab grupos esconde grupo arquivado", () => {
    // "Grupos" é escopo de conversa VIVA, como "Ativas". Arquivada sai de lá e
    // continua alcançável pela aba de arquivadas — que, por sua vez, não mostra
    // grupo nenhum (o escopo dela é o de #1632).
    const cs = [
      contact({ is_group: true, lead_name: "grupo vivo" }),
      contact({ is_group: true, lead_name: "grupo morto", archived_at: "2026-09-01T00:00:00Z" }),
    ];
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "grupos" }))).toEqual(["grupo vivo"]);
    expect(names(applyInboxFilters(cs, state(), ctx(), { tab: "archived" }))).toEqual([]);
  });

  it("busca casa por nome e por telefone, case-insensitive", () => {
    const cs = [
      contact({ lead_name: "Maria Silva", phone_number: "5548911112222" }),
      contact({ lead_name: "João Souza", phone_number: "5548933334444" }),
    ];
    expect(names(applyInboxFilters(cs, state(), ctx(), { searchQuery: "maria" }))).toEqual(["Maria Silva"]);
    expect(names(applyInboxFilters(cs, state(), ctx(), { searchQuery: "3333" }))).toEqual(["João Souza"]);
  });
});

// ─── Dimensões individuais ──────────────────────────────────────────────────

describe("applyInboxFilters — dimensões", () => {
  it("unread só passa não-lidas", () => {
    const cs = [contact({ lead_name: "lida", unread_count: 0 }), contact({ lead_name: "nova", unread_count: 3 })];
    expect(names(applyInboxFilters(cs, state({ unread: true }), ctx()))).toEqual(["nova"]);
  });

  it("waiting só passa quando última msg é do lead (incoming)", () => {
    const cs = [
      contact({ lead_name: "eu-respondi", last_message_direction: "outgoing" }),
      contact({ lead_name: "no-vacuo", last_message_direction: "incoming" }),
    ];
    expect(names(applyInboxFilters(cs, state({ waiting: true }), ctx()))).toEqual(["no-vacuo"]);
  });

  it("needsHuman usa waitingHumanLeadIds", () => {
    const cs = [contact({ lead_id: "a", lead_name: "pediu" }), contact({ lead_id: "b", lead_name: "ok" })];
    const out = applyInboxFilters(cs, state({ needsHuman: true }), ctx({ waitingHumanLeadIds: new Set(["a"]) }));
    expect(names(out)).toEqual(["pediu"]);
  });

  it("source ia casa copilot/workflow; humano casa manual; null-source nunca é ia", () => {
    const cs = [
      contact({ lead_name: "cop", last_message_sent_source: "copilot" }),
      contact({ lead_name: "wf", last_message_sent_source: "workflow" }),
      contact({ lead_name: "man", last_message_sent_source: "manual" }),
      contact({ lead_name: "nulo", last_message_sent_source: null }),
    ];
    expect(names(applyInboxFilters(cs, state({ source: "ia" }), ctx())).sort()).toEqual(["cop", "wf"]);
    expect(names(applyInboxFilters(cs, state({ source: "humano" }), ctx()))).toEqual(["man"]);
  });

  it("lead com/sem", () => {
    const cs = [contact({ lead_name: "com", lead_id: "x" }), contact({ lead_name: "sem", lead_id: null })];
    expect(names(applyInboxFilters(cs, state({ lead: "com" }), ctx()))).toEqual(["com"]);
    expect(names(applyInboxFilters(cs, state({ lead: "sem" }), ctx()))).toEqual(["sem"]);
  });

  it("tiers OR entre valores", () => {
    const cs = [
      contact({ lead_name: "d", qualification_tier: "diamante" }),
      contact({ lead_name: "o", qualification_tier: "ouro" }),
      contact({ lead_name: "b", qualification_tier: "bronze" }),
      contact({ lead_name: "n", qualification_tier: null }),
    ];
    const out = applyInboxFilters(cs, state({ tiers: ["diamante", "ouro"] }), ctx());
    expect(names(out).sort()).toEqual(["d", "o"]);
  });

  it("tags OR — conversa passa se tiver qualquer tag selecionada", () => {
    const cs = [
      contact({ lead_name: "ouro", tags: [{ id: "t-ouro", name: "Ouro", color: "#fff" }] }),
      contact({ lead_name: "prata", tags: [{ id: "t-prata", name: "Prata", color: "#ccc" }] }),
      contact({ lead_name: "sem", tags: [] }),
    ];
    const out = applyInboxFilters(cs, state({ tags: ["t-ouro"] }), ctx());
    expect(names(out)).toEqual(["ouro"]);
  });
});

// ─── Vendedor ───────────────────────────────────────────────────────────────

describe("applyInboxFilters — vendedor", () => {
  const resolveVendorId = (c: ChatContact) => (c.lead_id ? (c.lead_id.startsWith("v1") ? "v1" : "v2") : null);

  it("mine casa vendedor == currentTeamMemberId", () => {
    const cs = [contact({ lead_name: "meu", lead_id: "v1-a" }), contact({ lead_name: "outro", lead_id: "v2-a" })];
    const out = applyInboxFilters(cs, state({ vendor: "mine" }), ctx({ currentTeamMemberId: "v1", resolveVendorId }));
    expect(names(out)).toEqual(["meu"]);
  });

  it("unassigned casa conversas sem vendedor (sem lead)", () => {
    const cs = [contact({ lead_name: "com", lead_id: "v1-a" }), contact({ lead_name: "sem", lead_id: null })];
    const out = applyInboxFilters(cs, state({ vendor: "unassigned" }), ctx({ resolveVendorId }));
    expect(names(out)).toEqual(["sem"]);
  });

  it("id específico casa só aquele vendedor", () => {
    const cs = [contact({ lead_name: "v1", lead_id: "v1-a" }), contact({ lead_name: "v2", lead_id: "v2-a" })];
    const out = applyInboxFilters(cs, state({ vendor: "v2" }), ctx({ resolveVendorId }));
    expect(names(out)).toEqual(["v2"]);
  });
});

// ─── Funil + Etapa (honra multi-pipe) ───────────────────────────────────────

describe("applyInboxFilters — funil e etapa", () => {
  it("funil casa se o lead tem entry em qualquer funil selecionado", () => {
    const cs = [
      contact({ lead_name: "opp", funnels: [{ pipelineId: "p-opp", stageKey: "novo" }] }),
      contact({ lead_name: "orc", funnels: [{ pipelineId: "p-orc", stageKey: "enviada" }] }),
    ];
    const out = applyInboxFilters(cs, state({ funnels: ["p-opp"] }), ctx());
    expect(names(out)).toEqual(["opp"]);
  });

  it("lead em múltiplos funis aparece em ambos os recortes", () => {
    const multi = contact({
      lead_name: "multi",
      funnels: [
        { pipelineId: "p-opp", stageKey: "agendado" },
        { pipelineId: "p-orc", stageKey: "enviada" },
      ],
    });
    expect(names(applyInboxFilters([multi], state({ funnels: ["p-opp"] }), ctx()))).toEqual(["multi"]);
    expect(names(applyInboxFilters([multi], state({ funnels: ["p-orc"] }), ctx()))).toEqual(["multi"]);
  });

  it("etapa sem funil selecionado casa qualquer entrada com aquela stage_key", () => {
    const cs = [
      contact({ lead_name: "ag", funnels: [{ pipelineId: "p-opp", stageKey: "agendado" }] }),
      contact({ lead_name: "no", funnels: [{ pipelineId: "p-opp", stageKey: "novo" }] }),
    ];
    const out = applyInboxFilters(cs, state({ stages: ["agendado"] }), ctx());
    expect(names(out)).toEqual(["ag"]);
  });

  it("não crasha quando um contato chega sem funnels (path sem enrichment)", () => {
    // Regressão: contato de path sem enrichment pode ter funnels === undefined.
    const broken = contact({ lead_name: "cru" });
    delete broken.funnels; // funnels é opcional — simula path sem enrichment

    expect(() => applyInboxFilters([broken], state({ funnels: ["p-opp"] }), ctx())).not.toThrow();
    expect(applyInboxFilters([broken], state({ stages: ["novo"] }), ctx())).toEqual([]);
  });

  it("etapa + funil: a etapa só conta dentro do funil escolhido (evita colisão de stage_key)", () => {
    // Duas conversas com a mesma stage_key "novo", em funis diferentes.
    const cs = [
      contact({ lead_name: "novo-opp", funnels: [{ pipelineId: "p-opp", stageKey: "novo" }] }),
      contact({ lead_name: "novo-orc", funnels: [{ pipelineId: "p-orc", stageKey: "novo" }] }),
    ];
    const out = applyInboxFilters(cs, state({ funnels: ["p-opp"], stages: ["novo"] }), ctx());
    expect(names(out)).toEqual(["novo-opp"]);
  });
});

// ─── Combinação AND entre dimensões ─────────────────────────────────────────

describe("applyInboxFilters — combinação AND", () => {
  it("dimensões diferentes combinam com AND", () => {
    const cs = [
      contact({
        lead_name: "match",
        unread_count: 2,
        qualification_tier: "diamante",
        funnels: [{ pipelineId: "p-opp", stageKey: "agendado" }],
      }),
      contact({
        lead_name: "so-tier",
        unread_count: 0,
        qualification_tier: "diamante",
        funnels: [{ pipelineId: "p-opp", stageKey: "agendado" }],
      }),
      contact({
        lead_name: "so-unread",
        unread_count: 5,
        qualification_tier: "bronze",
        funnels: [{ pipelineId: "p-opp", stageKey: "agendado" }],
      }),
    ];
    const out = applyInboxFilters(cs, state({ unread: true, tiers: ["diamante"], funnels: ["p-opp"] }), ctx());
    expect(names(out)).toEqual(["match"]);
  });
});

// ─── Helpers de contagem ────────────────────────────────────────────────────

describe("countActiveFilters / isDefaultFilter", () => {
  it("default = 0 ativos", () => {
    expect(countActiveFilters(DEFAULT_INBOX_FILTER)).toBe(0);
    expect(isDefaultFilter(DEFAULT_INBOX_FILTER)).toBe(true);
  });

  it("conta cada dimensão ativa uma vez", () => {
    const s = state({ unread: true, vendor: "v1", funnels: ["p"], stages: ["novo"], tiers: ["ouro"], source: "ia" });
    expect(countActiveFilters(s)).toBe(6);
    expect(isDefaultFilter(s)).toBe(false);
  });
});
