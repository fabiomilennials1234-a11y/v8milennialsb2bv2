// Real UI over the local fake Supabase. Run the mock with --master and start-vite first.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchBrowser, prepareContext } from './browser-session.mjs';

const out = '.ui-shots/master-tasks';
await mkdir(out, { recursive: true });
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.request.get('http://127.0.0.1:54399/__reset');
  const health = await (await context.request.get('http://127.0.0.1:54399/__health')).json();
  await prepareContext(context, { theme: 'light', master: true, now: health.now });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:4180/master/tarefas');
  const owner = page.getByRole('combobox', { name: 'Tarefas de' });
  await owner.getByText('Gabriel (você)', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole('heading', { name: 'Revisar fluxo de onboarding', exact: true }).waitFor();
  assert.equal(await page.getByText(/Atrasada/).count(), 1, 'Only the past-due unfinished task is overdue');
  await page.waitForTimeout(3500); // A abertura do shell termina antes da captura.
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  await owner.click();
  for (const name of ['Gabriel (você)', 'Marcelo', 'Lucas']) assert.equal(await page.getByRole('option', { name, exact: true }).count(), 1);
  await page.screenshot({ path: `${out}/owners.png`, fullPage: true });
  await page.getByRole('option', { name: 'Lucas', exact: true }).click();
  await page.getByRole('heading', { name: 'Preparar checklist de implantação', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Revisar fluxo de onboarding', exact: true }).count(), 0);

  const title = `Validar quadro master ${Date.now()}`;
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  assert.match(await page.getByRole('combobox', { name: 'Responsável', exact: true }).innerText(), /Lucas/);
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Descrição', { exact: true }).fill('Conferir os acessos com a equipe.');
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await page.getByRole('alert').getByText('Informe uma data limite válida.', { exact: true }).waitFor();
  await page.getByLabel('Data limite', { exact: true }).fill('2026-11-05');
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await page.getByRole('alert').getByText('Informe o tempo estimado para concluir a tarefa.', { exact: true }).waitFor();
  await page.getByLabel('Horas', { exact: true }).fill('2');
  await page.getByLabel('Minutos', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: title, exact: true }).waitFor();

  // Arrasto real com MouseSensor, independente da edição pelo select.
  const card = page.getByRole('button', { name: new RegExp(title) });
  const source = await card.boundingBox();
  const destination = await page.getByRole('region', { name: 'Fazendo, 0 itens', exact: true }).boundingBox();
  assert.ok(source && destination);
  await page.mouse.move(source.x + source.width / 2, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + 20, { steps: 3 });
  await page.mouse.move(destination.x + destination.width / 2, destination.y + 85, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('region', { name: 'Fazendo, 1 item', exact: true }).getByRole('heading', { name: title, exact: true }).waitFor();

  await page.getByRole('region', { name: 'Fazendo, 1 item', exact: true }).getByRole('heading', { name: title, exact: true }).click();
  assert.equal(await page.getByLabel('Descrição', { exact: true }).inputValue(), 'Conferir os acessos com a equipe.');
  assert.equal(await page.getByLabel('Data limite', { exact: true }).inputValue(), '2026-11-05');
  assert.equal(await page.getByLabel('Horas', { exact: true }).inputValue(), '2');
  assert.equal(await page.getByLabel('Minutos', { exact: true }).inputValue(), '30');
  await page.getByLabel('Data limite', { exact: true }).fill('2026-11-06');
  await page.getByLabel('Horas', { exact: true }).fill('3');
  await page.waitForTimeout(700); // Aguarda a gaveta terminar de entrar antes da captura.
  await page.screenshot({ path: `${out}/desktop-editor.png`, fullPage: true });
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Feito', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('region', { name: 'Feito, 2 itens', exact: true }).getByRole('heading', { name: title, exact: true }).waitFor();

  await page.reload();
  await owner.getByText('Gabriel (você)', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: title, exact: true }).count(), 0);
  await owner.click();
  await page.getByRole('option', { name: 'Lucas', exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.getByRole('heading', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Pegar para mim', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await owner.getByText('Gabriel (você)', { exact: true }).waitFor();
  await page.getByRole('heading', { name: title, exact: true }).click();
  assert.match(await page.getByRole('combobox', { name: 'Status', exact: true }).innerText(), /Feito/);
  assert.equal(await page.getByLabel('Descrição', { exact: true }).inputValue(), 'Conferir os acessos com a equipe.');
  assert.equal(await page.getByLabel('Data limite', { exact: true }).inputValue(), '2026-11-06');
  assert.equal(await page.getByLabel('Horas', { exact: true }).inputValue(), '3');
  assert.equal(await page.getByLabel('Minutos', { exact: true }).inputValue(), '30');
  await page.getByRole('combobox', { name: 'Responsável', exact: true }).click();
  await page.getByRole('option', { name: 'Marcelo', exact: true }).click();
  await page.getByRole('button', { name: 'Encaminhar tarefa', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await owner.getByText('Marcelo', { exact: true }).waitFor();
  assert.match(await card.innerText(), /Até 06\/11\/2026/);
  assert.match(await card.innerText(), /Estimativa: 3h 30min/);
  await page.getByRole('heading', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir tarefa', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'hidden' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700); // Fecha a animação da gaveta antes de conferir o layout.
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'No page-wide overflow at 390px');
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Revisão em tela pequena');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/mobile-editor.png`, fullPage: true });
  await page.getByLabel('Data limite', { exact: true }).fill('2026-11-07');
  await page.getByLabel('Minutos', { exact: true }).fill('45');
  assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth > el.clientWidth), false, 'No editor overflow at 390px');
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Revisão em tela pequena', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: default owner, three owners, required deadline and estimate, create, drag, edit, persistence, take, forward, delete, mobile.');
} finally {
  await browser.close();
}
