import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { routes } from "./routes.ts";
import { matchRoute } from "../_shared/api/router.ts";
import { searchLeads } from "../_shared/api/routes/leads.ts";
import { createLead } from "../_shared/api/routes/leads-create.ts";
import { createDeal } from "../_shared/api/routes/deals-create.ts";
import { getDeal, listDeals, listLeadDeals, patchDeal } from "../_shared/api/routes/deals.ts";
import { moveDeal } from "../_shared/api/routes/deals-move.ts";
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

Deno.test("routes — GET /deals e GET /deals/{id} casam, com escopo de leitura", () => {
  const lista = matchRoute("GET", "/api/v1/deals", routes);
  assertEquals(lista?.route.handler, listDeals);
  assertEquals(lista?.route.scope, "deal:read");

  const um = matchRoute("GET", "/api/v1/deals/d-123", routes);
  assertEquals(um?.route.handler, getDeal);
  assertEquals(um?.params.id, "d-123");
});

// Ler não pode conceder escrever. Uma chave de parceiro que só acompanha o funil
// não abre venda nele.
Deno.test("scopes — deal:read não concede deal:write", () => {
  assertEquals(hasScope(["deal:read"], "deal:write"), false);
  assertEquals(hasScope(["deal:read"], "deal:read"), true);
});

Deno.test("routes — PATCH /deals/{id} e GET /leads/{id}/deals", () => {
  const p = matchRoute("PATCH", "/api/v1/deals/d-1", routes);
  assertEquals(p?.route.handler, patchDeal);
  assertEquals(p?.route.scope, "deal:write");
  assertEquals(p?.params.id, "d-1");

  const l = matchRoute("GET", "/api/v1/leads/l-1/deals", routes);
  assertEquals(l?.route.handler, listLeadDeals);
  assertEquals(l?.route.scope, "deal:read");
  assertEquals(l?.params.id, "l-1");
});

// `/leads/{id}/deals` e `/leads/{id}/timeline` têm a mesma forma. Se a de deals
// fosse declarada depois de um `/leads/{id}/{qualquer}`, ficaria inalcançável —
// mesma armadilha do `/leads/search`.
Deno.test("routes — /leads/{id}/timeline continua alcançável", () => {
  const t = matchRoute("GET", "/api/v1/leads/l-1/timeline", routes);
  assertEquals(t?.params.id, "l-1");
  assertEquals(t?.route.scope, "lead:read");
});

Deno.test("routes — POST /deals/{id}/move casa, com escopo de escrita", () => {
  const m = matchRoute("POST", "/api/v1/deals/d-1/move", routes);
  assertEquals(m?.route.handler, moveDeal);
  assertEquals(m?.route.scope, "deal:write");
  assertEquals(m?.params.id, "d-1");
});

// A rota antiga move um LEAD para uma etapa — e a decisão 1 do ADR-0023 diz que
// um Lead NUNCA tem etapa. Ela continua funcionando para não quebrar quem já
// integrou, marcada como depreciada na documentação (#1776). O teste existe para
// que a remoção seja deliberada, e não um efeito colateral de alguém "limpando".
Deno.test("routes — a rota de mover LEAD continua viva, depreciada", () => {
  const m = matchRoute("POST", "/api/v1/leads/l-1/stage", routes);
  assertEquals(m?.params.id, "l-1");
  assertEquals(m?.route.scope, "lead:write");
});
