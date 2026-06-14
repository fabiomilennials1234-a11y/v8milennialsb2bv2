/**
 * Generates public API artifacts from the single source of truth
 * (src/lib/api-docs/rest-api-endpoints.ts):
 *   - public/api/openapi.json   (OpenAPI 3.0)
 *   - public/api/postman_collection.json (Postman v2.1)
 *   - public/api/llms.txt       (LLM-friendly summary)
 *
 * Run: deno run --allow-read --allow-write scripts/gen-api-spec.ts
 */
import { restApiCategory } from "../src/lib/api-docs/rest-api-endpoints.ts";
import type { ApiEndpoint } from "../src/lib/api-docs/types.ts";

const SERVER = "https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1";
const OUT_DIR = new URL("../public/api/", import.meta.url);
const endpoints = restApiCategory.endpoints;

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpoints) {
    const pNames = pathParamNames(e.path);
    const params = e.parameters.filter((p) => p.name !== "<field_name>");
    const openapiParams = params
      .filter((p) => pNames.includes(p.name) || (e.method === "GET" && !pNames.includes(p.name)))
      .map((p) => ({
        name: p.name,
        in: pNames.includes(p.name) ? "path" : "query",
        required: pNames.includes(p.name) ? true : p.required,
        description: p.description,
        schema: { type: p.type.includes("number") ? "integer" : "string" },
      }));

    const op: Record<string, unknown> = {
      operationId: e.id,
      summary: e.name,
      description: [e.description, ...(e.notes ?? [])].join("\n\n"),
      tags: ["REST API v1"],
      security: [{ ApiKeyAuth: [] }],
      parameters: openapiParams,
      responses: {
        "200": { description: "OK", content: { "application/json": { example: e.responseExample } } },
        "4XX": {
          description: "Erro",
          content: { "application/json": { example: { error: { code: "string", message: "string" } } } },
        },
      },
    };

    if (["POST", "PATCH", "PUT"].includes(e.method) && e.requestExample && Object.keys(e.requestExample).length) {
      op.requestBody = {
        required: e.method !== "PATCH",
        content: { "application/json": { example: e.requestExample } },
      };
    }

    const key = e.path; // already /api/v1/... with {id} placeholders
    paths[key] = paths[key] ?? {};
    paths[key][e.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Torque CRM — Public REST API",
      version: "1.0.0",
      description: "API REST pública lead-cêntrica (ADR-0008). Auth via API Key escopada (tq_live_*).",
    },
    servers: [{ url: SERVER, description: "Produção" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths,
  };
}

function buildPostman() {
  return {
    info: {
      name: "Torque CRM — REST API v1",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: { type: "apikey", apikey: [{ key: "key", value: "X-API-Key" }, { key: "value", value: "{{api_key}}" }, { key: "in", value: "header" }] },
    variable: [
      { key: "base_url", value: SERVER },
      { key: "api_key", value: "tq_live_xxx" },
    ],
    item: endpoints.map((e: ApiEndpoint) => {
      const pNames = pathParamNames(e.path);
      const query = e.parameters
        .filter((p) => p.name !== "<field_name>" && !pNames.includes(p.name) && e.method === "GET")
        .map((p) => ({ key: p.name, value: "", description: p.description, disabled: true }));
      const rawPath = e.path.replace(/^\//, "").split("/");
      const req: Record<string, unknown> = {
        method: e.method,
        header: [{ key: "Content-Type", value: "application/json" }],
        url: {
          raw: `{{base_url}}${e.path}`,
          host: ["{{base_url}}"],
          path: rawPath,
          query,
        },
      };
      if (["POST", "PATCH", "PUT"].includes(e.method) && Object.keys(e.requestExample).length) {
        req.body = { mode: "raw", raw: JSON.stringify(e.requestExample, null, 2), options: { raw: { language: "json" } } };
      }
      return { name: `${e.method} ${e.name}`, request: req };
    }),
  };
}

function buildLlmsTxt(): string {
  const lines: string[] = [];
  lines.push("# Torque CRM — Public REST API v1");
  lines.push("");
  lines.push("> API REST lead-cêntrica (ADR-0008). Base: " + SERVER);
  lines.push("> Auth: header `X-API-Key: tq_live_...` (ou `Authorization: Bearer tq_live_...`). Escopos por rota.");
  lines.push("> Envelopes: listas `{ data, next_cursor, has_more }`; recurso único = objeto; erro `{ error: { code, message, details? } }`.");
  lines.push("");
  for (const e of endpoints) {
    lines.push(`## ${e.method} ${e.path}`);
    lines.push(e.description);
    const params = e.parameters.filter((p) => p.name !== "<field_name>");
    if (params.length) {
      lines.push("");
      lines.push("Parâmetros:");
      for (const p of params) {
        lines.push(`- \`${p.name}\` (${p.type}${p.required ? ", obrigatório" : ""}): ${p.description}`);
      }
    }
    lines.push("");
    lines.push("Resposta (exemplo): `" + JSON.stringify(e.responseExample) + "`");
    if (e.notes?.length) {
      lines.push("");
      for (const n of e.notes) lines.push(`Nota: ${n}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

await Deno.mkdir(OUT_DIR, { recursive: true });
await Deno.writeTextFile(new URL("openapi.json", OUT_DIR), JSON.stringify(buildOpenApi(), null, 2));
await Deno.writeTextFile(new URL("postman_collection.json", OUT_DIR), JSON.stringify(buildPostman(), null, 2));
await Deno.writeTextFile(new URL("llms.txt", OUT_DIR), buildLlmsTxt());
console.log(`Generated ${endpoints.length} endpoints → public/api/{openapi.json, postman_collection.json, llms.txt}`);
