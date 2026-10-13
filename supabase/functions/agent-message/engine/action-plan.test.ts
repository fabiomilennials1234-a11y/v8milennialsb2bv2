import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  applyStageHandoff,
  constrainNotifyPhones,
  foldNextState,
  parseStageHandoffPolicy,
  planTurnActions,
  stageAnchor,
  toolNameForAction,
  type ActionPlan,
  type StageHandoffPolicy,
  type TurnAction,
} from "./action-plan.ts";

const ORG = "org-1";

function call(
  action: string,
  params: Record<string, unknown> = {},
  origin: TurnAction["origin"] = "llm",
): TurnAction {
  return { action, params, tenant_id: ORG, toolName: toolNameForAction(action), origin };
}

const actions = (list: TurnAction[]) => list.map((a) => a.action);

const POLICY: StageHandoffPolicy = {
  version: 1,
  stages: [{ stage_key: "pronto_para_comprar", pipe: "vendas" }],
};

const CTX = {
  organizationId: ORG,
  userMessage: "Quero fechar\n agora mesmo",
  notifyPhones: ["+55 11 99999-0001", "5511999990002"],
};

// ─── toolNameForAction ──────────────────────────────────────────────────────

Deno.test("toolNameForAction — inverso do dispatcher, inclusive TRANSFER_HUMAN", () => {
  assertEquals(toolNameForAction("TRANSFER_HUMAN"), "transfer_to_human");
  assertEquals(toolNameForAction("UPDATE_LEAD"), "update_lead");
  assertEquals(toolNameForAction("QUALIFY_LEAD"), "qualify_lead");
  assertEquals(toolNameForAction("WHATEVER"), "whatever");
});

// ─── planTurnActions ────────────────────────────────────────────────────────

Deno.test("plan (aceite 1) — update+advance+transfer executam os 3, transfer por último", () => {
  const plan = planTurnActions([
    call("UPDATE_LEAD"),
    call("ADVANCE_STAGE", { target_stage: "x", target_pipe: "vendas" }),
    call("TRANSFER_HUMAN"),
  ]);
  assertEquals(actions(plan.sequential), ["UPDATE_LEAD", "ADVANCE_STAGE", "TRANSFER_HUMAN"]);
  assertEquals(plan.media, []);
  assertEquals(plan.dropped, []);
});

Deno.test("plan (aceite 1) — entrada embaralhada produz a mesma ordem", () => {
  const plan = planTurnActions([
    call("TRANSFER_HUMAN"),
    call("ADVANCE_STAGE", { target_stage: "x", target_pipe: "vendas" }),
    call("UPDATE_LEAD"),
  ]);
  assertEquals(actions(plan.sequential), ["UPDATE_LEAD", "ADVANCE_STAGE", "TRANSFER_HUMAN"]);
});

Deno.test("plan — tabela de rank completa, desconhecidos antes da transferência", () => {
  const plan = planTurnActions([
    call("TRANSFER_SZ_CHAT"),
    call("UNKNOWN"),
    call("CREATE_LEAD"),
    call("CONFIRM_MEETING"),
    call("SCHEDULE_MEETING"),
    call("ADVANCE_CONFIRMATION_STAGE"),
    call("ADVANCE_STAGE"),
    call("QUALIFY_LEAD"),
    call("UPDATE_QUALIFICATION_SCORE"),
    call("UPDATE_LEAD"),
    call("CREATE_CUSTOM_FIELD"),
  ]);
  assertEquals(actions(plan.sequential), [
    "CREATE_CUSTOM_FIELD",
    "UPDATE_LEAD",
    "UPDATE_QUALIFICATION_SCORE",
    "QUALIFY_LEAD",
    "ADVANCE_STAGE",
    "ADVANCE_CONFIRMATION_STAGE",
    "SCHEDULE_MEETING",
    "CONFIRM_MEETING",
    "CREATE_LEAD",
    "UNKNOWN",
    "TRANSFER_SZ_CHAT",
  ]);
});

