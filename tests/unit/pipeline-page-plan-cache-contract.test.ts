/**
 * `get_pipeline_page` e `get_pipeline_stage_counts_by_id` rodam com
 * `plan_cache_mode = force_generic_plan` (20271107110000). Medido em prod em
 * 2026-10-05: o plano específico varre a etapa inteira sob a policy de leads
 * (29.145 buffers, ~700 ms no membro); o genérico para em 20 linhas (~6 ms).
 *
 * `CREATE OR REPLACE FUNCTION` SUBSTITUI o proconfig inteiro: a próxima
 * migration que redefinir uma das duas sem repetir o SET devolve o board ao
 * plano lento, em silêncio. Este contrato reconstrói, na ordem das migrations
 * ativas, o último estado do SET de cada função e exige que termine ligado.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");
const FUNCTIONS = ["get_pipeline_page", "get_pipeline_stage_counts_by_id"] as const;

type Event = { file: string; on: boolean };

/** Cada statement (até o `;` de fechamento) que cria ou altera a função. */
function planCacheEvents(file: string, sql: string, fn: string): Event[] {
  const events: Event[] = [];
  // Schema opcional (`public.` ou nada) e identificadores entre aspas
  // (`"public"."get_pipeline_page"`): as três formas resolvem para a mesma função.
  const name = `(?:"?public"?\\s*\\.\\s*)?"?${fn}"?`;
  const create = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${name}\\s*\\([\\s\\S]*?\\n\\$(\\w*)\\$`,
    "gi",
  );
  const alter = new RegExp(`ALTER\\s+FUNCTION\\s+${name}\\s*\\([^;]*;`, "gi");
  const found: Array<{ at: number; on: boolean }> = [];
  for (const m of sql.matchAll(create)) {
    found.push({ at: m.index ?? 0, on: /plan_cache_mode\s*(?:=|TO)\s*'?force_generic_plan/i.test(m[0]) });
  }
  for (const m of sql.matchAll(alter)) {
    if (/SET\s+plan_cache_mode\s*(?:=|TO)\s*'?force_generic_plan/i.test(m[0])) {
      found.push({ at: m.index ?? 0, on: true });
    } else if (/RESET\s+(?:plan_cache_mode|ALL)|SET\s+plan_cache_mode/i.test(m[0])) {
      found.push({ at: m.index ?? 0, on: false });
    }
  }
  for (const f of found.sort((a, b) => a.at - b.at)) events.push({ file, on: f.on });
  return events;
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("plano genérico de get_pipeline_page e counts", () => {
  for (const fn of FUNCTIONS) {
    it(`${fn} termina com plan_cache_mode = force_generic_plan`, () => {
      const events = files.flatMap((f) =>
        planCacheEvents(f, readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"), fn),
      );
      expect(events.length).toBeGreaterThan(0);
      const last = events[events.length - 1];
      expect(last, `última migration que toca ${fn}: ${last.file}`).toMatchObject({ on: true });
    });
  }

  it("CREATE OR REPLACE sem o SET depois do ALTER é detectado", () => {
    const alter = planCacheEvents(
      "a.sql",
      "ALTER FUNCTION public.get_pipeline_page(text) SET plan_cache_mode = force_generic_plan;",
      "get_pipeline_page",
    );
    const recreate = planCacheEvents(
      "b.sql",
      "CREATE OR REPLACE FUNCTION public.get_pipeline_page(p text)\nRETURNS int\nLANGUAGE plpgsql\nSET search_path TO ''\nAS $function$ BEGIN RETURN 1; END;\n$function$;",
      "get_pipeline_page",
    );
    const reset = planCacheEvents(
      "c.sql",
      "ALTER FUNCTION public.get_pipeline_page(text) RESET plan_cache_mode;",
      "get_pipeline_page",
    );
    expect(alter).toEqual([{ file: "a.sql", on: true }]);
    expect(recreate).toEqual([{ file: "b.sql", on: false }]);
    expect(reset).toEqual([{ file: "c.sql", on: false }]);
  });

  it("CREATE OR REPLACE sem schema é detectado", () => {
    const recreate = planCacheEvents(
      "d.sql",
      "CREATE OR REPLACE FUNCTION get_pipeline_page(p text)\nRETURNS int\nLANGUAGE plpgsql\nAS $function$ BEGIN RETURN 1; END;\n$function$;",
      "get_pipeline_page",
    );
    expect(recreate).toEqual([{ file: "d.sql", on: false }]);
  });

  it("CREATE OR REPLACE com nome entre aspas é detectado", () => {
    const recreate = planCacheEvents(
      "e.sql",
      'CREATE OR REPLACE FUNCTION "public"."get_pipeline_page"(p text)\nRETURNS int\nLANGUAGE plpgsql\nAS $function$ BEGIN RETURN 1; END;\n$function$;',
      "get_pipeline_page",
    );
    expect(recreate).toEqual([{ file: "e.sql", on: false }]);
  });

  it("ALTER sem schema e com aspas são detectados", () => {
    const bare = planCacheEvents(
      "f.sql",
      "ALTER FUNCTION get_pipeline_page(text) RESET plan_cache_mode;",
      "get_pipeline_page",
    );
    const quoted = planCacheEvents(
      "g.sql",
      'ALTER FUNCTION "public"."get_pipeline_page"(text) SET plan_cache_mode = force_generic_plan;',
      "get_pipeline_page",
    );
    expect(bare).toEqual([{ file: "f.sql", on: false }]);
    expect(quoted).toEqual([{ file: "g.sql", on: true }]);
  });

  it("nome com sufixo não casa (get_pipeline_page_v2)", () => {
    const other = planCacheEvents(
      "h.sql",
      "ALTER FUNCTION public.get_pipeline_page_v2(text) RESET plan_cache_mode;",
      "get_pipeline_page",
    );
    expect(other).toEqual([]);
  });
});
