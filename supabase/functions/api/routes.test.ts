import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { routes } from "./routes.ts";
import { matchRoute } from "../_shared/api/router.ts";
import { searchLeads } from "../_shared/api/routes/leads.ts";
import { createLead } from "../_shared/api/routes/leads-create.ts";

// ── A tabela de rotas ──────────────────────────────────────────
//
// `matchRoute` percorre a lista e devolve o PRIMEIRO casamento, sem preferir
// literal sobre parâmetro. Então `/leads/search` declarada depois de
// `/leads/{id}` fica inalcançável — o roteador casaria a de id, com `id` valendo
// "search", e a busca responderia "lead não encontrado" para sempre.
//
// É o tipo de defeito que não aparece em teste de handler: cada um passa
// sozinho, e o conjunto está quebrado. Por isso a guarda mora aqui, sobre a
// tabela real, e não sobre uma cópia inline da ordem.

Deno.test("routes — /leads/search casa a busca, não a leitura por id", () => {
  const m = matchRoute("GET", "/api/v1/leads/search", routes);
  assertEquals(m?.route.handler, searchLeads);
  assertEquals(m?.route.scope, "lead:read");
});

Deno.test("routes — /leads/{id} continua casando um id de verdade", () => {
  const m = matchRoute("GET", "/api/v1/leads/l-123", routes);
  assertEquals(m?.params.id, "l-123");
});

Deno.test("routes — POST /leads casa a criação, com escopo de escrita", () => {
  const m = matchRoute("POST", "/api/v1/leads", routes);
  assertEquals(m?.route.handler, createLead);
  assertEquals(m?.route.scope, "lead:write");
});
