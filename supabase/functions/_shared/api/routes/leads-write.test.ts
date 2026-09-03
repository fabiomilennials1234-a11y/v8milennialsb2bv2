import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  addLeadTags,
  moveLeadStage,
  patchLead,
  putCustomFields,
  removeLeadTag,
} from "./leads-write.ts";
import type { ApiRouteContext } from "../router.ts";
import type { ActionInput } from "../../action-handlers/types.ts";

const cors = { "access-control-allow-origin": "*" };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function ctx(
  method: string,
  url: string,
  body: unknown,
  rpcResult: { data?: unknown; error?: unknown },
  calls: RpcCall[] = [],
  params: Record<string, string> = { id: "l-1" },
): ApiRouteContext {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return {
    req: new Request(url, init),
    params,
    organizationId: "org-1",
    scopes: ["lead:write"],
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    cors,
  };
}

// ── PATCH /leads/{id} ──────────────────────────────────────────

Deno.test("patchLead — allowlists fields and calls api_update_lead with org+lead+patch", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1",
    { name: "New", company: "Co", evil: "x", tier: "ouro" },
    { data: { ok: true, lead: { id: "l-1" } } }, calls);
  await patchLead(c);
  assertEquals(calls[0].name, "api_update_lead");
  assertEquals(calls[0].args.p_org, "org-1");
  assertEquals(calls[0].args.p_lead_id, "l-1");
  assertEquals(calls[0].args.p_patch, { name: "New", company: "Co", qualification_tier: "ouro" });
});

Deno.test("patchLead — 422 when no valid fields", async () => {
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", { evil: "x" }, { data: { ok: true } });
  const res = await patchLead(c);
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "no_valid_fields");
});

Deno.test("patchLead — 422 on invalid tier enum", async () => {
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", { tier: "platinum" }, { data: { ok: true } });
  const res = await patchLead(c);
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "invalid_tier");
});

Deno.test("patchLead — 400 on invalid JSON body", async () => {
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", "{not json", { data: {} });
  const res = await patchLead(c);
  assertEquals(res.status, 400);
});

Deno.test("patchLead — 404 when rpc reports not_found", async () => {
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", { name: "x" }, { data: { ok: false, code: "not_found" } });
  const res = await patchLead(c);
  assertEquals(res.status, 404);
});

Deno.test("patchLead — 200 returns updated lead on ok", async () => {
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", { name: "x" }, { data: { ok: true, lead: { id: "l-1", name: "x" } } });
  const res = await patchLead(c);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { id: "l-1", name: "x" });
});

// ── POST /leads/{id}/stage ─────────────────────────────────────

Deno.test("moveLeadStage — 400 when stage missing", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/stage", { pipe: "whatsapp" }, { data: true });
  const res = await moveLeadStage(c);
  assertEquals(res.status, 400);
});

Deno.test("moveLeadStage — 404 when lead not in org", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/stage", { pipe: "whatsapp", stage: "novo" }, { data: false });
  const res = await moveLeadStage(c, () => Promise.resolve({ success: true }));
  assertEquals(res.status, 404);
});

Deno.test("moveLeadStage — calls injected mover with mapped params, 200 on success", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("POST", "https://x/api/v1/leads/l-1/stage",
    { pipe: "confirmacao", stage: "compareceu" }, { data: true }, calls);
  // `ActionInput` e não `Record<string, unknown>`: é o que o mover recebe de
  // fato. `interface` não ganha assinatura de índice implícita, então a captura
  // num `Record` era erro de tipo — e guardar o argumento com o tipo real ainda
  // dispensa os casts nas asserções abaixo.
  let moverArg: ActionInput | null = null;
  const res = await moveLeadStage(c, (input) => {
    moverArg = input;
    return Promise.resolve({ success: true, data: { target_stage: "compareceu" } });
  });
  assertEquals(calls[0].name, "api_lead_exists");
  assertEquals(res.status, 200);
  assertEquals(moverArg!.organizationId, "org-1");
  assertEquals(moverArg!.leadId, "l-1");
  assertEquals(moverArg!.params.target_pipe, "confirmacao");
  assertEquals(moverArg!.params.target_stage, "compareceu");
});