Deno.test("plan — CREATE_LEAD e UPDATE_CRM compartilham rank e mantêm a ordem do LLM", () => {
  const plan = planTurnActions([call("UPDATE_CRM"), call("CREATE_LEAD")]);
  assertEquals(actions(plan.sequential), ["UPDATE_CRM", "CREATE_LEAD"]);
});

Deno.test("plan (aceite 4) — duas TRANSFER_HUMAN viram uma", () => {
  const plan = planTurnActions([
    call("TRANSFER_HUMAN", { reason: "a" }),
    call("TRANSFER_HUMAN", { reason: "b" }),
  ]);
  assertEquals(plan.sequential.length, 1);
  assertEquals(plan.sequential[0].params.reason, "a");
  assertEquals(plan.dropped, [{ action: "TRANSFER_HUMAN", reason: "duplicate" }]);
});

Deno.test("plan (aceite 4) — TRANSFER_HUMAN + TRANSFER_SZ_CHAT: só a primeira sobrevive", () => {
  const a = planTurnActions([call("TRANSFER_SZ_CHAT"), call("TRANSFER_HUMAN")]);
  assertEquals(actions(a.sequential), ["TRANSFER_SZ_CHAT"]);
  assertEquals(a.dropped, [{ action: "TRANSFER_HUMAN", reason: "transfer_family_duplicate" }]);

  const b = planTurnActions([call("TRANSFER_HUMAN"), call("UPDATE_LEAD"), call("TRANSFER_SZ_CHAT")]);
  assertEquals(actions(b.sequential), ["UPDATE_LEAD", "TRANSFER_HUMAN"]);
  assertEquals(b.dropped, [{ action: "TRANSFER_SZ_CHAT", reason: "transfer_family_duplicate" }]);
});

Deno.test("plan — dedupe por tipo, 1ª ocorrência vence", () => {
  const plan = planTurnActions([
    call("UPDATE_LEAD", { updates: { a: "1" } }),
    call("UPDATE_LEAD", { updates: { a: "2" } }),
  ]);
  assertEquals(plan.sequential.length, 1);
  assertEquals(plan.sequential[0].params, { updates: { a: "1" } });
  assertEquals(plan.dropped, [{ action: "UPDATE_LEAD", reason: "duplicate" }]);
});

Deno.test("plan — desconhecidos de tools diferentes não colapsam entre si", () => {
  const plan = planTurnActions([
    { action: "UNKNOWN", params: {}, tenant_id: ORG, toolName: "foo", origin: "llm" },
    { action: "UNKNOWN", params: {}, tenant_id: ORG, toolName: "bar", origin: "llm" },
  ]);
  assertEquals(plan.sequential.map((a) => a.toolName), ["foo", "bar"]);
});

Deno.test("plan (aceite 5) — QUALIFY + DISQUALIFY descarta ambas", () => {
  const plan = planTurnActions([call("QUALIFY_LEAD"), call("UPDATE_LEAD"), call("DISQUALIFY_LEAD")]);
  assertEquals(actions(plan.sequential), ["UPDATE_LEAD"]);
  assertEquals(plan.dropped, [
    { action: "QUALIFY_LEAD", reason: "conflict_qualify_disqualify" },
    { action: "DISQUALIFY_LEAD", reason: "conflict_qualify_disqualify" },
  ]);
  assertEquals(foldNextState("QUALIFYING", plan).nextState, "QUALIFYING");
});

Deno.test("plan — inline remanescente (search_knowledge/orçamento) fica fora", () => {
  const plan = planTurnActions([call("SEARCH_KNOWLEDGE"), call("GENERATE_ORDER_REQUEST"), call("UPDATE_LEAD")]);
  assertEquals(actions(plan.sequential), ["UPDATE_LEAD"]);
  assertEquals(plan.dropped, [
    { action: "SEARCH_KNOWLEDGE", reason: "inline_only" },
    { action: "GENERATE_ORDER_REQUEST", reason: "inline_only" },
  ]);
});

