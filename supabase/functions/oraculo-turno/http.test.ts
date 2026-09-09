import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@^1.0.0";
import { CONVERSA_A, ORG_A, ORG_B, OWNER_TM, SEGREDO, withOracle } from "./http-fixture.ts";

Deno.test("HTTP — conversa de outra organização não entra no contexto do usuário multi-org", async () => {
  await withOracle(async (_services, post) => {
    const res = await post({ organization_id: ORG_B, conversa_id: CONVERSA_A, pergunta: "Qual era o contrato?" });
    const body = await res.json();
    assertEquals(res.status, 200);
    assertNotEquals(body.resposta, SEGREDO);
    assertNotEquals(body.conversa_id, CONVERSA_A);
  });
});

Deno.test("HTTP — conversa_detalhe devolve a conversa ao responsável e vazio ao colega", async () => {
  await withOracle(async (services, post) => {
    const toolCall = () => Response.json({ model: "test-model", choices: [{ message: {
      tool_calls: [{ id: "call-conversa", type: "function", function: {
        name: "conversa_detalhe",
        arguments: JSON.stringify({
          lead_id: "50000000-0000-4000-8000-000000000001",
          instance_id: "60000000-0000-4000-8000-000000000001",
        }),
      } }],
    } }] });
    services.model = (body) => services.modelRequests.length === 1
      ? toolCall()
      : services.completion(JSON.stringify(body.messages).includes(SEGREDO) ? SEGREDO : "[]");

    const member = services.tables.team_members.find((row) => row.organization_id === ORG_A)!;
    Object.assign(member, { id: OWNER_TM, role: "member" });
    const owner = await post({ organization_id: ORG_A, pergunta: "Mostre a conversa." });
    assertEquals(owner.status, 200);
    assertEquals((await owner.json()).resposta, SEGREDO);

    services.currentUser = "10000000-0000-4000-8000-000000000099";
    services.tables.team_members.push({
      id: "40000000-0000-4000-8000-000000000099",
      user_id: services.currentUser,
      organization_id: ORG_A,
      role: "member",
      is_active: true,
    });
    services.modelRequests.length = 0;
    const colleague = await post({ organization_id: ORG_A, pergunta: "Mostre a conversa." });
    assertEquals(colleague.status, 200);
    assertEquals((await colleague.json()).resposta, "[]");
  });
});

Deno.test("HTTP — falha ao ler limite da organização não adota quota padrão", async () => {
  await withOracle(async (services, post) => {
    services.failRead = "organizations";
    const res = await post({ organization_id: ORG_A, pergunta: "Continue." });
    assertEquals(res.status, 500);
    assertEquals(services.modelRequests.length, 0);
  });
});

Deno.test("HTTP — resposta concorrente não sobrescreve memória de turno já confirmado", async () => {
  await withOracle(async (services, post) => {
    let modelEntered!: () => void;
    const entered = new Promise<void>((resolve) => { modelEntered = resolve; });
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    services.model = () => {
      if (services.modelRequests.length === 1) { modelEntered(); return pending; }
      return services.completion("Resposta confirmada.");
    };
    const first = post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Primeira pergunta" });
    await entered;
    const second = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Segunda pergunta" });
    release(services.completion("Resposta atrasada."));
    assertEquals(second.status, 200);
    assertEquals((await first).status, 409);
    const history = await services.fetch(`http://127.0.0.1:54399/rest/v1/oraculo_turns?conversation_id=eq.${CONVERSA_A}`);
    assertEquals((await history.json()).map((turn: { content: string }) => turn.content),
      [SEGREDO, "Segunda pergunta", "Resposta confirmada."]);
  });
});

Deno.test("HTTP — outra pessoa da mesma organização não reutiliza conversa alheia", async () => {
  await withOracle(async (services, post) => {
    services.currentUser = "10000000-0000-4000-8000-000000000002";
    services.tables.team_members.push({ id: crypto.randomUUID(), user_id: services.currentUser,
      organization_id: ORG_A, role: "admin", is_active: true });
    const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Qual era o contrato?" });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertNotEquals(body.resposta, SEGREDO);
    assertNotEquals(body.conversa_id, CONVERSA_A);
  });
});

