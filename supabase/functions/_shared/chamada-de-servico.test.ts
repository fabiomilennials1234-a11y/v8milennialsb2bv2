import { assertEquals } from "@std/assert";
import { lerChamadaDeServico } from "./chamada-de-servico.ts";

const CHAVE = "service-role-key-de-teste";
const ORG = "5595bbe2-6bd0-4647-9c22-dc86346aab36";
const AUTOR = "fc7f90b8-884d-444a-a03e-3898a01ad0a1";

Deno.test("bearer da service role com org e autor válidos é chamada de serviço", () => {
  assertEquals(lerChamadaDeServico(CHAVE, CHAVE, { organization_id: ORG, acting_user_id: AUTOR }), {
    servico: true,
    ok: true,
    orgId: ORG,
    actorUserId: AUTOR,
  });
});

Deno.test("JWT de usuário NÃO é chamada de serviço, e org/autor do corpo são ignorados", () => {
  // Um usuário comum mandando organization_id de outra org no corpo não vira serviço.
  assertEquals(lerChamadaDeServico("jwt.de.usuario", CHAVE, { organization_id: ORG, acting_user_id: AUTOR }), {
    servico: false,
  });
});

Deno.test("chave quase igual (mesmo tamanho, 1 caractere diferente) não casa", () => {
  const quase = CHAVE.slice(0, -1) + "X";
  assertEquals(lerChamadaDeServico(quase, CHAVE, { organization_id: ORG, acting_user_id: AUTOR }), { servico: false });
});

Deno.test("sem service role configurada, bearer vazio não vira serviço", () => {
  assertEquals(lerChamadaDeServico("", "", { organization_id: ORG, acting_user_id: AUTOR }), { servico: false });
  assertEquals(lerChamadaDeServico("qualquer", "", { organization_id: ORG, acting_user_id: AUTOR }), { servico: false });
});

Deno.test("serviço sem org é recusado, não cai em team_members", () => {
  assertEquals(lerChamadaDeServico(CHAVE, CHAVE, { acting_user_id: AUTOR }), {
    servico: true,
    ok: false,
    erro: "Chamada de serviço exige organization_id e acting_user_id",
  });
});

Deno.test("serviço sem autor é recusado", () => {
  assertEquals(lerChamadaDeServico(CHAVE, CHAVE, { organization_id: ORG }).servico, true);
  assertEquals((lerChamadaDeServico(CHAVE, CHAVE, { organization_id: ORG }) as { ok: boolean }).ok, false);
});

Deno.test("serviço com ids que não são uuid é recusado", () => {
  const r = lerChamadaDeServico(CHAVE, CHAVE, { organization_id: "x'; drop table--", acting_user_id: AUTOR });
  assertEquals((r as { ok: boolean }).ok, false);
});

Deno.test("serviço com corpo nulo é recusado, não estoura", () => {
  assertEquals((lerChamadaDeServico(CHAVE, CHAVE, null) as { ok: boolean }).ok, false);
});