Deno.test("SCRUM-641: moveLeadStage sem `pipe` cai no funil PADRÃO da org, não mais no literal whatsapp", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/stage", { stage: "novo" }, { data: true });
  // O default lê organizations.default_pipeline_id — dá um .from ao fake.
  (c.supabase as Record<string, unknown>).from = (_t: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = () => Promise.resolve({ data: { default_pipeline_id: "11111111-1111-4111-8111-111111111111" }, error: null });
    return b;
  };
  let moverArg: ActionInput | null = null;
  const res = await moveLeadStage(c, (input) => {
    moverArg = input;
    return Promise.resolve({ success: true });
  });
  assertEquals(res.status, 200);
  assertEquals(moverArg!.params.target_pipe, "11111111-1111-4111-8111-111111111111");
});

Deno.test("SCRUM-641: moveLeadStage sem `pipe` e org SEM funil padrão preserva o literal legado (erra tipado adiante)", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/stage", { stage: "novo" }, { data: true });
  (c.supabase as Record<string, unknown>).from = (_t: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = () => Promise.resolve({ data: { default_pipeline_id: null }, error: null });
    return b;
  };
  let moverArg: ActionInput | null = null;
  const res = await moveLeadStage(c, (input) => {
    moverArg = input;
    return Promise.resolve({ success: true });
  });
  assertEquals(res.status, 200);
  assertEquals(moverArg!.params.target_pipe, "whatsapp");
});

Deno.test("moveLeadStage — 422 when mover fails (invalid stage)", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/stage", { pipe: "whatsapp", stage: "bogus" }, { data: true });
  const res = await moveLeadStage(c, () => Promise.resolve({ success: false, error: "Etapa inválida" }));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "stage_move_failed");
});

// ── tags ───────────────────────────────────────────────────────

Deno.test("addLeadTags — 400 when tags not an array", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/tags", { tags: "vip" }, { data: { ok: true } });
  assertEquals((await addLeadTags(c)).status, 400);
});

Deno.test("addLeadTags — calls api_add_lead_tags, 200 with tags", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("POST", "https://x/api/v1/leads/l-1/tags", { tags: ["vip", "novo"] },
    { data: { ok: true, tags: [{ id: "t1", name: "vip" }] } }, calls);
  const res = await addLeadTags(c);
  assertEquals(calls[0].name, "api_add_lead_tags");
  assertEquals(calls[0].args, { p_org: "org-1", p_lead_id: "l-1", p_tags: ["vip", "novo"] });
  assertEquals(res.status, 200);
});

Deno.test("addLeadTags — 404 when lead not found", async () => {
  const c = ctx("POST", "https://x/api/v1/leads/l-1/tags", { tags: ["v"] }, { data: { ok: false, code: "not_found" } });
  assertEquals((await addLeadTags(c)).status, 404);
});

Deno.test("removeLeadTag — calls api_remove_lead_tag with tag from params, 200", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("DELETE", "https://x/api/v1/leads/l-1/tags/vip", undefined,
    { data: { ok: true } }, calls, { id: "l-1", tag: "vip" });
  const res = await removeLeadTag(c);
  assertEquals(calls[0].name, "api_remove_lead_tag");
  assertEquals(calls[0].args, { p_org: "org-1", p_lead_id: "l-1", p_tag: "vip" });
  assertEquals(res.status, 200);
});

// ── PUT custom-fields ──────────────────────────────────────────

Deno.test("putCustomFields — calls api_set_custom_fields with values object", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("PUT", "https://x/api/v1/leads/l-1/custom-fields",
    { faturamento: "1M", segmento: "varejo" }, { data: { ok: true } }, calls);
  const res = await putCustomFields(c);
  assertEquals(calls[0].name, "api_set_custom_fields");
  assertEquals(calls[0].args, { p_org: "org-1", p_lead_id: "l-1", p_values: { faturamento: "1M", segmento: "varejo" } });
  assertEquals(res.status, 200);
});