Deno.test("plan (aceite 7) — mídia vai para media, sem dedupe, na ordem do LLM", () => {
  const plan = planTurnActions([
    call("SEND_DOCUMENT", { document_id: "d1" }),
    call("UPDATE_LEAD"),
    call("SEND_DOCUMENT", { document_id: "d2" }),
    call("SEND_PRODUCT_MATERIAL", { material_id: "m1" }),
  ]);
  assertEquals(plan.media.map((m) => m.params.document_id ?? m.params.material_id), ["d1", "d2", "m1"]);
  assertEquals(actions(plan.sequential), ["UPDATE_LEAD"]);
});

Deno.test("plan — entrada vazia → plano vazio", () => {
  assertEquals(planTurnActions([]), { sequential: [], media: [], dropped: [] });
});

Deno.test("plan — não muta a entrada", () => {
  const input = [call("TRANSFER_HUMAN"), call("UPDATE_LEAD")];
  planTurnActions(input);
  assertEquals(actions(input), ["TRANSFER_HUMAN", "UPDATE_LEAD"]);
});

// ─── foldNextState ──────────────────────────────────────────────────────────

Deno.test("fold (aceite 9) — [qualify, transfer] → WAITING_HUMAN, visited contém QUALIFIED", () => {
  const plan = planTurnActions([call("TRANSFER_HUMAN"), call("QUALIFY_LEAD")]);
  const out = foldNextState("QUALIFYING", plan);
  assertEquals(out.nextState, "WAITING_HUMAN");
  assertEquals(out.visitedStates, ["QUALIFIED", "WAITING_HUMAN"]);
});

Deno.test("fold — plano vazio mantém o estado e visita só ele (comportamento anterior)", () => {
  const out = foldNextState("NEW_LEAD", planTurnActions([]));
  assertEquals(out, { nextState: "NEW_LEAD", visitedStates: ["NEW_LEAD"] });
});

Deno.test("fold — update_lead de NEW_LEAD → QUALIFYING (default da state machine)", () => {
  const out = foldNextState("NEW_LEAD", planTurnActions([call("UPDATE_LEAD"), call("ADVANCE_STAGE")]));
  assertEquals(out, { nextState: "QUALIFYING", visitedStates: ["QUALIFYING"] });
});