Deno.test("HTTP — seis ferramentas válidas são consultadas e a sétima não executa", async () => {
  await withOracle(async (services, post) => {
    services.model = (body) => body.tool_choice === "none"
      ? services.completion("Consultas concluídas dentro do limite.")
      : Response.json({ model: "test-model", choices: [{ message: {
        tool_calls: Array.from({ length: 7 }, (_, i) => ({ id: `call-${i}`, type: "function",
          function: { name: "metricas", arguments: "{}" } })),
      } }] });
    const res = await post({ organization_id: ORG_A, pergunta: "Compare os períodos." });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.procedencia, ["metricas", "metricas", "metricas", "metricas", "metricas", "metricas"]);
    assertEquals(body.teto_de_ferramentas_atingido, true);
    assertEquals(body.resposta, "Consultas concluídas dentro do limite.");
  });
});

Deno.test("HTTP — falha na memória não deixa pergunta parcial no histórico", async () => {
  await withOracle(async (services, post) => {
    services.failWrite = "oraculo_conversations";
    const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Continue." });
    assertEquals(res.status, 500);
    const history = await services.fetch(`http://127.0.0.1:54399/rest/v1/oraculo_turns?conversation_id=eq.${CONVERSA_A}`,
      { headers: { authorization: "Bearer test-user" } });
    assertEquals((await history.json()).map((turn: { content: string }) => turn.content), [SEGREDO]);
  });
});

Deno.test("HTTP — falha no GET dos turnos não permite resposta sem histórico", async () => {
  await withOracle(async (services, post) => {
    services.failRead = "oraculo_turns";
    services.failReadMethod = "GET";
    const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Continue." });
    assertEquals(res.status, 500);
    assertEquals(services.modelRequests.length, 0);
  });
});

Deno.test("HTTP — falha ao consultar quota não libera consumo de IA", async () => {
  await withOracle(async (services, post) => {
    services.failRead = "oraculo_turns";
    const res = await post({ organization_id: ORG_A, pergunta: "Continue." });
    assertEquals(res.status, 500);
    assertEquals(services.modelRequests.length, 0);
  });
});

Deno.test("HTTP — falha ao carregar histórico não cria conversa vazia nem consome IA", async () => {
  await withOracle(async (services, post) => {
    services.failRead = "oraculo_conversations";
    const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Continue." });
    assertEquals(res.status, 500);
    assertEquals(services.modelRequests.length, 0);
  });
});