Deno.test("putCustomFields — 422 when rpc reports unknown_field", async () => {
  const c = ctx("PUT", "https://x/api/v1/leads/l-1/custom-fields", { ghost: "x" },
    { data: { ok: false, code: "unknown_field", unknown_fields: ["ghost"] } });
  const res = await putCustomFields(c);
  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "unknown_field");
  assertEquals(body.error.details, { unknown_fields: ["ghost"] });
});

Deno.test("putCustomFields — 400 when body is not an object", async () => {
  const c = ctx("PUT", "https://x/api/v1/leads/l-1/custom-fields", [1, 2], { data: { ok: true } });
  assertEquals((await putCustomFields(c)).status, 400);
});

// ── create_missing ──────────────────────────────────────────────────────────
//
// O caminho do integrador é o inverso do nosso: ele tem o valor na mão e
// descobre no envio que o campo não estava cadastrado. Com `create_missing=true`
// o campo nasce como `text` em vez de 422 — mas continua opt-in, para que
// estrutura não apareça por integração em quem não pediu.

Deno.test("putCustomFields — create_missing=true usa a RPC que cria o campo ausente", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("PUT", "https://x/api/v1/leads/l-1/custom-fields?create_missing=true",
    { novo_campo: "x" }, { data: { ok: true, created_fields: ["novo_campo"] } }, calls);
  const res = await putCustomFields(c);
  assertEquals(calls[0].name, "api_set_custom_fields_creating");
  assertEquals(res.status, 200);
});

Deno.test("putCustomFields — sem o parâmetro, campo desconhecido continua sendo 422", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("PUT", "https://x/api/v1/leads/l-1/custom-fields", { ghost: "x" },
    { data: { ok: false, code: "unknown_field", unknown_fields: ["ghost"] } }, calls);
  const res = await putCustomFields(c);
  assertEquals(calls[0].name, "api_set_custom_fields");
  assertEquals(res.status, 422);
});

Deno.test("putCustomFields — só o literal 'true' liga a criação", async () => {
  for (const v of ["1", "yes", "false"]) {
    const calls: RpcCall[] = [];
    const c = ctx("PUT", `https://x/api/v1/leads/l-1/custom-fields?create_missing=${v}`,
      { x: "1" }, { data: { ok: true } }, calls);
    await putCustomFields(c);
    assertEquals(calls[0].name, "api_set_custom_fields", `valor ${v} não deveria criar`);
  }
});

// ── colunas que o lead-webhook já gravava ───────────────────────────────────
//
// A migração dos cenários do Make depende disto: UTM, segmento e faturamento são
// COLUNAS de `leads`, lidas pelas telas e por funções de métrica. Mandá-los como
// campo personalizado gravaria noutro lugar e deixaria a tela vazia para lead
// novo — regressão silenciosa, que é a pior.

Deno.test("patchLead — grava utm_*, segment e faturamento nas colunas", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", {
    utm_source: "facebook", utm_medium: "cpc", utm_campaign: "b2b-agosto",
    utm_content: "criativo-3", utm_term: "distribuidora",
    segment: "alimentos", faturamento: "R$100 mil a R$150 mil",
  }, { data: { ok: true } }, calls);
  const res = await patchLead(c);
  assertEquals(res.status, 200);
  const patch = calls[0].args.p_patch as Record<string, unknown>;
  assertEquals(patch.utm_source, "facebook");
  assertEquals(patch.utm_campaign, "b2b-agosto");
  assertEquals(patch.utm_term, "distribuidora");
  assertEquals(patch.segment, "alimentos");
  assertEquals(patch.faturamento, "R$100 mil a R$150 mil");
});

Deno.test("patchLead — campo não enviado continua fora do patch", async () => {
  const calls: RpcCall[] = [];
  const c = ctx("PATCH", "https://x/api/v1/leads/l-1", { utm_source: "google" },
    { data: { ok: true } }, calls);
  await patchLead(c);
  const patch = calls[0].args.p_patch as Record<string, unknown>;
  assertEquals("utm_campaign" in patch, false);
  assertEquals("segment" in patch, false);
});
