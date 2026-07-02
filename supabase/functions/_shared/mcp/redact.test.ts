import { assertEquals } from "@std/assert";
import { redact } from "./redact.ts";

Deno.test("redact — masks phone-like keys, keeps non-PII untouched", () => {
  const out = redact({ phone: "5511999998888", name: "Joao", id: "lead-1" });
  assertEquals(out, { phone: "*********8888", name: "Joao", id: "lead-1" });
});

Deno.test("redact — masks email preserving domain, recurses into nested objects", () => {
  const out = redact({
    email: "joao@acme.com",
    lead: { phone: "5511999998888", name: "Joao" },
  });
  assertEquals(out, {
    email: "j***@acme.com",
    lead: { phone: "*********8888", name: "Joao" },
  });
});

Deno.test("redact — recurses into arrays of objects (PII in lists is masked)", () => {
  const out = redact({
    leads: [
      { phone: "5511999998888", name: "Joao" },
      { phone: "5521988887777", name: "Maria" },
    ],
  });
  assertEquals(out, {
    leads: [
      { phone: "*********8888", name: "Joao" },
      { phone: "*********7777", name: "Maria" },
    ],
  });
});