Deno.test("HTTP — falha ao resumir permite retomar sem perder a memória anterior", async () => {
  await withOracle(async (services, post) => {
    services.tables.oraculo_conversations[0].summary = SEGREDO;
    for (let i = 0; i < 10; i++) services.tables.oraculo_turns.push({
      id: crypto.randomUUID(), conversation_id: CONVERSA_A, organization_id: ORG_A,
      user_id: services.tables.oraculo_conversations[0].user_id, role: "user",
      content: `Acompanhamento ${i}`, created_at: `2026-02-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    });
    services.model = () => Response.json({ error: "unavailable" }, { status: 503 });
    const failed = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Continue." });
    assertEquals(failed.status, 500);
    services.model = (body) => services.completion(JSON.stringify(body.messages).includes(SEGREDO) ? SEGREDO : "Não lembro.");
    const retry = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Qual era o contrato?" });
    assertEquals(retry.status, 200);
    assertEquals((await retry.json()).resposta, SEGREDO);
  });
});

Deno.test("HTTP — indisponibilidade do modelo não vira resposta vazia com sucesso", async () => {
  await withOracle(async (services, post) => {
    services.model = () => Response.json({ error: { message: "quota exhausted" } }, { status: 429 });
    const res = await post({ organization_id: ORG_A, pergunta: "Como estão as vendas?" });
    assertEquals(res.status, 500);
    assertEquals((await res.json()).resposta, undefined);
  });
});

Deno.test("HTTP — conversa longa preserva informação antiga ao reabrir", async () => {
  await withOracle(async (services, post) => {
    // Twelve real HTTP turns exceed both the context window and the store's recent-history window.
    for (let i = 0; i < 12; i++) {
      const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: `Acompanhamento ${i}` });
      assertEquals(res.status, 200);
      // Keep ordinary answers neutral; only the external summarizer carries the old fact forward.
      services.model = (body) => {
        const messages = body.messages as Array<{ role: string; content: string }>;
        const isSummary = messages[0].content.includes("Resumo de memória");
        return services.completion(isSummary && JSON.stringify(messages).includes(SEGREDO) ? SEGREDO : "Recebido.");
      };
    }
    services.model = (body) => services.completion(JSON.stringify(body.messages).includes(SEGREDO) ? SEGREDO : "Não lembro.");
    const reopened = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Qual era o contrato inicial?" });
    assertEquals(reopened.status, 200);
    assertEquals((await reopened.json()).resposta, SEGREDO);
  });
});

Deno.test("HTTP — falha ao atualizar conversa não é ocultada", async () => {
  await withOracle(async (services, post) => {
    services.failWrite = "oraculo_conversations";
    const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Continue." });
    assertEquals(res.status, 500);
  });
});

Deno.test("HTTP — falha ao gravar turno não vira resposta bem-sucedida", async () => {
  await withOracle(async (services, post) => {
    services.failWrite = "oraculo_turns";
    const res = await post({ organization_id: ORG_A, pergunta: "Como estão as vendas?" });
    assertEquals(res.status, 500);
    assertEquals((await res.json()).resposta, undefined);
  });
});

Deno.test("HTTP — ferramentas inválidas persistentes encerram o turno dentro do orçamento", async () => {
  await withOracle(async (services, post) => {
    services.model = (body) => body.tool_choice === "none" || services.modelRequests.length > 9
      ? services.completion("Não consegui concluir as consultas dentro do limite.")
      : Response.json({ model: "test-model", choices: [{ message: {
        tool_calls: [{ id: "call-1", type: "function", function: { name: "mover_card", arguments: "{}" } }],
      } }] });
    const res = await post({ organization_id: ORG_A, pergunta: "Mova todos os negócios." });
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.teto_de_ferramentas_atingido, true);
    assert(body.resposta.length > 0);
    assert(services.modelRequests.length <= 7, "Máximo de seis tentativas e uma resposta final.");
  });
});

Deno.test("HTTP — dono continua a conversa na organização correta", async () => {
  await withOracle(async (_services, post) => {
    const res = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Qual era o contrato?" });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.resposta, SEGREDO);
    assertEquals(body.conversa_id, CONVERSA_A);
  });
});

Deno.test("HTTP — vínculo revogado recusa a organização antiga e não libera histórico pela nova", async () => {
  await withOracle(async (services, post) => {
    services.tables.team_members[0].is_active = false;
    const oldOrg = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Contrato?" });
    assertEquals(oldOrg.status, 403);
    const newOrg = await post({ organization_id: ORG_B, conversa_id: CONVERSA_A, pergunta: "Contrato?" });
    assertEquals(newOrg.status, 200);
    assertNotEquals((await newOrg.json()).resposta, SEGREDO);
  });
});

Deno.test("HTTP — organização sem Oráculo contratado é recusada antes de consumir IA", async () => {
  await withOracle(async (services, post) => {
    services.features.oraculo = false;
    const res = await post({ organization_id: ORG_A, pergunta: "Como estão as vendas?" });
    assertEquals(res.status, 403);
    assertEquals((await res.json()).feature, "oraculo");
    assertEquals(services.modelRequests.length, 0);
  });
});

Deno.test("HTTP — telemetria inclui tempo de consolidação da memória", async () => {
  await withOracle(async (services, post) => {
    for (let i = 0; i < 10; i++) services.tables.oraculo_turns.push({
      id: crypto.randomUUID(), conversation_id: CONVERSA_A, organization_id: ORG_A,
      user_id: services.tables.oraculo_conversations[0].user_id, role: "user",
      content: `Acompanhamento ${i}`, created_at: `2026-02-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    });
    services.model = async (body) => {
      if (JSON.stringify(body.messages).includes("Resumo de memória")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return services.completion("Memória preservada.");
    };
    const response = await post({ organization_id: ORG_A, conversa_id: CONVERSA_A, pergunta: "Continue." });
    assertEquals(response.status, 200);
    const history = await services.fetch(`http://127.0.0.1:54399/rest/v1/oraculo_turns?conversation_id=eq.${CONVERSA_A}&role=eq.assistant`);
    const turns = await history.json();
    assert(turns[0].latency_ms >= 90, "Latência deve incluir a espera de 100 ms pelo resumo.");
  });
});
