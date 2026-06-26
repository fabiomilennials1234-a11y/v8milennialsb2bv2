import { assertEquals } from "@std/assert";
import { type AgentRow, agentRowToComposeInput, mergeSections } from "./reconstruct.ts";

const DEFAULT_SECTIONS = {
  personality: "",
  objective: "",
  flow: "",
  products: "",
  instructions: "",
};

Deno.test("mergeSections: merge parcial sobre default + atual", () => {
  const cur = { ...DEFAULT_SECTIONS, personality: "A", objective: "B" };
  assertEquals(mergeSections(cur, { objective: "B2", flow: "F" }), {
    personality: "A",
    objective: "B2",
    flow: "F",
    products: "",
    instructions: "",
  });
});

Deno.test("reconstruct: flags can_* -> tools enabled (vivas, não load-lossy)", () => {
  const row: AgentRow = {
    conversation_style: {
      promptSections: { ...DEFAULT_SECTIONS, personality: "Ana" },
      toolInstructions: { AGENDAR_REUNIAO: "link X" },
    },
    can_qualify_lead: true,
    can_schedule_meeting: true,
    can_move_cards: false,
    can_transfer_human: false,
    can_create_lead: false,
    can_update_lead: true,
    can_send_document: true,
    can_transfer_sz_chat: false,
    human_pause_enabled: true,
  };
  const input = agentRowToComposeInput(row, []);
  const enabled = input.tools.filter((t) => t.enabled).map((t) => t.id).sort();
  assertEquals(
    enabled,
    [
      "AGENDAR_REUNIAO",
      "ENVIAR_DOCUMENTO",
      "PAUSAR_ATENDIMENTO_HUMANO",
      "PREENCHER_CAMPOS",
      "QUALIFICAR_LEAD",
    ]
      .sort(),
  );
  assertEquals(input.tools.find((t) => t.id === "AGENDAR_REUNIAO")?.instruction, "link X");
  assertEquals(input.tools.find((t) => t.id === "QUALIFICAR_LEAD")?.instruction, "");
});

Deno.test("reconstruct: documents mapeados; links sempre []", () => {
  const row: AgentRow = { conversation_style: { promptSections: DEFAULT_SECTIONS } };
  const input = agentRowToComposeInput(row, [
    { id: "d1", file_name: "C.png", file_type: "image", description: "cat", send_when: null },
  ]);
  assertEquals(input.documents, [
    { id: "d1", name: "C.png", fileType: "image", description: "cat", sendWhen: "" },
  ]);
  assertEquals(input.links, []);
});

Deno.test("reconstruct: promptSections ausente -> default 5 vazias", () => {
  const input = agentRowToComposeInput({ conversation_style: null }, []);
  assertEquals(input.promptSections, DEFAULT_SECTIONS);
});
