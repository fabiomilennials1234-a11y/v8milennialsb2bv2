// QA autenticado e descartável. Chamado SÓ pelo lifecycle do ensaio, que exclui
// o projeto mesmo quando este teste falha. Chaves ficam em memória, fora do log.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = 'jsjsmuncfkbsbzqzqhfq';
const org = '11111111-1111-4111-8111-111111111111';
const exec = promisify(execFile);

export async function verifyStudioUI({ ref, token, api }) {
  const inventory = await api(`projects/${parent}/branches`);
  const owned = inventory.find((b) => b.project_ref === ref && b.name.startsWith('qa-studio-') && !b.is_default);
  if (!owned || !/^[a-f0-9-]{36}$/.test(owned.id) || [parent, 'bcfadphgsibjzivtbjvc'].includes(ref) || !/^[a-z]{20}$/.test(ref)) throw new Error('UI QA exige preview própria');
  const cli = async (args) => {
    try {
      return (await exec('npx.cmd', ['--yes', 'supabase', ...args], {
        cwd: root, env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        shell: true, windowsHide: true, timeout: 180_000, maxBuffer: 4_000_000,
      })).stdout;
    } catch { throw new Error('CLI de preview falhou: ' + args.slice(0, 3).join(' ')); }
  };
  const raw = await cli(['branches', 'get', owned.id, '--project-ref', parent, '-o', 'env']);
  const vars = Object.fromEntries(raw.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    return match ? [[match[1], match[2].trim().replace(/^["']|["']$/g, '')]] : [];
  }));
  const url = vars.SUPABASE_URL;
  const anon = vars.SUPABASE_ANON_KEY ?? vars.SUPABASE_DEFAULT_KEY;
  const service = vars.SUPABASE_SERVICE_ROLE_KEY;
  if (url !== `https://${ref}.supabase.co` || !anon || !service) throw new Error('Credenciais da preview incompletas; não iniciar interface');
  const sql = (query) => api(`projects/${ref}/database/query`, 'POST', { query });
  // Metadados de produto apenas: nenhuma conta, lead ou segredo sai de prod.
  const plans = await api(`projects/${parent}/database/query`, 'POST', {
    query: "SELECT name, display_name, features, limits FROM public.subscription_plans WHERE name = 'torque-v8'",
  });
  if (plans.length !== 1) throw new Error('Plano de referência indisponível');
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const plan = await admin.from('subscription_plans').upsert(plans[0], { onConflict: 'name' });
  if (plan.error) throw new Error('Seed do plano: ' + plan.error.message);
  await sql(`UPDATE public.organizations SET subscription_status='active', subscription_plan='torque-v8' WHERE id='${org}'`);
  const email = 'studio-ui-' + randomUUID() + '@example.test';
  const password = randomUUID() + '!Qa9';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Auth Admin: ' + created.error?.message);
  const userId = created.data.user.id;
  if (!/^[a-f0-9-]{36}$/.test(userId)) throw new Error('UUID de fixture inválido');
  await sql(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
    INSERT INTO public.team_members(user_id,name,role,organization_id) VALUES('${userId}','Studio UI QA','admin','${org}')`);
  for (const fn of ['get-member-permissions', 'attach-to-org-by-pending-invite']) {
    await cli(['functions', 'deploy', fn, '--project-ref', ref]);
    console.log('UI QA: função de boot implantada: ' + fn);
  }
  process.env.VITE_SUPABASE_URL = url;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = anon;
  process.env.VITE_SUPABASE_PROJECT_ID = ref;
  process.env.NODE_ENV = 'development';
  const server = await createServer({
    root, configFile: resolve(root, 'vite.config.ts'),
    server: { host: 'localhost', port: 8091, strictPort: true, open: false },
  });
  let browser;
  let page;
  const failures = [];
  const output = resolve(root, 'test-results/studio-ui');
  const capture = async (file) => {
    // Espera as entradas CSS/Web Animations finitas. Uma moldura visível não
    // prova que o corpo terminou de sair de opacity:0; pulses infinitos não bloqueiam.
    await page.evaluate(async () => {
      const entries = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.allSettled(entries.map((animation) => animation.finished));
    });
    await page.screenshot({ path: resolve(output, file), fullPage: true, animations: 'disabled' });
  };
  await mkdir(output, { recursive: true });
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // Mesmo um .env local inesperado não pode permitir tráfego para outro banco.
    await context.route('**/*.supabase.co/**', (route) => {
      if (new URL(route.request().url()).hostname !== `${ref}.supabase.co`) return route.abort('blockedbyclient');
      return route.continue();
    });
    page = await context.newPage();
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes(ref)) {
        const path = new URL(response.url()).pathname;
        console.log('UI QA HTTP: ' + response.status() + ' ' + path);
      }
    });
    page.setDefaultTimeout(20_000);
    await page.goto('http://localhost:8091/auth', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await expect(page.locator('input#email')).toBeVisible({ timeout: 90_000 });
    await page.locator('input#email').fill(email);
    await page.locator('input#password').fill(password);
    await page.getByRole('button', { name: /entrar|login|sign in/i }).click();
    await page.waitForURL(/\/(dashboard|leads|follow-ups|$)/, { timeout: 45_000 });
    await page.goto('http://localhost:8091/metricas');
    // A fixture é um usuário novo: fechar os dois anúncios reais, sem remover
    // overlays via DOM nem desabilitar proteções de acesso do produto.
    await page.getByRole('button', { name: 'Agora não', exact: true }).click();
    await page.getByRole('button', { name: 'Explorar depois', exact: true }).click();
    await page.getByRole('button', { name: 'Entendi', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Estúdio de Métricas', exact: true })).toBeVisible({ timeout: 60_000 });
    for (const title of ['Visão Geral', 'Performance', 'Saúde', 'Mapa']) {
      await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Visão Geral', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Indicadores da operação', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('#studio-panel .animate-pulse').count(), { timeout: 45_000 }).toBe(0);
    await expect(page.getByRole('group', { name: 'Indicadores da operação', exact: true }).getByRole('button', { name: /^Leads:/ })).toBeVisible();
    await capture('01-visao-geral.png');
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByRole('button', { name: 'Nova aba', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Visão Geral', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Visão Geral', exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: 'Opções da aba Visão Geral', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
    await page.getByLabel('Nome da aba').fill('Cópia QA');
    await page.getByRole('button', { name: 'Salvar nome', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Cópia QA', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Opções da aba Cópia QA', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Mover para a esquerda', exact: true }).click();
    await expect.poll(async () => {
      const { data } = await admin.from('metrics_studio_panels').select('nome').eq('organization_id', org).order('ordem');
      return data?.map((p) => p.nome).slice(-2);
    }).toEqual(['Cópia QA', 'Mapa']);
    await page.getByRole('button', { name: 'Limpar aba', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Limpar aba', exact: true }).click();
    await expect(page.getByText('Painel em branco', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const { data } = await admin.from('metrics_studio_panels').select('layout').eq('organization_id', org).eq('nome', 'Cópia QA').single();
      return data?.layout;
    }).toEqual([]);
    await page.getByRole('button', { name: 'Opções da aba Cópia QA', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Excluir aba', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir aba', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Cópia QA', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Concluir edição', exact: true }).click();
    for (const [index, title] of ['Visão Geral', 'Performance', 'Saúde', 'Mapa'].entries()) {
      await page.getByRole('tab', { name: title, exact: true }).click();
      await expect(page.locator('#studio-panel [role="group"]')).toHaveCount([6, 8, 1, 1][index]);
      await expect.poll(() => page.locator('#studio-panel .animate-pulse').count(), { timeout: 45_000 }).toBe(0);
      await capture(`02-${index}-template.png`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Visão Geral', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Indicadores da operação', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('#studio-panel .animate-pulse').count(), { timeout: 45_000 }).toBe(0);
    await capture('03-mobile.png');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('http://localhost:8091/dashboard');
    await expect(page.getByRole('heading', { name: 'Comando', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Central de trabalho da equipe', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.animate-pulse').count(), { timeout: 45_000 }).toBe(0);
    await expect(page.getByRole('tab', { name: 'Visão Geral', exact: true })).toHaveCount(0);
    await capture('04-comando.png');
    expect(failures).toEqual([]);
    console.log('UI QA PASS: login real, quatro templates, cópia/renomeação/ordenação/limpeza/exclusão persistidas, mobile sem overflow e Comando sem dashboards.');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
      console.log('UI QA estado: ' + (await page.locator('body').innerText().catch(() => '')).slice(0, 7000));
    }
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
}
