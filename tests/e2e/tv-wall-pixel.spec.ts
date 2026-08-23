/**
 * HARNESS DE PIXEL da parede da TV (#1254 acabamento).
 *
 * Renderiza /tv-wall-preview — a TVComposableWall REAL montada com snapshot-fixture
 * (grid + WidgetFrame + buildEyebrow reais) — em Chromium 1920×1080, e mede a
 * SUPERFÍCIE que jsdom não tem: scrollWidth/clientWidth (truncamento) e razão de
 * altura (card vazio). Os 3 asserts são GUARDA DE REGRESSÃO do acabamento.
 *
 * TIMING (achado da Bancada): medir/fotografar cedo pega o layout não-assentado
 * (loader do shell ainda subindo) → falso verde. Aqui espera-se `fonts.ready` +
 * GEOMETRIA ESTÁVEL (2 amostras iguais) antes de medir — nunca waitForTimeout.
 *
 * NASCE VERMELHO de propósito (A trunca+vão, B trunca, D rótulo cru). C (etapa
 * degradada, guarda do S2) é VERDE. Verde ao nascer no que importa = fixture cego,
 * a Bancada reprova o HARNESS.
 *
 * Rodar: projeto 'pixel' (sem auth). Ex.:
 *   npm run dev -- --port 8090          # server DESTE worktree (tem a rota)
 *   PW_BASE_URL=http://localhost:8090 npx playwright test --project=pixel
 */
import { test, expect } from "@playwright/test";

// Harness dev-only: /tv-wall-preview renderiza SEM auth. storageState vazio
// dispensa o auth.setup. O projeto 'pixel' já roda sem dependency 'setup'.
test.use({ viewport: { width: 1920, height: 1080 }, storageState: { cookies: [], origins: [] } });

test.describe("TV parede — harness de pixel", () => {
  test("parede real: sem truncamento, sem card vazio, rótulo honesto", async ({ page }) => {
    await page.goto("/tv-wall-preview");

    // 1) os 5 cards montaram.
    await page.waitForSelector('[data-testid="tv-card"]', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="tv-card"]').length === 5, { timeout: 20000 });

    // 2) FONTES carregadas de verdade (fallback é mais estreita → mede sem
    //    truncar). Espera o status virar 'loaded', não só a promise ready.
    await page.waitForFunction(() => (document as { fonts?: { status?: string; ready?: Promise<unknown> } }).fonts?.status === "loaded", { timeout: 20000 });

    // 3) GEOMETRIA ESTÁVEL: mesma assinatura em 2 amostras consecutivas (o layout
    //    parou de assentar). Sem isto o scrollWidth mede antes da fonte/tamanho final.
    await page.waitForFunction(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="tv-card"]')) as HTMLElement[];
      // 5, não 4: o 5º widget (funil) entrou no fixture em 106f6c24 e a espera
      // da linha 33 já contava 5 — esta aqui ficou em 4 e nunca resolvia, o que
      // matava o harness mesmo rodando contra a rota de verdade.
      if (cards.length !== 5) return false;
      const sig = cards.map((c) => {
        const v = c.querySelector('[data-testid="tv-value"]') as HTMLElement | null;
        const e = c.querySelector('[data-testid="tv-eyebrow"]') as HTMLElement | null;
        return [c.clientHeight, v?.scrollWidth ?? -1, v?.clientWidth ?? -1, e?.scrollWidth ?? -1].join(",");
      }).join("|");
      const w = window as unknown as { __tvSig?: string };
      const stable = w.__tvSig === sig;
      w.__tvSig = sig;
      return stable;
    }, { timeout: 20000, polling: 300 });

    // Artefato do PR = screenshot do ELEMENTO da parede (não full-page → nunca o loader).
    await page.locator('[data-testid="tv-wall-root"]').screenshot({ path: "test-results/tv-wall-1920x1080.png" });

    const report = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="tv-card"]')) as HTMLElement[];
      const truncated: string[] = [];
      const emptyCards: { card: number; void: number }[] = [];
      const rawLabels: string[] = [];
      const RAW_ID_PAIR = /^[a-z_]+ \/ [a-z_]+$/;

      cards.forEach((card, i) => {
        const cardH = card.clientHeight;

        // ASSERT 1 — truncamento de valor-de-cabeça E de eyebrow.
        card.querySelectorAll('[data-testid="tv-value"],[data-testid="tv-eyebrow"]').forEach((el) => {
          const e = el as HTMLElement;
          if (e.scrollWidth > e.clientWidth + 1) {
            truncated.push(`card#${i} ${el.getAttribute("data-testid")}="${(e.textContent || "").trim()}"`);
          }
        });

        // ASSERT 2 — card com corpo VAZIO (número/escalar) não pode ter >60% de vão.
        // Corpo vazio = tv-content sem filhos no DOM (children é sempre um elemento
        // <TVWidgetBody/>, mas ele renderiza null p/ número → 0 filhos). Mede o vão
        // REAL (altura do content vazio / altura do card), não um atributo.
        const content = card.querySelector('[data-testid="tv-content"]') as HTMLElement | null;
        if (content && content.children.length === 0 && cardH > 0) {
          const gap = content.clientHeight / cardH;
          if (gap > 0.6) emptyCards.push({ card: i, void: Number(gap.toFixed(2)) });
        }

        // ASSERT 3 — eyebrow de razão não pode ser id cru concatenado.
        const eyebrow = ((card.querySelector('[data-testid="tv-eyebrow"]') as HTMLElement | null)?.textContent || "").trim();
        if (RAW_ID_PAIR.test(eyebrow)) rawLabels.push(`card#${i}="${eyebrow}"`);
      });

      return { cardCount: cards.length, truncated, emptyCards, rawLabels };
    });

    console.log("[PIXEL HARNESS]", JSON.stringify(report, null, 2));

    expect(report.cardCount, "a parede montou os 5 widgets do fixture").toBe(5);
    // ASSERT 1 — truncamento (RED: A "R$ 86 mil", B valor+eyebrow, D eyebrow).
    expect(report.truncated, `valor/eyebrow truncados: ${report.truncated.join(" | ") || "nenhum"}`).toEqual([]);
    // ASSERT 2 — card vazio (RED: A escalar em grid h=4, >60% de vão).
    expect(report.emptyCards, `cards com >60% de vão: ${JSON.stringify(report.emptyCards)}`).toEqual([]);
    // ASSERT 3 — rótulo honesto (RED: D "leads_criados / reunioes_marcadas").
    expect(report.rawLabels, `eyebrow com id cru: ${report.rawLabels.join(" | ") || "nenhum"}`).toEqual([]);
  });
});
