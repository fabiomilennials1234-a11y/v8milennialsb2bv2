import { assertEquals } from "@std/assert";
import { instanceHealth } from "./whatsapp.ts";

const NOW = Date.parse("2026-06-22T12:00:00Z");

Deno.test("instanceHealth — live instance (no dead marker)", () => {
  assertEquals(instanceHealth({ session_dead_since: null }, NOW), {
    is_dead: false,
    dead_for_minutes: null,
  });
});

Deno.test("instanceHealth — dead session reports minutes since death", () => {
  const since = "2026-06-22T11:30:00Z"; // 30 min before NOW
  assertEquals(instanceHealth({ session_dead_since: since }, NOW), {
    is_dead: true,
    dead_for_minutes: 30,
  });
});
