import { assertEquals } from "@std/assert";

import { montarPayload, type AvisoParaPush } from "./payload.ts";

function aviso(over: Partial<AvisoParaPush> = {}): AvisoParaPush {
  return {
    aviso_id: "aviso-1",
    user_id: "user-1",
    organization_id: "org-1",
    type: "lead_message",
    title: "Marcos Andrade",
    description: "Consigo fechar hoje",
    link: "/chat",
    group_key: "msg:lead-1",
    ...over,
  };
}

Deno.test("mensagem de lead leva o nome de quem falou no título", () => {
  const payload = montarPayload(aviso());

  assertEquals(payload.title, "Marcos Andrade");
  assertEquals(payload.body, "Consigo fechar hoje");
  assertEquals(payload.url, "/chat");
});

Deno.test("automação parada se anuncia como tal, não como o nome do workflow", () => {
  const payload = montarPayload(
    aviso({ type: "workflow_alert", title: "Nutrição D+3", description: "4 falhas", link: "/automacoes" }),
  );

  assertEquals(payload.title, "Automação parada");
  assertEquals(payload.body, "Nutrição D+3");
});

Deno.test("a tag agrupa no sistema pela mesma chave que agrupa no CRM", () => {
  assertEquals(montarPayload(aviso()).tag, "msg:lead-1");
  assertEquals(montarPayload(aviso({ group_key: null })).tag, "aviso-1");
});

Deno.test("Aviso sem link não manda o clique para lugar nenhum", () => {
  assertEquals(montarPayload(aviso({ link: null })).url, "/");
});
