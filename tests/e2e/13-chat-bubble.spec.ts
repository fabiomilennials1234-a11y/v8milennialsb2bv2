/**
 * E2E Test 13 — Chat Bubble Kanban (PR3 + PR4)
 *
 * Cobre comportamento user-facing do widget flutuante:
 *   - FAB visível nas Pipe pages canônicas
 *   - Auto-hide em /chat e /chat-whatsapp
 *   - Toggle FAB ↔ painel
 *   - Persist {isOpen, isMinimized} em reload
 *
 * Requires:
 *   - VITE_CHAT_BUBBLE=true (default em .env.development)
 *   - admin@test.com seed ativo + auth fixture (.playwright-auth/user.json)
 *   - Dev server em http://localhost:8080 (config.use.baseURL)
 *
 * Não exige fixtures de leads ou instâncias WhatsApp — só valida render do
 * widget. Lista de conversas pode estar vazia (empty state). Smoke test
 * suficiente pra garantir que feature flag e routing seguem corretos.
 */
import { test, expect } from "@playwright/test";

const PIPE_ROUTE = "/pipe-whatsapp";
const CHAT_ROUTE = "/chat";

test.describe("Chat Bubble Kanban", () => {
  test("FAB visível em /pipe-whatsapp", async ({ page }) => {
    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");

    const fab = page.getByTestId("chat-bubble-fab");
    await expect(fab).toBeVisible({ timeout: 10_000 });
  });

  test("FAB tem aria-label adequado", async ({ page }) => {
    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");

    const fab = page.getByTestId("chat-bubble-fab");
    await expect(fab).toBeVisible({ timeout: 10_000 });

    const aria = await fab.getAttribute("aria-label");
    expect(aria).toBeTruthy();
    expect(aria!.toLowerCase()).toMatch(/conversas|whatsapp/);
  });

  test("click FAB abre painel; click X fecha", async ({ page }) => {
    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");

    const fab = page.getByTestId("chat-bubble-fab");
    await fab.click();

    const panel = page.locator("#chat-bubble-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Header tem botão Fechar
    const closeBtn = panel.getByRole("button", { name: /fechar/i });
    await closeBtn.click();
    await expect(panel).toBeHidden({ timeout: 5_000 });
  });

  test("Esc fecha painel quando aberto na lista", async ({ page }) => {
    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("chat-bubble-fab").click();
    const panel = page.locator("#chat-bubble-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden({ timeout: 5_000 });
  });

  test("FAB oculto em /chat (auto-hide)", async ({ page }) => {
    await page.goto(CHAT_ROUTE);
    await page.waitForLoadState("networkidle");

    const fab = page.getByTestId("chat-bubble-fab");
    await expect(fab).toBeHidden({ timeout: 5_000 });
  });

  test("FAB volta ao navegar /chat → /pipe-whatsapp", async ({ page }) => {
    await page.goto(CHAT_ROUTE);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("chat-bubble-fab")).toBeHidden({ timeout: 5_000 });

    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("chat-bubble-fab")).toBeVisible({ timeout: 10_000 });
  });

  test("estado isOpen persiste em reload (localStorage)", async ({ page }) => {
    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("chat-bubble-fab").click();
    await expect(page.locator("#chat-bubble-panel")).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await page.waitForLoadState("networkidle");

    // Painel deve voltar aberto (persist localStorage)
    await expect(page.locator("#chat-bubble-panel")).toBeVisible({ timeout: 10_000 });

    // Cleanup pra não impactar próximos testes (estado é por user, persiste)
    const closeBtn = page
      .locator("#chat-bubble-panel")
      .getByRole("button", { name: /fechar/i });
    await closeBtn.click();
  });

  test("filtro de instância: seleção persiste em reload, badge inalterado", async ({
    page,
  }) => {
    await page.goto(PIPE_ROUTE);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("chat-bubble-fab").click();
    const panel = page.locator("#chat-bubble-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Switcher só aparece com ≥2 instâncias. Em ambiente seed pode haver 0/1 —
    // não falhar nesses cenários; apenas validar que UI tá coerente.
    const switcherTrigger = panel.locator(
      'button[aria-haspopup="listbox"]',
    );
    const switcherCount = await switcherTrigger.count();
    if (switcherCount === 0) {
      // Org de teste com 0/1 instância — feature renderiza fallback (single name).
      // Smoke OK; pula validação de filtragem.
      return;
    }

    // Captura badge atual do FAB ANTES do filtro
    const fab = page.getByTestId("chat-bubble-fab");
    const badgeBefore = await fab.textContent();

    // Abre popover e seleciona o primeiro item após "Todas as conversas"
    await switcherTrigger.first().click();
    const options = page.locator('[role="option"]');
    await expect(options.first()).toBeVisible({ timeout: 3_000 });
    // Pula "Todas" (idx 0) e seleciona idx 1
    const optionCount = await options.count();
    if (optionCount < 2) return;
    await options.nth(1).click();

    // Badge do FAB NÃO muda
    const badgeAfter = await fab.textContent();
    expect(badgeAfter).toBe(badgeBefore);

    // Reload preserva seleção
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#chat-bubble-panel")).toBeVisible({ timeout: 10_000 });
    // Trigger atual deve refletir a instância (não "Todas")
    const reloadedTriggerText = await switcherTrigger.first().textContent();
    expect(reloadedTriggerText).not.toMatch(/Todas/i);

    // Cleanup: reset filter pra não vazar
    await switcherTrigger.first().click();
    await options.first().click(); // "Todas as conversas"
    const closeBtn = panel.getByRole("button", { name: /fechar/i });
    await closeBtn.click();
  });
});
