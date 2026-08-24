/**
 * Tabela de rotas da API pública.
 *
 * Extraída do wiring para poder ser importada por teste. O que ela guarda e o
 * `index.ts` não guardaria: **a ORDEM importa**. `matchRoute` percorre a lista e
 * devolve o primeiro casamento, sem preferir literal sobre parâmetro — então
 * `/leads/search` declarada depois de `/leads/{id}` fica inalcançável, com `id`
 * valendo "search". A suíte prova a ordem; reordenar sem quebrar teste não é
 * possível.
 */
import { apiResource } from "../_shared/api/responses.ts";
import type { ApiRoute } from "../_shared/api/router.ts";
import { getLead, getLeadTimeline, listLeads, searchLeads } from "../_shared/api/routes/leads.ts";
import { listCustomFields, listPipelines, listTags } from "../_shared/api/routes/catalogs.ts";
import { createLead } from "../_shared/api/routes/leads-create.ts";
import { createDeal } from "../_shared/api/routes/deals-create.ts";
import {
  addLeadTags,
  moveLeadStage,
  patchLead,
  putCustomFields,
  removeLeadTag,
} from "../_shared/api/routes/leads-write.ts";

export const routes: ApiRoute[] = [
  {
    method: "GET",
    pattern: "/api/v1/ping",
    scope: null, // authenticated, no specific scope — smoke check for partners
    handler: (ctx) =>
      Promise.resolve(
        apiResource(
          {
            pong: true,
            organization_id: ctx.organizationId,
            timestamp: new Date().toISOString(),
          },
          ctx.cors,
        ),
      ),
  },
  { method: "GET", pattern: "/api/v1/leads", scope: "lead:read", handler: listLeads },
  // ⚠️ ANTES de `/leads/{id}`. `matchRoute` devolve o primeiro casamento e não
  // prefere literal sobre parâmetro — invertida, esta rota fica inalcançável.
  { method: "GET", pattern: "/api/v1/leads/search", scope: "lead:read", handler: searchLeads },
  { method: "GET", pattern: "/api/v1/leads/{id}", scope: "lead:read", handler: getLead },
  { method: "GET", pattern: "/api/v1/leads/{id}/timeline", scope: "lead:read", handler: getLeadTimeline },
  { method: "GET", pattern: "/api/v1/pipelines", scope: "pipeline:read", handler: listPipelines },
  { method: "GET", pattern: "/api/v1/tags", scope: "metadata:read", handler: listTags },
  { method: "GET", pattern: "/api/v1/custom-fields", scope: "metadata:read", handler: listCustomFields },
  // P2 — writes (lead:write)
  { method: "POST", pattern: "/api/v1/leads", scope: "lead:write", handler: createLead },
  { method: "POST", pattern: "/api/v1/deals", scope: "deal:write", handler: createDeal },
  { method: "PATCH", pattern: "/api/v1/leads/{id}", scope: "lead:write", handler: patchLead },
  { method: "POST", pattern: "/api/v1/leads/{id}/stage", scope: "lead:write", handler: moveLeadStage },
  { method: "POST", pattern: "/api/v1/leads/{id}/tags", scope: "lead:write", handler: addLeadTags },
  { method: "DELETE", pattern: "/api/v1/leads/{id}/tags/{tag}", scope: "lead:write", handler: removeLeadTag },
  { method: "PUT", pattern: "/api/v1/leads/{id}/custom-fields", scope: "lead:write", handler: putCustomFields },
];
