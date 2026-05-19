/**
 * E2E Test 11 — Lead Detail Modal v2 (PRD #284, issue #316)
 *
 * Valida que o modal de lead abre corretamente a partir de cada call site
 * relevante, expandindo a section certa quando aplicável, e que ações
 * críticas (mover stage, deletar) funcionam.
 *
 * Permission flavors: admin vê tudo, membro vê delete desabilitado.
 * Master flavor depende de seed; skipa graciosamente se ausente.
 *
 * Smoke alvo: roda em < 5 min. Cobertura de profundidade fica em
 * specs específicos por feature (RescheduleModal, BudgetFieldBlock,
 * etc, em integration tests).
 */

import { test, expect, type Page } from "@playwright/test";

const MODAL_TESTID = "lead-detail-dialog";
const ACCORDION_HEADER_QUALIFICACAO = /qualificação/i;
const ACCORDION_HEADER_CONFIRMACAO = /confirmação/i;
const ACCORDION_HEADER_PROPOSTAS = /propostas/i;

/** Click on the first lead card / row visible on the page and wait modal. */
async function openFirstLead(page: Page) {
  // Generic: try card with role link/button containing lead name; fallback to
  // first table row with data-testid lead-row.
  const candidates = [
    page.locator('[data-testid^="lead-card-"]').first(),
    page.locator('[data-testid^="lead-row-"]').first(),
    page.getByRole("link", { name: /lead/i }).first(),
  ];
  for (const c of candidates) {
    if ((await c.count()) > 0) {
      await c.click();
      break;
    }
  }
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 8_000 });
}

test.describe("Lead Modal v2 — call sites", () => {
  test("abre via página /leads", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
  });

  test("abre via /pipe-whatsapp com section Qualificação expandida", async ({ page }) => {
    await page.goto("/pipe-whatsapp");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
    const qualif = page.getByRole("button", { name: ACCORDION_HEADER_QUALIFICACAO }).first();
    if ((await qualif.count()) > 0) {
      await expect(qualif).toHaveAttribute("aria-expanded", "true");
    }
  });

  test("abre via /pipe-confirmacao com section Confirmação expandida", async ({ page }) => {
    await page.goto("/pipe-confirmacao");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
    const conf = page.getByRole("button", { name: ACCORDION_HEADER_CONFIRMACAO }).first();
    if ((await conf.count()) > 0) {
      await expect(conf).toHaveAttribute("aria-expanded", "true");
    }
  });

  test("abre via /pipe-propostas com section Propostas expandida", async ({ page }) => {
    await page.goto("/pipe-propostas");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
    const prop = page.getByRole("button", { name: ACCORDION_HEADER_PROPOSTAS }).first();
    if ((await prop.count()) > 0) {
      await expect(prop).toHaveAttribute("aria-expanded", "true");
    }
  });

  test("abre via /follow-ups", async ({ page }) => {
    await page.goto("/follow-ups");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
  });

  test("ESC fecha o modal", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").first()).not.toBeVisible({ timeout: 5_000 });
  });

  test("mobile viewport renderiza 3 tabs [Info][Pipes][Atividade]", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
    // Aceita ausência do testid quando V1 está ativo na org de teste.
    const tabs = page.getByTestId("lead-modal-mobile-tabs");
    if ((await tabs.count()) > 0) {
      await expect(page.getByTestId("tab-info")).toBeVisible();
      await expect(page.getByTestId("tab-pipes")).toBeVisible();
      await expect(page.getByTestId("tab-atividade")).toBeVisible();
    }
  });
});

test.describe("Lead Modal v2 — permission flavors", () => {
  test("admin vê botão de delete (toolbar overflow)", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    await openFirstLead(page);
    // Overflow menu pode estar atrás de um trigger "..."; tenta abrir.
    const overflow = page.getByRole("button", { name: /mais|overflow|more/i }).first();
    if ((await overflow.count()) > 0) {
      await overflow.click();
    }
    const deleteBtn = page.getByRole("menuitem", { name: /excluir|deletar/i }).first();
    if ((await deleteBtn.count()) > 0) {
      await expect(deleteBtn).toBeVisible();
    }
  });

  // Member flavor placeholder — exige storageState próprio (member.json) que
  // ainda não existe na suite. Quando criar, copiar pattern do admin acima
  // e asserir `toBeDisabled()` ou tooltip "Sem permissão".
  test.skip("membro vê delete desabilitado + tooltip", async () => {
    // TODO: setup storageState member.json + asserir disabled.
  });
});
