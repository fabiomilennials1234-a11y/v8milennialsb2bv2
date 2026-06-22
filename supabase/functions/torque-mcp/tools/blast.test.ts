import { assertEquals } from "@std/assert";
import { blastSelector, flagStuck } from "./blast.ts";

Deno.test("blastSelector — job_id → single; absent → recent list", () => {
  assertEquals(blastSelector({ org_id: "o1", job_id: "j1" }), { by: "id", value: "j1" });
  assertEquals(blastSelector({ org_id: "o1" }), { by: "recent" });
});

Deno.test("flagStuck — queued with null sender id is stuck", () => {
  assertEquals(flagStuck({ status: "queued", uazapi_sender_id: null }), true);
  assertEquals(flagStuck({ status: "queued", uazapi_sender_id: "" }), true);
});

Deno.test("flagStuck — queued with a sender id, or any other status, is not stuck", () => {
  assertEquals(flagStuck({ status: "queued", uazapi_sender_id: "snd_1" }), false);
  assertEquals(flagStuck({ status: "running", uazapi_sender_id: null }), false);
  assertEquals(flagStuck({ status: "completed", uazapi_sender_id: "snd_1" }), false);
});
