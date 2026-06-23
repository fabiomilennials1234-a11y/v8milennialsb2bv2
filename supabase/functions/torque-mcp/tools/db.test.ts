import { assertEquals } from "@std/assert";
import { clampMaxRows, isReadOnlySql } from "./db.ts";

Deno.test("isReadOnlySql — accepts a plain SELECT", () => {
  assertEquals(isReadOnlySql("SELECT count(*) FROM leads").ok, true);
});

Deno.test("isReadOnlySql — accepts a read-only WITH (CTE)", () => {
  assertEquals(
    isReadOnlySql("WITH x AS (SELECT id FROM leads) SELECT * FROM x").ok,
    true,
  );
});

Deno.test("isReadOnlySql — accepts a trailing semicolon", () => {
  assertEquals(isReadOnlySql("SELECT 1;").ok, true);
});

Deno.test("isReadOnlySql — rejects empty", () => {
  assertEquals(isReadOnlySql("   ").ok, false);
});

Deno.test("isReadOnlySql — rejects non-SELECT start", () => {
  for (const q of ["UPDATE leads SET x=1", "DELETE FROM leads", "INSERT INTO leads VALUES (1)"]) {
    const r = isReadOnlySql(q);
    assertEquals(r.ok, false, q);
  }
});

Deno.test("isReadOnlySql — rejects DDL", () => {
  for (const q of ["DROP TABLE leads", "ALTER TABLE leads ADD c int", "TRUNCATE leads"]) {
    assertEquals(isReadOnlySql(q).ok, false, q);
  }
});

Deno.test("isReadOnlySql — rejects multiple statements", () => {
  const r = isReadOnlySql("SELECT 1; DROP TABLE leads");
  assertEquals(r.ok, false);
  assertEquals(r.reason, "only a single statement is allowed");
});

Deno.test("isReadOnlySql — rejects a writable CTE", () => {
  assertEquals(
    isReadOnlySql("WITH d AS (DELETE FROM leads RETURNING id) SELECT * FROM d").ok,
    false,
  );
});

Deno.test("isReadOnlySql — rejects SELECT ... INTO and FOR UPDATE", () => {
  assertEquals(isReadOnlySql("SELECT * INTO tmp FROM leads").ok, false);
  assertEquals(isReadOnlySql("SELECT * FROM leads FOR UPDATE").ok, false);
});

Deno.test("isReadOnlySql — rejects comments", () => {
  assertEquals(isReadOnlySql("SELECT 1 -- drop").ok, false);
  assertEquals(isReadOnlySql("SELECT 1 /* x */").ok, false);
});

Deno.test("isReadOnlySql — rejects SET / sequence writes", () => {
  assertEquals(isReadOnlySql("SET role postgres").ok, false);
  assertEquals(isReadOnlySql("SELECT nextval('s')").ok, false);
});

Deno.test("clampMaxRows — defaults and caps", () => {
  assertEquals(clampMaxRows(undefined), 1000);
  assertEquals(clampMaxRows(0), 1000);
  assertEquals(clampMaxRows(-5), 1000);
  assertEquals(clampMaxRows(50), 50);
  assertEquals(clampMaxRows(999999), 5000);
  assertEquals(clampMaxRows(10.9), 10);
});
