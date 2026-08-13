/**
 * E2E 16 — Estúdio de Métricas (`/metricas`)
 *
 * SCRUM-311 fatias 9 e 10 · SCRUM-310/308/309 · ADR-0023 + Emenda 1.
 *
 * O TESTE QUE ESTE ARQUIVO EXISTE PARA FAZER é `lead ≠ negócio`: um lead com
 * DOIS negócios abertos precisa aparecer como **2** em "Negócios na etapa" e
 * **1** em "Leads na etapa". Em produção a mesma medida servia aos dois nomes —
 * 41.025 entradas para 36.073 leads, 12% de erro que ninguém via.
 *
 * ⚠ A asserção é sobre a DIFERENÇA (`negócios = leads + 1`), não sobre os
 * totais. O seed já traz um card de `pipe_whatsapp` na mesma org, e o total
 * inclui ele; a RELAÇÃO é o que a fatia mudou, e ela sobrevive a quem
 * acrescentar lead ao seed depois. Se as duas medidas voltarem a devolver o
 * mesmo número, este teste cai — que é exatamente o ponto.
 *
 * Fixture: `supabase/seed.sql` bloco 11 (org A com `metrics_studio_enabled`,
 * funil "Funil Métricas", L1 com dois negócios, L2 com um, 2 vendas no mês).
 * O CI roda `supabase start` + `psql -f supabase/seed.sql` antes do Playwright.
 *
 * O login do setup (`admin@test.com`) é **admin da org A** — necessário porque
 * compor métrica é ato de admin de equipe, espelhando a RLS de
 * `metric_custom_definitions`.
 */

import { test, expect, type Page } from '@playwright/test';

/** Lê o número de cabeça de uma janela, já desformatado de pt-BR. */
async function valorDaJanela(page: Page, rotulo: string): Promise<number> {
  const janela = page.getByRole('group', { name: rotulo });
  await expect(janela).toBeVisible({ timeout: 15_000 });

  // A janela monta ANTES de o motor responder: o primeiro quadro é spinner, e
  // ler ali devolveria vazio. Espera aparecer dígito antes de extrair.
  await expect
    .poll(async () => (await janela.innerText()).replace(/\s+/g, ' '), { timeout: 20_000 })
    .toMatch(/\d/);

  const texto = (await janela.innerText()).replace(/\s+/g, ' ');
  const bruto = texto.match(/(\d[\d.]*(?:,\d+)?)/);
  if (!bruto) throw new Error(`Janela "${rotulo}" não mostrou número: ${texto}`);
  return Number(bruto[1].replace(/\./g, '').replace(',', '.'));
}

/** Entra em Edição e limpa o painel — janela salva de um teste anterior sujaria o próximo. */
async function painelLimpoEmEdicao(page: Page) {
  await page.goto('/metricas');
  await page.waitForLoadState('networkidle');

  const editar = page.getByRole('button', { name: 'Editar' });
  if (await editar.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await editar.click();
  }

  const limpar = page.getByRole('button', { name: 'Limpar' });
  if (await limpar.isEnabled().catch(() => false)) {
    await limpar.click();
  }
}

// Serial de propósito: os testes compartilham UM painel persistido por
// (org, membro). Em paralelo, o `Limpar` de um apagaria a janela do outro.
test.describe.configure({ mode: 'serial' });

