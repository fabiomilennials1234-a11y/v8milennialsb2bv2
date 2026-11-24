import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { missingScopeHint, serverInstructions, WRITE_SCOPES } from "./capabilities.ts";

Deno.test("instructions: a read-only token is told what each write needs and where to get it", () => {
  const text = serverInstructions(["read"]);
  for (const [scope, info] of Object.entries(WRITE_SCOPES)) {
    assertStringIncludes(text, `"${info.label}" (${scope})`);
  }
  assertMatch(text, /broadcasts — including a message taken from an automation/);
  assertMatch(text, /cannot be widened/);
  assertMatch(text, /Never confirm without the person's explicit OK/);
});

Deno.test("instructions: a full token lists what it can do and has no 'not enabled' part", () => {
  const text = serverInstructions(["read", "crm:write", "messages:send", "automations:write"]);
  assertEquals(text.includes("Not enabled"), false);
  assertMatch(text, /send WhatsApp broadcasts .* \(messages:send\)/);
});

Deno.test("instructions: scopes the server does not know are ignored", () => {
  assertEquals(serverInstructions(["read", "admin:all"]), serverInstructions(["read"]));
});

Deno.test("missingScopeHint: names the option on the token screen; admin-only for messages", () => {
  assertMatch(missingScopeHint("messages:send"), /"Enviar mensagens".*Só um admin/s);
  assertEquals(missingScopeHint("crm:write").includes("admin"), false);
});
