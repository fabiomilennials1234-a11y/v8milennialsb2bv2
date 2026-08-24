import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { routes } from "./routes.ts";
import { matchRoute } from "../_shared/api/router.ts";
import { searchLeads } from "../_shared/api/routes/leads.ts";
import { createLead } from "../_shared/api/routes/leads-create.ts";
import { createDeal } from "../_shared/api/routes/deals-create.ts";
import { API_SCOPES, hasScope } from "../_shared/api/scopes.ts";

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

// ── Negócio ────────────────────────────────────────────────────────────────

Deno.test("routes — POST /deals casa a abertura de Negócio, com escopo próprio", () => {
  const m = matchRoute("POST", "/api/v1/deals", routes);
  assertEquals(m?.route.handler, createDeal);
  assertEquals(m?.route.scope, "deal:write");
});

// `deal:write` NÃO pode ser satisfeito por `lead:write`: são recursos distintos,
// e uma chave de parceiro com permissão de editar pessoa não deve poder abrir
// venda no funil.
Deno.test("scopes — deal:write não é concedido por lead:write", () => {
  assertEquals(hasScope(["lead:write"], "deal:write"), false);
  assertEquals(hasScope(["deal:write"], "deal:write"), true);
  assertEquals(API_SCOPES.includes("deal:read" as never), true);
  assertEquals(API_SCOPES.includes("deal:write" as never), true);
});
