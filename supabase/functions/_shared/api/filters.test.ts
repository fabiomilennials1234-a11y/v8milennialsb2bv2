import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { parseLeadFilters, parseLimit } from "./filters.ts";

function sp(qs: string): URLSearchParams {
  return new URL(`https://x/api/v1/leads?${qs}`).searchParams;
}

Deno.test("parseLeadFilters — empty query → empty object", () => {
  assertEquals(parseLeadFilters(sp("")), {});
});

Deno.test("parseLeadFilters — parses single-value scalar filters", () => {
  const f = parseLeadFilters(sp("responsible_id=u-1&created_from=2026-01-01&created_to=2026-02-01&q=acme"));
  assertEquals(f, {
    responsible_id: "u-1",
    created_from: "2026-01-01",
    created_to: "2026-02-01",
    q: "acme",
  });
});

Deno.test("parseLeadFilters — multi-value comma lists for stage/tier/tag/origin", () => {
  const f = parseLeadFilters(sp("stage=novo,abordado&tier=Ouro,Prata&tag=vip&origin=meta_ads,google"));
  assertEquals(f.stage, ["novo", "abordado"]);
  assertEquals(f.tier, ["Ouro", "Prata"]);
  assertEquals(f.tag, ["vip"]);
  assertEquals(f.origin, ["meta_ads", "google"]);
});

Deno.test("parseLeadFilters — trims and drops empty segments", () => {
  const f = parseLeadFilters(sp("stage=%20novo%20,,%20abordado&q=%20%20"));
  assertEquals(f.stage, ["novo", "abordado"]);
  assertEquals("q" in f, false);
});

Deno.test("parseLeadFilters — ignores unknown params", () => {
  const f = parseLeadFilters(sp("evil=1&drop_table=2&limit=10&cursor=abc"));
  assertEquals(f, {});
});

Deno.test("parseLimit — default when absent", () => {
  assertEquals(parseLimit(sp("")), 50);
});

Deno.test("parseLimit — clamps to max 100", () => {
  assertEquals(parseLimit(sp("limit=9999")), 100);
});

Deno.test("parseLimit — floors and enforces min 1", () => {
  assertEquals(parseLimit(sp("limit=10.9")), 10);
  assertEquals(parseLimit(sp("limit=0")), 1);
  assertEquals(parseLimit(sp("limit=-5")), 1);
});

Deno.test("parseLimit — invalid → default", () => {
  assertEquals(parseLimit(sp("limit=abc")), 50);
});
