import { test, expect, type Page } from '@playwright/test';

async function openGuidedEditor(page: Page) {
  await page.addInitScript(() => {
    const user = { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'editor@example.test' };
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user.id, exp: expires }))}.test`;
    localStorage.setItem('sb-guided-condition-test-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_at: expires, expires_in: 3600, user,
    }));
  });
  await page.route('**/rest/v1/master_users?*', route => route.fulfill({ json: null }));
  await page.route('**/rest/v1/gestores?*', route => route.fulfill({ json: null }));
  await page.route('**/functions/v1/attach-to-org-by-pending-invite', route => route.fulfill({ json: { attached: false } }));
  await page.route('**/rest/v1/team_members?*', route => route.fulfill({ json: { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin', is_active: true } }));
  await page.route('**/rest/v1/organizations?*', route => route.fulfill({ json: { id: 'org-1', org_type: 'crm', timezone: 'America/Sao_Paulo', feature_flags: {} } }));
  await page.route('**/rest/v1/workflows?*', route => route.fulfill({ json: {
    id: 'workflow-1', name: 'Qualificar lead', is_active: false,
    definition: { nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 400, y: 50 }, data: { type: 'trigger', label: 'Entrada', triggerType: 'lead_created', config: {} } },
      { id: 'condition-1', type: 'condition', position: { x: 400, y: 220 }, data: {
        type: 'condition', label: 'Nome informado', field: '', operator: 'equals', value: '',
        guidedCondition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
      } },
    ], edges: [] },
  } }));
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().organizationId).toBe('org-1');
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'José' }] } });
  });
  await page.goto('/tests/browser/fixtures/guided-editor.html');
}

test('cria condição pelo editor com seletores no ambiente de desenvolvimento', async ({ page }) => {
  await openGuidedEditor(page);
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar Nó' }).click();
  await page.getByRole('menuitem', { name: 'Condição', exact: true }).click();
  await expect(page.getByLabel('Informação', { exact: true })).toHaveValue('lead.name');
  await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue('equals');
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('');
});

test('explica por que rascunho guiado ainda não pode ser ativado', async ({ page }) => {
  await openGuidedEditor(page);
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Inativo' }).click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText(/falta publicação autorizada da condição/)).toBeVisible();
});

test('administrador aprova escopo explícito e pode revogar pelo editor', async ({ page }) => {
  let grant: { workflow_id: string; organization_id: string; fields: string[]; revision: number; resource_scope: string } | null = null;
  await page.route('**/rest/v1/workflow_data_grants?*', route => route.fulfill({ json: grant }));
  await page.route('**/rest/v1/rpc/set_workflow_data_grant', route => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ p_workflow_id: 'workflow-1', p_fields: grant ? [] : ['lead.name'], p_expected_revision: grant?.revision ?? 0 });
    grant = { workflow_id: 'workflow-1', organization_id: 'org-1', fields: body.p_fields,
      revision: (grant?.revision ?? 0) + 1, resource_scope: 'organization_leads' };
    return route.fulfill({ json: grant });
  });
  await openGuidedEditor(page);
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByText('Nome de todos os leads desta organização')).toBeVisible();
  await page.getByRole('button', { name: 'Autorizar acesso ao nome dos leads' }).click({ timeout: 4000 });
  await expect(page.getByText('Acesso autorizado pela organização')).toBeVisible();
  await page.getByRole('button', { name: 'Revogar acesso' }).click();
  await expect(page.getByRole('button', { name: 'Autorizar acesso ao nome dos leads' })).toBeVisible();
});

test('abre condição salva no editor e testa usando organização da sessão', async ({ page }) => {
  await openGuidedEditor(page);
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('JOSE');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1', { timeout: 4000 });
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('José');
});

test('distingue busca sem resultados de falha de carregamento', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [] }));
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await expect(page.getByText('Nenhum lead encontrado. Tente outro nome.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
});

test('busca lead fora da lista inicial sem carregar cadastro inteiro', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => {
    const search = new URL(route.request().url()).searchParams.get('name');
    return route.fulfill({ json: search === 'ilike.%Mariana%' ? [{ id: 'lead-26', name: 'Mariana' }] : [] });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Buscar lead').fill('Mariana', { timeout: 4000 });
  await expect(page.getByRole('option', { name: 'Mariana', exact: true })).toBeAttached();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-26');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeEnabled();
});

test('explica acesso negado sem mostrar resultado comercial', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({ status: 403, json: { status: 'error', code: 'access_denied' } }));
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('alert')).toHaveText('Você não tem acesso aos dados necessários para este teste.');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('operador vazio dispensa texto e mantém foco utilizável pelo teclado', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'Lead sem nome' }] }));
  await page.route('**/functions/v1/test-guided-condition', async route => {
    expect(route.request().postDataJSON().condition).toEqual({ version: 1, id: 'rule-1', field: 'lead.name', operator: 'is_empty' });
    await route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: null }] } });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty', { timeout: 4000 });
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  const lead = page.getByRole('combobox', { name: 'Lead para testar' });
  await lead.selectOption('lead-1');
  await lead.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Vazio');
});

test('configura nome por seletores e explica teste sem executar ações', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', async route => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ organizationId: 'org-1', leadId: 'lead-1', condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' } });
    await route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'José' }] } });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('JOSE');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Sim');
  await expect(page.getByRole('status')).toContainText('José');
  await page.getByLabel('Valor da comparação').fill('Maria');
  await expect(page.getByRole('status')).toHaveCount(0);
});
