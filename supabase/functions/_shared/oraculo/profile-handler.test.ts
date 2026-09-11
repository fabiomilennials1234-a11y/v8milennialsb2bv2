import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { handleProfile, type ProfileDeps } from "./profile-handler.ts";

const actor = {
  userId: "20000000-0000-4000-8000-000000000001",
  teamMemberId: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  role: "member",
  isMaster: false,
  isAdmin: false,
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/functions/v1/oraculo-profile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function deps(over: Partial<ProfileDeps> = {}): ProfileDeps {
  return {
    auth: () => Promise.resolve(actor),
    list: () => Promise.resolve([]),
    respond: () => Promise.resolve({ status: "answered" }),
    saveOwn: () => Promise.resolve({ status: "answered" }),
    adjust: () => Promise.resolve({ status: "answered" }),
    ...over,
  };
}

Deno.test("perfil HTTP — membro lista somente o próprio perfil derivado do JWT", async () => {
  let seen = "";
  const response = await handleProfile(
    request({ acao: "listar", organization_id: "vizinha" }),
    deps({
      list: (current) => {
        seen = `${current.organizationId}:${current.teamMemberId}`;
        return Promise.resolve([{ question_key: "seasonality" }]);
      },
    }),
    {},
  );

  assertEquals(response.status, 200);
  assertEquals(seen, `${actor.organizationId}:${actor.teamMemberId}`);
  assertEquals((await response.json()).perfis.length, 1);
});

Deno.test("perfil HTTP — resposta vazia é recusada antes de escrever", async () => {
  let wrote = false;
  const response = await handleProfile(
    request({
      acao: "responder",
      pergunta_id: "40000000-0000-4000-8000-000000000001",
      resposta: "   ",
    }),
    deps({
      respond: () => {
        wrote = true;
        return Promise.resolve({ status: "answered" });
      },
    }),
    {},
  );

  assertEquals(response.status, 400);
  assertEquals(wrote, false);
});

Deno.test("perfil HTTP — membro responde pergunta própria", async () => {
  let answer = "";
  const response = await handleProfile(
    request({
      acao: "responder",
      pergunta_id: "40000000-0000-4000-8000-000000000001",
      resposta: "Também fechamos duas vendas fora do CRM.",
    }),
    deps({
      respond: (_current, input) => {
        answer = input.answer;
        return Promise.resolve({ status: "answered" });
      },
    }),
    {},
  );

  assertEquals(response.status, 200);
  assertEquals(answer, "Também fechamos duas vendas fora do CRM.");
});

Deno.test("perfil HTTP — ajuste de colega exige admin", async () => {
  let wrote = false;
  const response = await handleProfile(
    request({
      acao: "ajustar",
      membro_id: "30000000-0000-4000-8000-000000000002",
      chave: "seasonality",
      resposta: "Agosto foge da curva.",
    }),
    deps({
      adjust: () => {
        wrote = true;
        return Promise.resolve({ status: "answered" });
      },
    }),
    {},
  );

  assertEquals(response.status, 403);
  assertEquals(wrote, false);
});

Deno.test("perfil HTTP — pessoa edita a própria prática depois nas configurações", async () => {
  let key = "";
  const response = await handleProfile(
    request({
      acao: "editar",
      chave: "personal_practice",
      resposta: "Faço uma ligação antes de enviar a proposta.",
    }),
    deps({
      saveOwn: (_current, input) => {
        key = input.questionKey;
        return Promise.resolve({ status: "answered" });
      },
    }),
    {},
  );

  assertEquals(response.status, 200);
  assertEquals(key, "personal_practice");
});

Deno.test("perfil HTTP — ignorar pergunta mantém entrevista opcional", async () => {
  let skipped = false;
  const response = await handleProfile(
    request({
      acao: "ignorar",
      pergunta_id: "40000000-0000-4000-8000-000000000001",
    }),
    deps({
      respond: (_current, input) => {
        skipped = input.skip;
        return Promise.resolve({ status: "skipped" });
      },
    }),
    {},
  );

  assertEquals(response.status, 200);
  assertEquals(skipped, true);
});
