// tests/e2e/11-meta-chat-flow.spec.ts
import { test, expect, request } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_EMAIL = process.env.E2E_USER_EMAIL!;
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD!;
const TEST_ORG_ID = process.env.E2E_ORG_ID!;
const TEST_PAGE_ID = process.env.E2E_META_PAGE_ID!;

test.describe("Meta chat flow", () => {
  test.beforeEach(async () => {
    // wipe meta_conversations and channel_messages for the test page
    const api = await request.newContext({ extraHTTPHeaders: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    await api.delete(`${SUPABASE_URL}/rest/v1/meta_conversations?organization_id=eq.${TEST_ORG_ID}`);
    await api.delete(`${SUPABASE_URL}/rest/v1/channel_messages?organization_id=eq.${TEST_ORG_ID}&channel=in.(messenger,instagram)`);
  });

  test("recebe mensagem inbound e responde", async ({ page, request: req }) => {
    // 1. Login
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|atendimento/);

    // 2. Inject an inbound channel_messages row directly (simulate webhook)
    const inboundId = `e2e_${Date.now()}`;
    await req.post(`${SUPABASE_URL}/rest/v1/channel_messages`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      data: {
        organization_id: TEST_ORG_ID,
        channel: "instagram",
        page_id: TEST_PAGE_ID,
        external_id: inboundId,
        sender_id: "e2e_user_1",
        direction: "incoming",
        message_type: "text",
        content: "olá do e2e",
        status: "received",
        timestamp: new Date().toISOString(),
      },
    });

    // 3. Navigate to /atendimento/meta
    await page.goto(`${BASE_URL}/atendimento/meta`);

    // 4. Conversation appears
    await expect(page.getByText("olá do e2e")).toBeVisible({ timeout: 10_000 });

    // 5. Click conversation -> opens thread
    await page.getByText("olá do e2e").click();
    await expect(page.getByPlaceholder(/Escreva sua mensagem/i)).toBeVisible();

    // 6. Type reply (composer should be enabled — within 24h window)
    await page.getByPlaceholder(/Escreva sua mensagem/i).fill("resposta e2e");
    // Mock send-meta-message to return success without hitting Meta:
    await page.route("**/functions/v1/send-meta-message", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true, message_id: "mid_e2e" }) })
    );
    await page.keyboard.press("Enter");

    // 7. Outgoing bubble appears
    await expect(page.getByText("resposta e2e")).toBeVisible({ timeout: 5000 });
  });
});
