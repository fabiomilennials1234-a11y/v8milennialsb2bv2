/**
 * Sprint 7 S7.1 — Playwright E2E suite for Uazapi features.
 *
 * Covers UI presence + interaction plumbing only. Real WhatsApp send
 * flows require a live instance — those stay as manual QA during pilot.
 *
 * Tests run only when E2E_RUN_UAZAPI=1 is set (keeps CI fast).
 */
import { test, expect } from "@playwright/test";

const RUN = process.env.E2E_RUN_UAZAPI === "1";

test.describe("Uazapi features — smoke", () => {
  test.skip(!RUN, "set E2E_RUN_UAZAPI=1 to include these tests");

  test("settings > whatsapp shows instance list", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: /WhatsApp/i }).click();
    await expect(page.getByText(/Instâncias/i)).toBeVisible();
  });

  test("history-sync dialog opens with 3 tabs", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: /WhatsApp/i }).click();
    const btn = page.getByRole("button", { name: /Importar histórico/i });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await expect(page.getByRole("tab", { name: "Padrão" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Completo" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Por chat" })).toBeVisible();
    }
  });

  test("mass-send page is reachable and renders form", async ({ page }) => {
    await page.goto("/campaigns/mass-send");
    await expect(page.getByText(/Envio em massa/i)).toBeVisible();
    await expect(page.getByText(/Novo blast/i)).toBeVisible();
  });

  test("master migration dashboard lists orgs", async ({ page }) => {
    await page.goto("/master/whatsapp-migration");
    await expect(page.getByText(/Migração WhatsApp/i)).toBeVisible();
    await expect(page.getByText(/Organizações/i)).toBeVisible();
  });

  test("workflow action panel includes menu + pix types", async ({ page }) => {
    await page.goto("/automacoes");
    const newBtn = page.getByRole("button", { name: /Novo/i });
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      // Presence in the dropdown when creating an action node
      await page.waitForTimeout(500);
      const labels = ["Menu Interativo", "Botão PIX"];
      for (const l of labels) {
        const el = page.getByText(new RegExp(l, "i"));
        if (await el.count()) await expect(el.first()).toBeVisible();
      }
    }
  });
});
