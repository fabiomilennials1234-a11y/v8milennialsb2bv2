import { assertEquals, assertMatch } from "@std/assert";
import type { WorkflowDefinition, WorkflowNode } from "../../_shared/workflow-schema/definition.ts";
import { asMessage, flowOrder, flowOverview, sendOf, sendSteps } from "./automation-steps.ts";

const MEDIA = "https://proj.supabase.co/storage/v1/object/public/media/workflow-assets/org/a.jpeg";
const DOC =
  "https://proj.supabase.co/storage/v1/object/public/media/workflow-assets/org/Proposta%20Acme.pdf";

const node = (id: string, data: Record<string, unknown>, type = "action"): WorkflowNode => ({
  id,
  type,
  data,
});

Deno.test("sendOf: text nodes read messageTemplate, like send-whatsapp.ts", () => {
  // The unified node as the builder saves it (shape seen in production).
  assertEquals(
    sendOf(node("n1", {
      actionType: "send_whatsapp_message",
      messageType: "texto",
      semiAutomatic: false,
      messageTemplate: "Oi {{primeiro_nome}}, conseguiu ver minha mensagem?",
    })),
    {
      kind: "texto",
      text: "Oi {{primeiro_nome}}, conseguiu ver minha mensagem?",
      media: null,
      blocked: null,
    },
  );
  assertEquals(
    sendOf(node("n", { actionType: "send_whatsapp", messageTemplate: "Oi" }))?.text,
    "Oi",
  );
  // messageType defaults to texto, as in the executor
  assertEquals(
    sendOf(node("n", { actionType: "send_whatsapp_message", messageTemplate: "Oi" }))?.kind,
    "texto",
  );
});

Deno.test("sendOf: a text the engine does not hold as fixed text is blocked, with the reason", () => {
  const ai = sendOf(node("n", {
    actionType: "send_whatsapp_message",
    messageType: "texto",
    templateMode: "ai",
    messageTemplate: "ignored",
  }))!;
  assertEquals([ai.kind, ai.blocked !== null], ["texto_ia", true]);
  const meta = sendOf(node("n", {
    actionType: "send_whatsapp",
    templateMode: "meta_template",
    templateName: "boas_vindas",
  }))!;
  assertEquals([meta.kind, meta.blocked !== null], ["template", true]);
  // legacy flag for the same mode
  assertEquals(
    sendOf(node("n", { actionType: "send_whatsapp", useTemplate: true }))?.kind,
    "template",
  );
});

Deno.test("sendOf: image reads imageUrl + imageCaption (NOT messageTemplate), like send-whatsapp-media.ts", () => {
  const img = sendOf(node("n", {
    actionType: "send_whatsapp_image",
    imageUrl: MEDIA,
    messageTemplate: "the executor never sends this",
    imageCaption: "Olha isso, {{primeiro_nome}}",
  }))!;
  assertEquals(img, {
    kind: "imagem",
    text: "Olha isso, {{primeiro_nome}}",
    media: { type: "image", url: MEDIA, name: null },
    blocked: null,
  });
  const unified = sendOf(node("n", {
    actionType: "send_whatsapp_message",
    messageType: "imagem",
    imageUrl: MEDIA,
  }))!;
  assertEquals([unified.kind, unified.text, unified.media?.type], ["imagem", "", "image"]);
});

Deno.test("sendOf: media outside the project's public media bucket is blocked (the engine refuses it)", () => {
  for (
    const url of [
      "https://evil.example/storage/v1/object/private/media/x.jpg",
      "http://proj.supabase.co/storage/v1/object/public/media/x.jpg",
      "https://cdn.example.com/x.jpg",
      "not a url",
      "",
    ]
  ) {
    const s = sendOf(node("n", { actionType: "send_whatsapp_image", imageUrl: url }))!;
    assertEquals([s.media, s.blocked !== null], [null, true], url);
  }
});

Deno.test("sendOf: document carries the name the lead sees; falls back to the file name", () => {
  const named = sendOf(node("n", {
    actionType: "send_whatsapp_document",
    documentUrl: DOC,
    documentName: "Proposta.pdf",
    documentCaption: "Segue a proposta",
  }))!;
  assertEquals(named.media, { type: "document", url: DOC, name: "Proposta.pdf" });
  assertEquals(named.text, "Segue a proposta");
  const unnamed = sendOf(node("n", { actionType: "send_whatsapp_document", documentUrl: DOC }))!;
  assertEquals(unnamed.media?.name, "Proposta Acme.pdf");
  assertEquals(unnamed.blocked, null);
});

Deno.test("sendOf: kinds the Disparo cannot send are listed but blocked", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ actionType: "send_whatsapp_audio", audioUrl: MEDIA }, "audio"],
    [{ actionType: "send_whatsapp_message", messageType: "audio" }, "audio"],
    [{ actionType: "send_whatsapp_video", videoUrl: MEDIA, videoCaption: "c" }, "video"],
    [{ actionType: "send_whatsapp_sticker" }, "figurinha"],
    [{ actionType: "send_whatsapp_template", templateName: "x" }, "template"],
    [{ actionType: "send_whatsapp_menu" }, "menu"],
    [{ actionType: "send_whatsapp_pix_button" }, "pix"],
    [{ actionType: "send_meta_message" }, "canal_oficial"],
    [{ actionType: "send_to_group", messageTemplate: "Lead novo" }, "equipe"],
    [{ actionType: "send_to_number", messageTemplate: "Lead novo" }, "equipe"],
  ];
  for (const [data, kind] of cases) {
    const s = sendOf(node("n", data))!;
    assertEquals([s.kind, s.blocked !== null], [kind, true], JSON.stringify(data));
  }
});

