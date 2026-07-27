import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractInteractiveSelection } from "./interactive-reply.ts";

// Payload REAL capturado em prod (Carol Distribuidora / Renan Braga) — o lead
// tocou a opção "3" de um menu de botões. Antes: chat mostrava só o id citado.
const REAL_BUTTON_REPLY = {
  id: "558521367202:AC256D5D6D6E0EEE147B45988FB0E066",
  text: "",
  type: "text",
  vote: "3",
  quoted: "3EB0CEDD31B834C6863D67",
  content: {
    selectedID: "3",
    selectedIndex: 2,
    selectedDisplayText: "3",
    contextInfo: { stanzaID: "3EB0CEDD31B834C6863D67" },
  },
  messageType: "TemplateButtonReplyMessage",
  buttonOrListid: "3",
};

Deno.test("REGRESSÃO: extrai a opção do payload real (selectedDisplayText='3')", () => {
  assertEquals(extractInteractiveSelection(REAL_BUTTON_REPLY), "3");
});

Deno.test("fallback pra buttonOrListid quando content ausente", () => {
  assertEquals(extractInteractiveSelection({ buttonOrListid: "2" }), "2");
});

Deno.test("fallback pra vote", () => {
  assertEquals(extractInteractiveSelection({ vote: "1" }), "1");
});

Deno.test("formas planas antigas ainda funcionam", () => {
  assertEquals(extractInteractiveSelection({ selectedDisplayText: "Sim" }), "Sim");
  assertEquals(extractInteractiveSelection({ listResponse: { title: "Plano Ouro" } }), "Plano Ouro");
});

Deno.test("mensagem de texto normal (sem seleção) → null", () => {
  assertEquals(extractInteractiveSelection({ type: "text", text: "bom dia", content: {} }), null);
  assertEquals(extractInteractiveSelection({}), null);
  assertEquals(extractInteractiveSelection(null), null);
});
