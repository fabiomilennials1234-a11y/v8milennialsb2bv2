import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { createMetaGraphClient } from "./graph-client.ts";

function decodeUrl(u: string): string {
  return decodeURIComponent(u);
}

/**
 * Builds a fake fetch that returns queued JSON responses in order, recording
 * the URLs/inits it was called with. Lets us assert request shape + drive
 * pagination without touching the live Graph API.
 */
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(
      new Response(JSON.stringify(r.body), { status: r.status ?? 200 }),
    );
  };
  return { impl, calls };
}

Deno.test("listAdAccounts — parses accounts and follows pagination cursor", async () => {
  const { impl, calls } = fakeFetch([
    {
      body: {
        data: [
          { id: "act_1", name: "Cliente A", account_id: "1", account_status: 1 },
          { id: "act_2", name: "Cliente B", account_id: "2", account_status: 1 },
        ],
        paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?after=CURSOR2" },
      },
    },
    {
      body: {
        data: [
          { id: "act_3", name: "Cliente C", account_id: "3", account_status: 2 },
        ],
        paging: {},
      },
    },
  ]);

  const client = createMetaGraphClient({ token: "T", fetchImpl: impl });
  const accounts = await client.listAdAccounts();

  assertEquals(accounts.map((a) => a.id), ["act_1", "act_2", "act_3"]);
  assertEquals(accounts[2], {
    id: "act_3",
    name: "Cliente C",
    account_id: "3",
    account_status: 2,
  });
  // Two fetches = followed the cursor.
  assertEquals(calls.length, 2);
  assertStringIncludes(calls[1].url, "after=CURSOR2");
});

Deno.test("listAdAccounts — surfaces Graph error without leaking the token", async () => {
  const { impl } = fakeFetch([
    {
      status: 400,
      body: {
        error: {
          message: "Invalid OAuth access token.",
          code: 190,
          type: "OAuthException",
        },
      },
    },
  ]);

  const client = createMetaGraphClient({ token: "SUPER_SECRET_TOKEN", fetchImpl: impl });

  let thrown: Error | null = null;
  try {
    await client.listAdAccounts();
  } catch (e) {
    thrown = e as Error;
  }

  if (!thrown) throw new Error("expected listAdAccounts to throw on Graph error");
  // Message carries the Graph reason...
  assertStringIncludes(thrown.message, "Invalid OAuth access token");
  // ...but never the token itself.
  assertEquals(thrown.message.includes("SUPER_SECRET_TOKEN"), false);
});

Deno.test("fetchLeadsSince — returns leads, filters by since, advances cursor to newest", async () => {
  const { impl, calls } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "lead_b",
            created_time: "2026-06-15T13:10:01+0000",
            field_data: [
              { name: "full_name", values: ["Maria"] },
              { name: "phone_number", values: ["+5511999"] },
            ],
          },
          {
            id: "lead_a",
            created_time: "2026-06-15T10:58:39+0000",
            field_data: [{ name: "full_name", values: ["Joao"] }],
          },
        ],
        paging: {},
      },
    },
  ]);

  const client = createMetaGraphClient({ token: "T", fetchImpl: impl });
  const since = 1750000000; // unix seconds
  const result = await client.fetchLeadsSince("form_123", "PAGE_TOKEN", since);

  // Hits the form's leads edge with the page-scoped token.
  assertStringIncludes(calls[0].url, "/form_123/leads");
  assertStringIncludes(calls[0].url, "access_token=PAGE_TOKEN");
  // Carries a time_created GREATER_THAN filter with the since value.
  const decoded = decodeUrl(calls[0].url);
  assertStringIncludes(decoded, "time_created");
  assertStringIncludes(decoded, String(since));

  // Returns parsed leads in order.
  assertEquals(result.leads.map((l) => l.id), ["lead_b", "lead_a"]);
  assertEquals(result.leads[0].field_data[1], { name: "phone_number", values: ["+5511999"] });

  // Cursor advances to the newest created_time (epoch seconds).
  assertEquals(result.newestCreatedTime, Math.floor(Date.parse("2026-06-15T13:10:01+0000") / 1000));
});

Deno.test("sendConversion — posts system_generated event keyed by lead_id, no monetary value", async () => {
  const { impl, calls } = fakeFetch([{ body: { events_received: 1 } }]);

  const client = createMetaGraphClient({ token: "T", fetchImpl: impl });
  await client.sendConversion({
    datasetId: "ds_999",
    leadId: "lead_b",
    eventName: "sold",
  });

  const call = calls[0];
  // POST to the dataset events edge.
  assertEquals(call.init?.method, "POST");
  assertStringIncludes(call.url, "/ds_999/events");

  const body = JSON.parse(String(call.init?.body));
  const event = body.data[0];
  assertEquals(event.event_name, "sold");
  assertEquals(event.action_source, "system_generated");
  assertEquals(event.user_data.lead_id, "lead_b");

  // Revenue must NEVER reach Meta — no value/currency anywhere in the payload.
  const serialized = JSON.stringify(body);
  assertEquals(serialized.includes("\"value\""), false);
  assertEquals(serialized.includes("currency"), false);
});

Deno.test("sendConversion — passes each escalated event_name through unchanged", async () => {
  for (const name of ["qualified", "meeting", "sold"] as const) {
    const { impl, calls } = fakeFetch([{ body: { events_received: 1 } }]);
    const client = createMetaGraphClient({ token: "T", fetchImpl: impl });
    await client.sendConversion({ datasetId: "ds", leadId: "l", eventName: name });
    assertEquals(JSON.parse(String(calls[0].init?.body)).data[0].event_name, name);
  }
});

Deno.test("listPages — merges owned + client pages and dedups by id", async () => {
  // First call → owned_pages; second → client_pages (overlaps on page_shared).
  const { impl, calls } = fakeFetch([
    {
      body: {
        data: [
          { id: "page_own", name: "Milennials", access_token: "t1" },
          { id: "page_shared", name: "Cliente X", access_token: "t2" },
        ],
        paging: {},
      },
    },
    {
      body: {
        data: [
          { id: "page_shared", name: "Cliente X", access_token: "t2" },
          { id: "page_client", name: "Cliente Y", access_token: "t3" },
        ],
        paging: {},
      },
    },
  ]);

  const client = createMetaGraphClient({ token: "T", fetchImpl: impl });
  const pages = await client.listPages("biz_1");

  // Both business edges queried.
  assertEquals(calls.length, 2);
  assertStringIncludes(calls[0].url, "/biz_1/owned_pages");
  assertStringIncludes(calls[1].url, "/biz_1/client_pages");

  // Deduped union, owned first.
  assertEquals(pages.map((p) => p.id), ["page_own", "page_shared", "page_client"]);
});