Deno.test("sendOf: semi-automatic sends one text (semiAutoMessage first)", () => {
  assertEquals(
    sendOf(node("n", {
      actionType: "send_whatsapp_message",
      semiAutomatic: true,
      semiAutoMessage: "Rascunho",
      messageTemplate: "Outro",
    }))?.text,
    "Rascunho",
  );
  assertEquals(
    sendOf(node("n", { actionType: "send_semi_automatic", semiAutoMessage: "Oi" }))?.kind,
    "texto",
  );
});

Deno.test("sendOf: nodes that message nobody are not sends", () => {
  assertEquals(sendOf(node("n", { actionType: "move_stage" })), null);
  assertEquals(sendOf(node("n", { actionType: "add_tag" })), null);
  assertEquals(sendOf(node("n", { label: "Esperar" }, "delay")), null);
  assertEquals(sendOf(node("n", { label: "?" }, "condition")), null);
  // the engine fails an unknown messageType — nothing to copy
  assertEquals(sendOf(node("n", { actionType: "send_whatsapp_message", messageType: "x" })), null);
});

// trigger → wait → condition (yes → A, no → B) → A → C ; plus an orphan and a dangling edge
const FLOW: WorkflowDefinition = {
  nodes: [
    node("c", { actionType: "send_whatsapp", messageTemplate: "C", label: "Terceira" }),
    node("orphan", { actionType: "send_whatsapp", messageTemplate: "solta" }),
    node("b", { actionType: "send_whatsapp", messageTemplate: "B" }),
    node("t", { label: "Entrou na etapa" }, "trigger"),
    node("w", { label: "Esperar 1 dia" }, "delay"),
    node("if", { label: "Respondeu?" }, "condition"),
    node("a", { actionType: "send_whatsapp", messageTemplate: "A", label: "Primeira" }),
  ],
  edges: [
    { id: "1", source: "t", target: "w" },
    { id: "2", source: "w", target: "if" },
    { id: "3", source: "if", target: "a", sourceHandle: "yes" },
    { id: "4", source: "if", target: "b", sourceHandle: "no" },
    { id: "5", source: "a", target: "c" },
    { id: "6", source: "c", target: "a" }, // loop back: visited once
    { id: "7", source: "a", target: "ghost" }, // edge to a node that does not exist
  ],
};

Deno.test("flowOrder: breadth-first from the trigger, edge order breaks ties, unreachable last", () => {
  assertEquals(flowOrder(FLOW), ["t", "w", "if", "a", "b", "c", "orphan"]);
});

Deno.test("flowOrder: no trigger → starts at nodes without incoming edges; garbage is tolerated", () => {
  assertEquals(
    flowOrder({
      nodes: [node("x", {}), node("y", {})],
      edges: [{ id: "1", source: "y", target: "x" }],
    }),
    ["y", "x"],
  );
  assertEquals(flowOrder(null), []);
  assertEquals(
    flowOrder({ nodes: undefined, edges: undefined } as unknown as WorkflowDefinition),
    [],
  );
});

Deno.test("sendSteps: only sends, numbered along the flow, with their labels", () => {
  assertEquals(
    sendSteps(FLOW).map((s) => [s.order, s.node_id, s.label, s.text]),
    [[1, "a", "Primeira", "A"], [2, "b", null, "B"], [3, "c", "Terceira", "C"], [
      4,
      "orphan",
      null,
      "solta",
    ]],
  );
});

Deno.test("asMessage: a variable the Disparo does not fill makes it not broadcastable, naming it", () => {
  const [m] = sendSteps({
    nodes: [
      node("t", {}, "trigger"),
      node("n", {
        actionType: "send_whatsapp_message",
        messageType: "texto",
        messageTemplate:
          "{{saudacao}} {{primeiro_nome}}! Sua reunião é {{dia_reuniao}} às {{hora_reuniao}}",
      }),
    ],
    edges: [{ id: "1", source: "t", target: "n" }],
  }).map(asMessage);
  assertEquals(m.variables, ["saudacao", "primeiro_nome", "dia_reuniao", "hora_reuniao"]);
  assertEquals(m.broadcastable, false);
  assertMatch(
    m.not_broadcastable_because!,
    /\{\{saudacao\}\}, \{\{dia_reuniao\}\}, \{\{hora_reuniao\}\}/,
  );
  assertEquals("blocked" in m, false); // internal field is not exposed
});

Deno.test("asMessage: plain or supported text is broadcastable; a captionless image too; empty text is not", () => {
  const msgs = sendSteps({
    nodes: [
      node("a", {
        actionType: "send_whatsapp",
        messageTemplate: "Oi {{primeiro_nome}} da {{empresa}}",
      }),
      node("b", { actionType: "send_whatsapp_image", imageUrl: MEDIA }),
      node("c", { actionType: "send_whatsapp", messageTemplate: "   " }),
      node("d", { actionType: "send_whatsapp_audio", audioUrl: MEDIA }),
    ],
    edges: [],
  }).map(asMessage);
  assertEquals(msgs.map((m) => m.broadcastable), [true, true, false, false]);
  assertMatch(msgs[2].not_broadcastable_because!, /não tem texto/);
  assertMatch(msgs[3].not_broadcastable_because!, /áudio/);
});

Deno.test("flowOverview: the flow in order, type and label, capped", () => {
  const o = flowOverview(FLOW, 3);
  assertEquals(o, [
    { node_id: "t", type: "trigger", label: "Entrou na etapa" },
    { node_id: "w", type: "delay", label: "Esperar 1 dia" },
    { node_id: "if", type: "condition", label: "Respondeu?" },
  ]);
});
