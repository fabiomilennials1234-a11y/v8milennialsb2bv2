/** Authenticated verification against an explicitly disposable Supabase branch.
 * Reads credentials from a mode-0600 temporary fixture file; never logs tokens.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
const fixturePath = process.env.PORTFOLIO_QA_FIXTURE;
if (!fixturePath) throw new Error('PORTFOLIO_QA_FIXTURE required');
const f = JSON.parse(readFileSync(fixturePath));
if (f.ref !== process.env.PORTFOLIO_QA_REF || !/^[a-z]{20}$/.test(f.ref) || ['jsjsmuncfkbsbzqzqhfq','bcfadphgsibjzivtbjvc'].includes(f.ref)) throw new Error('Disposable preview target required');
const url = `https://${f.ref}.supabase.co`;
const client = () => createClient(url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const qa = client();
async function login(c, user) {
  const r = await c.auth.signInWithPassword({ email: `portfolio-${user}@example.test`, password: f.password });
  if (r.error) throw new Error(`QA login: ${r.error.message}`);
  return r.data.session;
}
const session = await login(qa, f.admin);
const response = await qa.rpc('client_portfolio_page', { p_organization_id: f.org, p_filters: { search: 'Aurora QA' } });
assert.equal(response.error, null, JSON.stringify(response.error));
assert.ok(response.data.clients.some(c => c.id === f.lead));
const own = response.data.clients.find(c => c.id === f.lead);
assert.equal(own.cycle.mediaDias,28);assert.equal(own.cycle.diasRestantes,-5);
assert.equal(own.metrics.segment,'ouro');
const foreign = await qa.rpc('client_portfolio_page', { p_organization_id: f.otherOrg });
assert.equal(foreign.error,null);assert.equal(foreign.data.total,0);
const anon = await client().rpc('client_portfolio_page', { p_organization_id: f.org });
assert.ok(anon.error);
const member = client();await login(member,f.member);
const assigned = await member.rpc('client_portfolio_page', { p_organization_id: f.org });
assert.equal(assigned.error,null,JSON.stringify(assigned.error));
assert.ok(assigned.data.clients.some(c=>c.id===f.lead));
assert.ok(!assigned.data.clients.some(c=>c.id===f.hiddenLead));
const globalPage = await qa.rpc('client_portfolio_page', { p_organization_id: f.org });
const secondPage = await qa.rpc('client_portfolio_page', { p_organization_id: f.org, p_offset: 50 });
assert.equal(globalPage.error,null);assert.equal(secondPage.error,null);
assert.equal(globalPage.data.total,55);assert.equal(globalPage.data.clients.length,50);assert.equal(secondPage.data.clients.length,5);
assert.equal(new Set([...globalPage.data.clients,...secondPage.data.clients].map(c=>c.id)).size,55);
assert.equal(globalPage.data.summary.monthlyRevenue,530);
assert.deepEqual(globalPage.data.summary,secondPage.data.summary);
assert.equal(assigned.data.summary.monthlyRevenue,0);
const gold = await qa.rpc('client_portfolio_page', { p_organization_id: f.org, p_filters: { segment:'ouro' } });
assert.equal(gold.data.total,1);assert.equal(gold.data.clients[0].id,f.lead);
console.log('PASS PostgREST: auth, anonymous denial, tenant isolation, assignment, cycle, tier.');
writeFileSync('.specs/assets/clientes-360/homologacao/postgrest.json',JSON.stringify({ref:f.ref,checks:['real-auth','anonymous-denied','tenant-isolation','assignment-isolation','cycle-28-days','overdue-5-days','gold-tier','global-filter','pagination-50-plus-5','stable-global-summary','member-revenue-isolation'],clientCount:globalPage.data.total,cycle:own.cycle,summary:globalPage.data.summary},null,2));
if (process.argv.includes('--api-only')) process.exit(0);
const browser = await chromium.launch({ channel:'chrome',headless:true });
let page;
try {
  const context = await browser.newContext({viewport:{width:1680,height:1050},reducedMotion:'reduce'});
  page = await context.newPage();
  // Session is real GoTrue authentication; UI keeps its normal auth/RLS path.
  await context.addInitScript(({key,session}) => localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${f.ref}-auth-token`,session});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto('http://127.0.0.1:5287/leads');
  const group = page.getByRole('group', { name: 'Classificação dos leads' });
  await page.locator('[aria-label="Classificação dos leads"]').waitFor({timeout:45000});
  await page.waitForTimeout(1500);
  console.log('Initial dialogs:',await page.getByRole('dialog').allTextContents());
  await page.screenshot({path:'.specs/assets/clientes-360/homologacao/dialogs-iniciais.png',fullPage:true});
  const dismissSupport = page.getByRole('button', { name: 'Agora não', exact: true });
  if (await dismissSupport.isVisible()) await dismissSupport.click();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const launchDismiss=page.getByRole('button',{name:'Explorar depois',exact:true});
  if(await launchDismiss.isVisible()) await launchDismiss.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await group.getByRole('button', { name: /^Clientes/ }).click({timeout:10000});
  await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Aurora QA');
  const panel=page.getByRole('complementary', {name:'Cliente 360: Aurora Distribuidora QA'});
  await expect(panel).toBeVisible({timeout:20000});
  await expect(panel.getByText('Recompra atrasada',{exact:true})).toBeVisible();
  const row=page.getByRole('button',{name:'Ver 360 de Aurora Distribuidora QA'}).locator('xpath=ancestor::tr');
  await expect(row.getByRole('cell').nth(4)).toContainText('11 set');
  await panel.getByRole('button', {name:'Ver todas'}).click();
  await expect(page.getByRole('dialog',{name:'Compras de Aurora Distribuidora QA'})).toBeVisible();
  await page.keyboard.press('Escape');
  if (!process.argv.includes('--read-only-ui')) {
  const before=await qa.from('pipeline_entries').select('id',{count:'exact',head:true}).eq('lead_id',f.lead).eq('organization_id',f.org);
  assert.equal(before.error,null);
  await panel.getByRole('button',{name:'Novo negócio',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Novo negócio',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio',{name:'Funil de Vendas',exact:true}).click();
  await expect(dialog.getByTestId('new-deal-submit')).toBeEnabled({timeout:20000});
  await dialog.getByTestId('new-deal-submit').click();
  await expect(dialog).not.toBeVisible({timeout:20000});
  await expect.poll(async()=>{
    const r=await qa.from('pipeline_entries').select('id',{count:'exact',head:true}).eq('lead_id',f.lead).eq('organization_id',f.org);
    if(r.error)throw r.error;return r.count;
  },{timeout:15000}).toBe((before.count??0)+1);
  const after=await qa.rpc('client_portfolio_page',{p_organization_id:f.org});
  assert.equal(after.data.total,55);
  }
  await page.reload();
  await expect(page.getByRole('complementary',{name:'Cliente 360: Aurora Distribuidora QA'})).toBeVisible({timeout:20000});
  await expect(page.locator('[data-torque-loader]')).toHaveCount(0,{timeout:20000});
  await expect(page.getByRole('complementary',{name:'Cliente 360: Aurora Distribuidora QA'})).toBeVisible();
  const nudge=page.getByRole('button',{name:'Agora não',exact:true});
  if(await nudge.isVisible()) await nudge.click();
  await page.screenshot({path:'.specs/assets/clientes-360/homologacao/carteira-autenticada.png',fullPage:true});
  console.log(process.argv.includes('--read-only-ui') ? 'PASS UI: carteira, 360, histórico e reload após restauração.' : 'PASS UI: carteira, 360, histórico, criação persistida no mesmo lead, cliente preservado e reload.');
  assert.deepEqual(failures,[]);
} catch (error) {
  if (page) {
    console.error('UI failure state:', (await page.locator('body').innerText()).slice(-16000));
    await page.screenshot({path:'.specs/assets/clientes-360/homologacao/falha.png',fullPage:true});
  }
  throw error;
} finally { await browser.close(); }