Deno.test("fold — inclui a transferência sintetizada", () => {
  const { plan } = applyStageHandoff(
    planTurnActions([call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" })]),
    POLICY,
    CTX,
  );
  assertEquals(foldNextState("QUALIFIED", plan).nextState, "WAITING_HUMAN");
});

// ─── parseStageHandoffPolicy ────────────────────────────────────────────────

Deno.test("policy — válida passa normalizada", () => {
  assertEquals(
    parseStageHandoffPolicy({
      version: 1,
      stages: [{ stage_key: "pronto_para_comprar", pipe: "vendas" }, { stage_key: "fechamento" }],
    }),
    { version: 1, stages: [{ stage_key: "pronto_para_comprar", pipe: "vendas" }, { stage_key: "fechamento" }] },
  );
});

Deno.test("policy (aceite 3) — null, {}, inválidas → null", () => {
  const invalid: unknown[] = [
    null,
    undefined,
    {},
    [],
    "x",
    42,
    { version: 2, stages: [{ stage_key: "a" }] },
    { version: "1", stages: [{ stage_key: "a" }] },
    { version: 1 },
    { version: 1, stages: [] },
    { version: 1, stages: "a" },
    { version: 1, stages: [{ stage_key: "Com Espaço" }] },
    { version: 1, stages: [{ stage_key: "" }] },
    { version: 1, stages: [{ stage_key: "a".repeat(65) }] },
    { version: 1, stages: [{ stage_key: "a", pipe: "drop;table" }] },
    { version: 1, stages: [{ stage_key: "a", pipe: 7 }] },
    { version: 1, stages: [null] },
    { version: 1, stages: Array.from({ length: 21 }, (_, i) => ({ stage_key: `s${i}` })) },
  ];
  for (const raw of invalid) assertEquals(parseStageHandoffPolicy(raw), null, JSON.stringify(raw));
});

Deno.test("policy — pipe uuid é aceito; 20 entradas é o teto", () => {
  const uuid = "8f0f6f9e-1c2d-4e5f-9a8b-7c6d5e4f3a2b";
  assertEquals(parseStageHandoffPolicy({ version: 1, stages: [{ stage_key: "a", pipe: uuid }] })?.stages, [
    { stage_key: "a", pipe: uuid },
  ]);
  const twenty = Array.from({ length: 20 }, (_, i) => ({ stage_key: `s${i}` }));
  assertEquals(parseStageHandoffPolicy({ version: 1, stages: twenty })?.stages.length, 20);
});

// ─── applyStageHandoff ──────────────────────────────────────────────────────

Deno.test("handoff (aceite 2) — advance para etapa da policy sintetiza TRANSFER no fim", () => {
  const base = planTurnActions([
    call("UPDATE_LEAD", { updates: { company: "Acme", cidade: "Recife" } }),
    call("ADVANCE_STAGE", { target_stage: " Pronto_Para_Comprar ", target_pipe: "VENDAS" }),
  ]);
  const { plan, synthesized } = applyStageHandoff(base, POLICY, CTX);
  assert(synthesized);
  assertEquals(actions(plan.sequential), ["UPDATE_LEAD", "ADVANCE_STAGE", "TRANSFER_HUMAN"]);
  assertEquals(plan.sequential[2], synthesized);
  assertEquals(synthesized.origin, "synthesized");
  assertEquals(synthesized.toolName, "transfer_to_human");
  assertEquals(synthesized.tenant_id, ORG);
  assertEquals(synthesized.params.reason, "Etapa de handoff atingida: pronto_para_comprar (funil vendas)");
  assertEquals(synthesized.params.priority, "ALTA");
  assertEquals(synthesized.params.priority_reason, "stage_handoff");
  assertEquals(synthesized.params.notify_phones, ["+55 11 99999-0001", "5511999990002"]);
  assertEquals(
    synthesized.params.summary,
    'Lead avançou para pronto_para_comprar (funil vendas). Última mensagem do lead: "Quero fechar agora mesmo". Dados atualizados no turno: company=Acme; cidade=Recife',
  );
  // entrada intacta
  assertEquals(actions(base.sequential), ["UPDATE_LEAD", "ADVANCE_STAGE"]);
});

Deno.test("handoff — summary limita mensagem (280) e dados (300), nunca usa texto do assistente", () => {
  const long = "a".repeat(500);
  const { synthesized } = applyStageHandoff(
    planTurnActions([
      call("UPDATE_LEAD", { updates: { obs: "b".repeat(500) } }),
      call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" }),
    ]),
    POLICY,
    { ...CTX, userMessage: long },
  );
  const summary = String(synthesized?.params.summary);
  const msg = summary.match(/Última mensagem do lead: "([^"]*)"/)?.[1] ?? "";
  assert(msg.length <= 280, `msg ${msg.length}`);
  const data = summary.split("Dados atualizados no turno: ")[1] ?? "";
  assert(data.length <= 300, `data ${data.length}`);
});

Deno.test("handoff — sem UPDATE_LEAD omite a seção de dados; sem phones omite notify_phones", () => {
  const { synthesized } = applyStageHandoff(
    planTurnActions([call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" })]),
    POLICY,
    { ...CTX, notifyPhones: null },
  );
  assert(synthesized);
  assert(!String(synthesized.params.summary).includes("Dados atualizados"));
  assertEquals("notify_phones" in synthesized.params, false);
});

Deno.test("handoff — summary não carrega lead_id nem objetos crus", () => {
  const { synthesized } = applyStageHandoff(
    planTurnActions([
      call("UPDATE_LEAD", { lead_id: "L1", updates: { tags: ["a", "b"], n: 3 } }),
      call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" }),
    ]),
    POLICY,
    CTX,
  );
  const s = String(synthesized?.params.summary);
  assert(!s.includes("L1"));
  assertStringIncludes(s, 'tags=["a","b"]; n=3');
});

Deno.test("handoff (aceite 3) — sem policy nada muda", () => {
  const base = planTurnActions([call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" })]);
  for (const raw of [null, {}, { version: 2 }]) {
    const out = applyStageHandoff(base, parseStageHandoffPolicy(raw), CTX);
    assertEquals(out.synthesized, null);
    assertEquals(out.plan, base);
  }
});

Deno.test("handoff (aceite 6) — transfer do LLM presente → sem síntese", () => {
  for (const t of ["TRANSFER_HUMAN", "TRANSFER_SZ_CHAT"]) {
    const base = planTurnActions([
      call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" }),
      call(t),
    ]);
    const out = applyStageHandoff(base, POLICY, CTX);
    assertEquals(out.synthesized, null);
    assertEquals(out.plan, base);
  }
});

Deno.test("handoff (aceite 6) — etapa fora da policy / sem advance → sem síntese", () => {
  assertEquals(
    applyStageHandoff(
      planTurnActions([call("ADVANCE_STAGE", { target_stage: "qualificado", target_pipe: "vendas" })]),
      POLICY,
      CTX,
    ).synthesized,
    null,
  );
  assertEquals(applyStageHandoff(planTurnActions([call("UPDATE_LEAD")]), POLICY, CTX).synthesized, null);
});

Deno.test("handoff (aceite 6) — pipe diferente → sem síntese; pipe ausente na policy casa qualquer funil", () => {
  const advPos = planTurnActions([
    call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "pos_venda" }),
  ]);
  assertEquals(applyStageHandoff(advPos, POLICY, CTX).synthesized, null);
  const anyPipe: StageHandoffPolicy = { version: 1, stages: [{ stage_key: "pronto_para_comprar" }] };
  const out = applyStageHandoff(advPos, anyPipe, CTX);
  assert(out.synthesized);
  assertEquals(out.synthesized.params.reason, "Etapa de handoff atingida: pronto_para_comprar (funil pos_venda)");
});

Deno.test("handoff (aceite 6) — anti-loop: lead já na etapa-alvo daquele funil → sem síntese", () => {
  const base = planTurnActions([
    call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" }),
  ]);
  const bySlug = applyStageHandoff(base, POLICY, {
    ...CTX,
    currentStageKeys: [{ pipeline_slug: "vendas", pipeline_id: "p-uuid", stage_key: "pronto_para_comprar" }],
  });
  assertEquals(bySlug.synthesized, null);

  const byId = applyStageHandoff(
    planTurnActions([call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "p-uuid" })]),
    { version: 1, stages: [{ stage_key: "pronto_para_comprar" }] },
    { ...CTX, currentStageKeys: [{ pipeline_slug: "vendas", pipeline_id: "p-uuid", stage_key: "pronto_para_comprar" }] },
  );
  assertEquals(byId.synthesized, null);
});

Deno.test("handoff — anti-loop não bloqueia quando a etapa atual é outra ou é de outro funil", () => {
  const base = planTurnActions([
    call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar", target_pipe: "vendas" }),
  ]);
  const otherStage = applyStageHandoff(base, POLICY, {
    ...CTX,
    currentStageKeys: [{ pipeline_slug: "vendas", stage_key: "qualificado" }],
  });
  assert(otherStage.synthesized);
  const otherPipe = applyStageHandoff(base, POLICY, {
    ...CTX,
    currentStageKeys: [{ pipeline_slug: "pos_venda", stage_key: "pronto_para_comprar" }],
  });
  assert(otherPipe.synthesized);
});

Deno.test("handoff — target_pipe ausente = 'whatsapp' (mesmo default de move-card/dispatcher)", () => {
  const noPipe = planTurnActions([call("ADVANCE_STAGE", { target_stage: "pronto_para_comprar" })]);
  const waPolicy: StageHandoffPolicy = { version: 1, stages: [{ stage_key: "pronto_para_comprar", pipe: "whatsapp" }] };

  // Policy com pipe "whatsapp" casa o advance sem target_pipe (o worker move no whatsapp).
  const out = applyStageHandoff(noPipe, waPolicy, CTX);
  assert(out.synthesized);
  assertEquals(out.synthesized.params.reason, "Etapa de handoff atingida: pronto_para_comprar (funil whatsapp)");

  // Anti-loop: lead já em whatsapp/pronto_para_comprar → sem síntese (antes: re-disparava todo turno).
  const anyPipe: StageHandoffPolicy = { version: 1, stages: [{ stage_key: "pronto_para_comprar" }] };
  const loop = applyStageHandoff(noPipe, anyPipe, {
    ...CTX,
    currentStageKeys: [{ pipeline_slug: "whatsapp", stage_key: "pronto_para_comprar" }],
  });
  assertEquals(loop.synthesized, null);
});

// ─── constrainNotifyPhones ──────────────────────────────────────────────────

Deno.test("constrainNotifyPhones (aceite 8) — número fora da allowlist é removido", () => {
  assertEquals(
    constrainNotifyPhones(["5511999990001", "5599000000000"], ["+55 11 99999-0001", "5511999990002"]),
    ["+55 11 99999-0001"],
  );
});

Deno.test("constrainNotifyPhones (aceite 8) — interseção vazia → allowlist inteira", () => {
  const allow = ["5511999990001", "5511999990002"];
  assertEquals(constrainNotifyPhones(["5599000000000"], allow), allow);
  assertEquals(constrainNotifyPhones(undefined, allow), allow);
  assertEquals(constrainNotifyPhones("5511999990001", allow), allow);
  assertEquals(constrainNotifyPhones([], allow), allow);
});

Deno.test("constrainNotifyPhones (aceite 8) — allowlist null/vazia → undefined", () => {
  assertEquals(constrainNotifyPhones(["5511999990001"], null), undefined);
  assertEquals(constrainNotifyPhones(["5511999990001"], []), undefined);
});

Deno.test("constrainNotifyPhones — dedupe e ignora entradas não-string", () => {
  assertEquals(
    constrainNotifyPhones(["5511999990001", "55 11 99999 0001", 5511999990001, null], ["5511999990001"]),
    ["5511999990001"],
  );
});

// ─── stageAnchor ────────────────────────────────────────────────────────────

Deno.test("stageAnchor — ADVANCE_STAGE > SCHEDULE_MEETING > principal", () => {
  const p1 = planTurnActions([call("SCHEDULE_MEETING"), call("ADVANCE_STAGE"), call("UPDATE_LEAD")]);
  assertEquals(stageAnchor(p1)?.action, "ADVANCE_STAGE");
  const p2 = planTurnActions([call("UPDATE_LEAD"), call("SCHEDULE_MEETING")]);
  assertEquals(stageAnchor(p2)?.action, "SCHEDULE_MEETING");
  const p3 = planTurnActions([call("TRANSFER_HUMAN"), call("UPDATE_LEAD")]);
  assertEquals(stageAnchor(p3)?.action, "UPDATE_LEAD");
  const p4 = planTurnActions([call("SEND_DOCUMENT")]);
  assertEquals(stageAnchor(p4)?.action, "SEND_DOCUMENT");
  const empty: ActionPlan = { sequential: [], media: [], dropped: [] };
  assertEquals(stageAnchor(empty), null);
});