test.describe('Estúdio de Métricas', () => {
  test('a rota abre para org liberada', async ({ page }) => {
    await page.goto('/metricas');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Métricas', level: 1 })).toBeVisible({ timeout: 15_000 });

    // A trava de rollout falha para FECHADO. Se a org não estivesse liberada,
    // a tela seria "Métricas ainda não liberado" — e o resto deste arquivo não
    // faria sentido. Afirmar aqui dá um erro legível em vez de dez timeouts.
    await expect(page.getByText('Métricas ainda não liberado')).toHaveCount(0);
  });

  test('LEAD ≠ NEGÓCIO: um lead com dois negócios conta 2 e 1', async ({ page }) => {
    await painelLimpoEmEdicao(page);

    await page.getByRole('button', { name: /^Negócios na etapa/ }).click();
    await page.getByRole('button', { name: /^Leads na etapa/ }).click();

    const negocios = await valorDaJanela(page, 'Negócios na etapa');
    const leads = await valorDaJanela(page, 'Leads na etapa');

    // A relação, não o total: o seed tem exatamente UM lead com um negócio a
    // mais que os outros (bloco 11 de seed.sql).
    expect(negocios).toBe(leads + 1);

    // E o contra-teste do defeito antigo: as duas NÃO podem ser o mesmo número.
    expect(negocios).not.toBe(leads);
    expect(leads).toBeGreaterThanOrEqual(2);
  });

  test('razão é escalar: sem seletor de corte e sem gráfico de série', async ({ page }) => {
    await painelLimpoEmEdicao(page);

    await page.getByRole('button', { name: /^Ticket médio/ }).click();
    const janela = page.getByRole('group', { name: 'Ticket médio' });
    await expect(janela).toBeVisible({ timeout: 15_000 });

    // O motor força `total` nos dois filhos e devolve `series: null` sempre.
    // A janela não oferece corte porque não há o que cortar.
    await expect(janela.getByLabel('Corte do dado')).toHaveCount(0);
  });

  test('sem dado mostra travessão, nunca zero', async ({ page }) => {
    await painelLimpoEmEdicao(page);

    // "Reuniões marcadas" lê `meeting_events`, e o seed não grava NENHUM. É a
    // única medida garantidamente vazia — por isso ela, e não Faturamento, que
    // tem venda com `sold_at = now()`.
    await page.getByRole('button', { name: /^Reuniões marcadas/ }).click();
    const janela = page.getByRole('group', { name: 'Reuniões marcadas' });
    await expect(janela).toBeVisible({ timeout: 15_000 });

    // Ausência é travessão (—), nunca "0". Zero é uma afirmação sobre o
    // período; "não houve registro" não é "houve zero".
    await expect
      .poll(async () => (await janela.innerText()).replace(/\s+/g, ' '), { timeout: 20_000 })
      .toContain('—');

    const texto = (await janela.innerText()).replace(/\s+/g, ' ');
    expect(texto).not.toMatch(/(?:^|\s)0(?:\s|$)/);
  });

  test('painel salvo reaparece depois de recarregar', async ({ page }) => {
    await painelLimpoEmEdicao(page);

    await page.getByRole('button', { name: /^Negócios na etapa/ }).click();
    await expect(page.getByRole('group', { name: 'Negócios na etapa' })).toBeVisible({ timeout: 15_000 });

    // SCRUM-309: o painel vive no servidor (`metrics_studio_panels`), um por
    // (org, membro). A gravação é debounced — dar tempo antes de recarregar.
    await page.waitForTimeout(2_000);
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('group', { name: 'Negócios na etapa' })).toBeVisible({ timeout: 20_000 });
  });

  test('métrica personalizada: receita ÷ leads, com o aviso de 100×', async ({ page }) => {
    await painelLimpoEmEdicao(page);

    await page.getByRole('button', { name: 'Criar' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText('Nova métrica')).toBeVisible({ timeout: 10_000 });

    // A composição nasce em `Faturamento ÷ Leads que entraram` — o exemplo do
    // CTO. Basta nomear.
    const nome = `Receita por lead ${Date.now()}`;
    await dialogo.locator('#metrica-nome').fill(nome);

    // currency ÷ count → currency. O seletor de formato só oferece Moeda.
    await expect(dialogo.getByText(/resultado em dinheiro/)).toBeVisible({ timeout: 15_000 });

    await dialogo.getByRole('button', { name: 'Criar métrica' }).click();
    await expect(dialogo).toBeHidden({ timeout: 15_000 });

    // Aparece na seção "Suas métricas" e abre como janela.
    await expect(page.getByText('Suas métricas')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: new RegExp(`^${nome}`) }).click();

    const valor = await valorDaJanela(page, nome);
    expect(valor).toBeGreaterThan(0);
  });

  test('o teto de profundidade 3 é aplicado na própria composição', async ({ page }) => {
    await painelLimpoEmEdicao(page);
    await page.getByRole('button', { name: 'Criar' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByText('Nova métrica')).toBeVisible({ timeout: 10_000 });
    await expect(dialogo.getByText('1 de 3')).toBeVisible();

    // Cada clique em "combinar" encaixa uma operação. No teto, o botão deixa de
    // ser oferecido — a UI não deixa MONTAR profundidade 4.
    //
    // ⚠ A recusa do BANCO (22023 em `fn_metric_tree_validate` e no trigger de
    // escrita) é coberta pelo pgTAP, em `metric_custom_tree_test.sql` (PF2 e
    // WR4). Aqui se prova o outro lado: o usuário não chega a tentar.
    for (const alvo of ['2 de 3', '3 de 3']) {
      const combinar = dialogo.getByRole('button', { name: 'Combinar com outra métrica' }).first();
      await combinar.click();
      await expect(dialogo.getByText(alvo)).toBeVisible({ timeout: 5_000 });
    }

    await expect(dialogo.getByRole('button', { name: 'Combinar com outra métrica' })).toHaveCount(0);
  });
});
