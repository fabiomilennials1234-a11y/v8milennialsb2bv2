// @vitest-environment node
/**
 * As invariantes de cloudflare/wrangler.jsonc que o roteamento, a paridade e a
 * segurança assumem. Trocar uma delas muda o comportamento em produção sem
 * tocar numa linha de código — por isso ficam presas aqui.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const file = path.resolve(__dirname, "../../../cloudflare/wrangler.jsonc");
// O parser de tsconfig do TypeScript lê JSONC (comentários e vírgula sobrando).
const { config, error } = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, "utf8"));

describe("cloudflare/wrangler.jsonc", () => {
  it("é JSONC válido", () => {
    expect(error).toBeUndefined();
    expect(config.name).toBe("torque-front");
    expect(config.main).toBe("src/worker.ts");
  });

  it("/assets/* sai direto do servidor de assets; o resto passa pelo Worker", () => {
    expect(config.assets.run_worker_first).toEqual(["/*", "!/assets/*"]);
  });

  it("caminho exato: sem 307 de html_handling e sem fallback do servidor de assets", () => {
    expect(config.assets.html_handling).toBe("none");
    expect(config.assets.not_found_handling).toBe("none");
    expect(config.assets.binding).toBe("ASSETS");
    expect(config.assets.directory).toBe("./.assets");
  });

  it("logs: sem log automático de invocação e sem query string", () => {
    expect(config.observability.enabled).toBe(true);
    expect(config.observability.logs.invocation_logs).toBe(false);
    expect(config.observability.redact_query_string).toBe(true);
  });

  it("só workers.dev, sem URL de preview, sem source map enviado", () => {
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(config.upload_source_maps).toBe(false);
  });

  it("nada de conta, rota ou segredo no repositório", () => {
    for (const key of ["account_id", "routes", "route", "secrets", "kv_namespaces", "d1_databases"]) {
      expect(config, key).not.toHaveProperty(key);
    }
    expect(Object.keys(config.vars)).toEqual(["API_UPSTREAM"]);
    expect(config.vars.API_UPSTREAM).toBe("https://jsjsmuncfkbsbzqzqhfq.supabase.co");
  });
});
