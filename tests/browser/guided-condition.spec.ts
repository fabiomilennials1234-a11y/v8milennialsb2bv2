import { test, expect, type Page } from '@playwright/test';

test('troca de usuário remove seleção e resultado pessoal da conta anterior', async ({ page }) => {
  let reads = 0;
  await page.route('**/rest/v1/leads?*', route => ++reads === 1
    ? route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] })
    : route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }));
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({ json: {
    status: 'evaluated', matched: true, rules: [{ id: 'rule-1', matched: true, actual: 'José' }],
  } }));
  await page.goto('/tests/browser/fixtures/guided-condition.html?identity-switch=1');
  await page.getByLabel('Valor da comparação').fill('JOSE');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('José');
  await page.getByRole('button', { name: 'Trocar usuário' }).click();
  await expect(page.getByRole('option', { name: 'José', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
});

async function openGuidedEditor(page: Page, draftValue?: string, isNew = false, omitDraftTrigger = false, draftSettings?: Record<string, unknown>, liveActive = false, publishedVersion?: string | { unavailable: true }) {
  await page.route('**/rest/v1/workflow_guided_publications?*', route => typeof publishedVersion === 'object'
    ? route.fulfill({ status: 503, json: { message: 'unavailable' } })
    : route.fulfill({ json: publishedVersion ? { version_id: publishedVersion } : null }));
  await page.route('**/rest/v1/workflow_guided_drafts?*', route => route.fulfill({ json: draftValue === undefined ? null : {
    revision: 3, settings: draftSettings, definition: { nodes: [
      ...(!omitDraftTrigger ? [{ id: 'trigger-1', type: 'trigger', position: { x: 400, y: 50 }, data: { type: 'trigger', label: 'Entrada', triggerType: 'lead_created', config: {} } }] : []),
      { id: 'condition-1', type: 'condition', position: { x: 400, y: 220 }, data: { type: 'condition', label: 'Nome informado',
        guidedCondition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: draftValue } } },
    ], edges: [] },
  } }));
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
    id: 'workflow-1', name: 'Qualificar lead', is_active: liveActive,
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
  await page.goto(`/tests/browser/fixtures/guided-editor.html${isNew ? '?new=1' : ''}`);
}

test('nova automação guiada cria rascunho separado sem enviar definição ao cadastro ativo', async ({ page }) => {
  let created: Record<string, unknown> | undefined;
  const directWrites: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/rest/v1/workflows')) directWrites.push(request.url());
  });
  await page.route('**/rest/v1/rpc/create_guided_workflow_draft_with_settings', route => {
    created = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: created!.p_workflow_id, revision: 1 } });
  });
  await openGuidedEditor(page, undefined, true);
  await page.getByRole('button', { name: 'Adicionar Nó' }).click();
  await page.getByRole('menuitem', { name: 'Condição', exact: true }).click();
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.getByText('Rascunho criado. Publique quando estiver pronto.')).toBeVisible();
  expect(created).toMatchObject({ p_organization_id: 'org-1', p_settings: { name: 'Novo Workflow', re_enrollment_enabled: false },
    p_workflow_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    p_definition: { nodes: expect.arrayContaining([expect.objectContaining({ type: 'condition' })]) } });
  expect(directWrites).toEqual([]);
});

test('abre rascunho separado sem substituir sua edição pela definição publicada', async ({ page }) => {
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Mariana');
});

test('salva comparação incompleta em rascunho sem escrever na definição em execução', async ({ page }) => {
  const writes: string[] = [];
  let saved: Record<string, unknown> | undefined;
  page.on('request', request => {
    if (request.method() !== 'GET' && request.url().includes('/rest/v1/workflows')) writes.push(request.method());
  });
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A versão publicada permanece igual.')).toBeVisible();
  expect(saved).toMatchObject({ p_workflow_id: 'workflow-1', p_expected_revision: 3,
    p_definition: { nodes: expect.arrayContaining([expect.objectContaining({ id: 'condition-1',
      data: expect.objectContaining({ guidedCondition: expect.objectContaining({ value: '' }) }) })]) } });
  expect(writes).toEqual([]);
});

test('editor carrega nome e reinscrição do rascunho e salva junto das regras', async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await openGuidedEditor(page, 'Mariana', false, false, { name: 'Nome no rascunho',
    enrollment_criteria: { enabled: false, match_all: true, conditions: [] },
    re_enrollment_enabled: true, re_enrollment_cooldown_days: 7, re_enrollment_max_times: 4 });
  await expect(page.getByPlaceholder('Nome do workflow')).toHaveValue('Nome no rascunho');
  await page.getByPlaceholder('Nome do workflow').fill('Nome revisado');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A versão publicada permanece igual.')).toBeVisible();
  expect(saved).toMatchObject({ p_expected_revision: 3, p_settings: { name: 'Nome revisado',
    re_enrollment_enabled: true, re_enrollment_cooldown_days: 7, re_enrollment_max_times: 4 } });
});

test('rascunho guiado pode ser salvo durante reconstrução do gatilho', async ({ page }) => {
  let saved: { p_definition: { nodes: Array<{ type: string }> } } | undefined;
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await openGuidedEditor(page, 'Mariana', false, true);
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A versão publicada permanece igual.')).toBeVisible();
  expect(saved?.p_definition.nodes.map(node => node.type)).toEqual(['condition']);
});

test('trocar automação reinicia rascunho, seleção e revisão no editor', async ({ page }) => {
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('Edição local A');
  await page.route('**/rest/v1/workflow_guided_drafts?*', route => route.fulfill({ json: {
    revision: 9, settings: { name: 'Automação B' }, definition: { nodes: [
      { id: 'condition-b', type: 'condition', position: { x: 400, y: 220 }, data: { type: 'condition', label: 'Condição B',
        guidedCondition: { version: 1, id: 'rule-b', field: 'lead.name', operator: 'equals', value: 'Bruno' } } },
    ], edges: [] },
  } }));
  await page.getByRole('link', { name: 'Automação B' }).click();
  await expect(page.getByPlaceholder('Nome do workflow')).toHaveValue('Automação B');
  await expect(page.getByText('Nome informado', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await page.getByText('Condição B', { exact: true }).click();
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Bruno');
  let revision: number | undefined;
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    const request = route.request().postDataJSON();
    expect(request.p_workflow_id).toBe('workflow-2');
    revision = request.p_expected_revision;
    return route.fulfill({ json: { workflow_id: 'workflow-2', revision: 10 } });
  });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A versão publicada permanece igual.')).toBeVisible();
  expect(revision).toBe(9);
});

test('reabrir automação aguarda revisão atual em vez de restaurar cache antigo', async ({ page }) => {
  await openGuidedEditor(page, 'Mariana');
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Automação B' }).click();
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  let release!: () => void;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/workflow_guided_drafts?*', async route => {
    await responseGate;
    await route.fulfill({ json: { revision: 7, settings: { name: 'Revisão atual A' }, definition: { nodes: [], edges: [] } } });
  });
  await page.getByRole('link', { name: 'Automação A' }).click();
  try {
    await expect(page.getByPlaceholder('Nome do workflow')).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByPlaceholder('Nome do workflow')).toHaveValue('Revisão atual A');
  await expect(page.getByText('Nome informado', { exact: true })).toHaveCount(0);
});

test('automação indisponível não deixa editor carregando nem permite salvar', async ({ page }) => {
  await openGuidedEditor(page, 'Mariana');
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  await page.route('**/rest/v1/workflows?*', route => route.fulfill({ json: null }));
  await page.getByRole('link', { name: 'Automação B' }).click();
  await expect(page.getByRole('alert')).toContainText('Automação indisponível ou sem acesso.');
  await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toHaveCount(0);
  await expect(page.getByText('Nome informado', { exact: true })).toHaveCount(0);
});

test('falha ao carregar automação permite tentar novamente sem abrir editor vazio', async ({ page }) => {
  await openGuidedEditor(page, 'Mariana');
  await expect(page.getByText('Nome informado', { exact: true })).toBeVisible();
  await page.route('**/rest/v1/workflows?*', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }));
  await page.getByRole('link', { name: 'Automação B' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a automação.');
  await expect(page.getByPlaceholder('Nome do workflow')).toHaveCount(0);
  await page.unroute('**/rest/v1/workflows?*');
  await page.route('**/rest/v1/workflows?*', route => route.fulfill({ json: {
    id: 'workflow-2', name: 'Recuperada', is_active: false, definition: { nodes: [], edges: [] },
  } }));
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByPlaceholder('Nome do workflow')).toHaveValue('Recuperada');
});

test('rascunho incompleto pode mudar enquanto versão publicada continua ativa', async ({ page }) => {
  const liveWrites: string[] = [];
  let saves = 0;
  page.on('request', request => {
    if (request.method() === 'PATCH' && request.url().includes('/rest/v1/workflows')) liveWrites.push(request.url());
  });
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    saves++;
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await openGuidedEditor(page, 'Mariana', false, false, undefined, true);
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A versão publicada permanece igual.')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Ativo' })).toBeChecked();
  expect(saves).toBe(1);
  expect(liveWrites).toEqual([]);
});

test('conflito de rascunho preserva edição local e não tenta sobrescrever revisão alheia', async ({ page }) => {
  const revisions: number[] = [];
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    revisions.push(route.request().postDataJSON().p_expected_revision);
    return route.fulfill({ status: 409, json: { code: 'PT409', message: 'draft_revision_conflict' } });
  });
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('Ana');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Outra pessoa alterou este rascunho. Sua edição continua nesta tela; compare com a versão atual antes de salvar.')).toBeVisible();
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Ana');
  expect(revisions).toEqual([3]);
});

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

test('comparação incompleta orienta preenchimento antes de testar', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
  await expect(page.getByLabel('Valor da comparação')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Informe um valor ou escolha “está vazio”.')).toBeVisible();
  await page.getByLabel('Valor da comparação').fill('José');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeEnabled();
  await expect(page.getByText('Informe um valor ou escolha “está vazio”.')).toHaveCount(0);
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
  await page.getByLabel('Valor da comparação').fill('Mariana');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeEnabled();
});

test('explica acesso negado sem mostrar resultado comercial', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({ status: 403, json: { status: 'error', code: 'access_denied' } }));
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('JOSE');
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

test('publica a edição atual somente depois de salvar sua revisão', async ({ page }) => {
  const operations: string[] = [];
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    operations.push('save');
    expect(route.request().postDataJSON().p_definition.nodes[1].data.guidedCondition.value).toBe('Ana');
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await page.route('**/functions/v1/publish-guided-workflow', route => {
    operations.push('publish');
    expect(route.request().postDataJSON()).toEqual({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 4 });
    return route.fulfill({ json: { status: 'published', version_id: 'version-2', version_number: 2 } });
  });
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('Ana');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click({ timeout: 5000 });
  await expect(page.getByText('Versão 2 publicada.')).toBeVisible();
  expect(operations).toEqual(['save', 'publish']);
});

test('publicação recusada explica erro no node e preserva edição', async ({ page }) => {
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } }));
  await page.route('**/functions/v1/publish-guided-workflow', route => route.fulfill({ status: 422, json: {
    status: 'error', code: 'invalid_configuration', issues: [{ code: 'invalid_condition_outputs', nodeId: 'condition-1', message: 'Conecte as saídas Sim e Não uma vez cada.' }],
  } }));
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('Ana');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Conecte as saídas Sim e Não uma vez cada.' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Ana');
  await expect(page.getByRole('button', { name: 'Publicar', exact: true })).toBeEnabled();
});

test('conflito ao salvar impede publicação sem perder edição local', async ({ page }) => {
  const publications: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/functions/v1/publish-guided-workflow')) publications.push(request.url());
  });
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => route.fulfill({ status: 409, json: { code: 'PT409', message: 'draft_revision_conflict' } }));
  await openGuidedEditor(page, 'Mariana');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('Ana');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Outra pessoa alterou este rascunho. Sua edição continua nesta tela; compare com a versão atual antes de salvar.')).toBeVisible();
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Ana');
  expect(publications).toEqual([]);
});

test('ativa versão publicada pela API autorizada sem salvar rascunho', async ({ page }) => {
  let activation: unknown;
  await page.route('**/rest/v1/rpc/set_guided_workflow_active', route => {
    activation = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: 'workflow-1', version_id: 'version-2', is_active: true } });
  });
  await openGuidedEditor(page, 'Mariana', false, false, undefined, false, 'version-2');
  await page.getByRole('switch').click();
  await expect.poll(() => activation, { timeout: 5000 }).toEqual({ p_workflow_id: 'workflow-1', p_active: true, p_expected_version_id: 'version-2' });
  await expect(page.getByText('Automação ativada.')).toBeVisible();
});


test('permite desativar automação mesmo com publicação indisponível', async ({ page }) => {
  let request: unknown;
  await page.route('**/rest/v1/rpc/set_guided_workflow_active', route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: 'workflow-1', is_active: false, version_id: 'version-2' } });
  });
  await openGuidedEditor(page, 'Mariana', false, false, undefined, true, { unavailable: true });
  await expect(page.getByRole('switch')).toBeEnabled({ timeout: 5000 });
  await page.getByRole('switch').click();
  await expect(page.getByText('Automação desativada.')).toBeVisible();
  expect(request).toEqual({ p_workflow_id: 'workflow-1', p_active: false, p_expected_version_id: null });
  await expect(page.getByRole('switch')).not.toBeChecked();
});

test('permite recarregar publicação após falha sem perder rascunho', async ({ page }) => {
  await openGuidedEditor(page, 'Mariana', false, false, undefined, false, { unavailable: true });
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Valor da comparação').fill('Ana');
  await expect(page.getByText('Não foi possível consultar a versão publicada.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('switch')).toBeDisabled();
  await page.route('**/rest/v1/workflow_guided_publications?*', route => route.fulfill({ json: { version_id: 'version-2' } }));
  await page.getByRole('button', { name: 'Recarregar publicação' }).click();
  await expect(page.getByRole('switch')).toBeEnabled();
  await expect(page.getByText('Não foi possível consultar a versão publicada.')).toHaveCount(0);
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Ana');
});

test('combina duas regras com Qualquer e testa árvore completa', async ({ page }) => {
  let submitted: unknown;
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => {
    submitted = route.request().postDataJSON().condition;
    const children = route.request().postDataJSON().condition.children;
    return route.fulfill({ json: { status: 'evaluated', matched: true,
      rules: [{ id: children[0].id, status: 'evaluated', matched: true, actual: 'José' }, { id: children[1].id, status: 'not_evaluated' }],
      groups: [{ id: route.request().postDataJSON().condition.id, status: 'evaluated', matched: true }],
    } });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('José');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).click({ timeout: 5000 });
  await page.getByLabel('Combinação').selectOption('any');
  await page.getByLabel('Valor da comparação').nth(1).fill('Maria');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Não avaliada');
  expect(submitted).toMatchObject({ kind: 'group', match: 'any', children: [
    { field: 'lead.name', operator: 'equals', value: 'José' }, { field: 'lead.name', operator: 'equals', value: 'Maria' },
  ] });
});

test('limita grupos a três níveis sem impedir novas regras no terceiro', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await expect(page.getByRole('group', { name: 'Grupo de condições', exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Adicionar condição', exact: true }).first()).toBeDisabled({ timeout: 3000 });
  const deepest = page.getByRole('group', { name: 'Grupo de condições', exact: true }).last();
  await deepest.getByRole('button', { name: 'Adicionar condição', exact: true }).last().click();
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(5);
  await expect(page.getByLabel('Valor da comparação').nth(2)).toBeFocused();
  await expect(page.getByRole('group', { name: 'Grupo de condições', exact: true })).toHaveCount(3);
});

test('duplica grupo com valores independentes e identidades novas', async ({ page }) => {
  let submitted: { children: Array<{ id: string; children?: Array<{ id: string; value: string }> }> } | undefined;
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => {
    submitted = route.request().postDataJSON().condition;
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [] } });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('José');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await page.getByLabel('Valor da comparação').nth(1).fill('Maria');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await page.getByLabel('Valor da comparação').nth(1).fill('Ana');
  await page.getByRole('button', { name: 'Duplicar grupo', exact: true }).click({ timeout: 3000 });
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(5);
  await page.getByLabel('Valor da comparação').nth(2).fill('João');
  await expect(page.getByLabel('Valor da comparação').first()).toHaveValue('José');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted?.children[0].children?.map(rule => rule.value)).toEqual(['José', 'Ana']);
  expect(submitted?.children[1].children?.map(rule => rule.value)).toEqual(['João', 'Ana']);
  const ids = submitted!.children.flatMap(child => [child.id, ...(child.children?.map(rule => rule.id) ?? [])]);
  expect(new Set(ids).size).toBe(7);
});

test('exclui regras sem perder restantes e permite reconstruir grupo vazio pelo teclado', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('José');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).click();
  await page.getByLabel('Valor da comparação').nth(1).fill('Maria');
  await page.getByRole('button', { name: 'Excluir regra', exact: true }).first().click({ timeout: 3000 });
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('Maria');
  await expect(page.getByLabel('Combinação')).toBeFocused();
  await page.getByRole('button', { name: 'Excluir regra', exact: true }).click();
  await expect(page.getByText('Grupo vazio. Adicione uma condição.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Testar condição', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Valor da comparação')).toBeFocused();
});

test('recolhe grupo pelo teclado mantendo resumo e valores ao expandir', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('José');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).click();
  await page.getByLabel('Valor da comparação').nth(1).fill('Maria');
  await page.getByLabel('Combinação').selectOption('any');
  const toggle = page.getByRole('button', { name: 'Recolher grupo', exact: true });
  await toggle.focus({ timeout: 3000 });
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await expect(page.getByText('Qualquer: (Nome é igual a “José” OU Nome é igual a “Maria”)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expandir grupo', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Valor da comparação').first()).toHaveValue('José');
  await expect(page.getByLabel('Valor da comparação').nth(1)).toHaveValue('Maria');
});

test('canvas resume grupo guiado com combinação e valores atuais', async ({ page }) => {
  await openGuidedEditor(page, 'José');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).click();
  await page.getByLabel('Valor da comparação').nth(1).fill('Maria');
  await page.getByLabel('Combinação').selectOption('any');
  const node = page.locator('.react-flow__node-condition');
  await expect(node).toContainText('Qualquer: (Nome é igual a “José” OU Nome é igual a “Maria”)', { timeout: 3000 });
  await expect(node.getByTitle('Qualquer: (Nome é igual a “José” OU Nome é igual a “Maria”)')).toBeVisible();
});

test('resultado preserva hierarquia de grupos e distingue ramo não avaliado', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => {
    const root = route.request().postDataJSON().condition;
    const nested = root.children[0];
    return route.fulfill({ json: { status: 'evaluated', matched: true, groups: [
      { id: root.id, status: 'evaluated', matched: true }, { id: nested.id, status: 'evaluated', matched: true },
    ], rules: [
      { id: root.children[1].id, status: 'evaluated', matched: true, actual: 'José' },
      { id: nested.children[1].id, status: 'not_evaluated' },
      { id: nested.children[0].id, status: 'evaluated', matched: true, actual: 'José' },
    ] } });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('José');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await page.getByLabel('Valor da comparação').nth(1).fill('José');
  await page.getByRole('button', { name: 'Adicionar condição', exact: true }).first().click();
  await page.getByLabel('Valor da comparação').nth(1).fill('Maria');
  await page.getByLabel('Combinação').nth(1).selectOption('any');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  const result = page.getByRole('status');
  await expect(result.getByText('Grupo principal · Todas: Sim', { exact: true })).toBeVisible({ timeout: 3000 });
  const nested = result.getByRole('group', { name: 'Grupo 1', exact: true });
  await expect(nested.getByText('Grupo 1 · Qualquer: Sim', { exact: true })).toBeVisible();
  await expect(nested).toContainText('Condição 1.1 · Nome é igual a “José”: Sim');
  await expect(nested).toContainText('Condição 1.2 · Nome é igual a “Maria”: Não avaliada');
  await expect(nested).not.toContainText('Condição 2');
  await expect(result).toContainText('Condição 2 · Nome é igual a “José”: Sim');
});

test('amplia painel pelo teclado sem perder edição e respeita viewport estreito', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('José');
  const panel = page.getByRole('complementary', { name: 'Configurar Condição', exact: true });
  const initial = await panel.boundingBox({ timeout: 3000 });
  await page.getByRole('button', { name: 'Ampliar painel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(initial!.width + 100);
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('José');
  await expect(page.getByRole('button', { name: 'Reduzir painel', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(async () => { const box = (await panel.boundingBox())!; return box.x >= 0 && box.x + box.width <= 600; }).toBe(true);
  await page.getByRole('button', { name: 'Reduzir painel', exact: true }).click();
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('José');
});

test('seleciona Empresa mantendo comparação textual e explica dado correto', async ({ page }) => {
  let submitted: unknown;
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.route('**/functions/v1/test-guided-condition', route => {
    submitted = route.request().postDataJSON().condition;
    return route.fulfill({ json: { status: 'evaluated', matched: true,
      rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'Fábrica Aurora' }] } });
  });
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await page.getByLabel('Valor da comparação').fill('FABRICA AURORA');
  await page.getByLabel('Informação', { exact: true }).selectOption('lead.company', { timeout: 3000 });
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('FABRICA AURORA');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Empresa do lead: Fábrica Aurora');
  expect(submitted).toMatchObject({ field: 'lead.company', operator: 'equals', value: 'FABRICA AURORA' });
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await page.getByLabel('Informação', { exact: true }).selectOption('lead.name');
  await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue('is_empty');
});

test('aprova Empresa explicitamente sem apagar concessão de Nome', async ({ page }) => {
  let grant = { fields: ['lead.name'], revision: 1 };
  const writes: string[][] = [];
  await page.route('**/rest/v1/workflow_data_grants?*', route => route.fulfill({ json: grant }));
  await page.route('**/rest/v1/rpc/set_workflow_data_grant', route => {
    const body = route.request().postDataJSON();
    writes.push(body.p_fields);
    grant = { fields: body.p_fields, revision: grant.revision + 1 };
    return route.fulfill({ json: grant });
  });
  await openGuidedEditor(page, 'Aurora');
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByLabel('Informação', { exact: true }).selectOption('lead.company');
  await expect(page.getByText('Empresa de todos os leads desta organização')).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: 'Autorizar acesso à empresa dos leads', exact: true }).click();
  await expect(page.getByText('Acesso autorizado pela organização')).toBeVisible();
  expect(writes[0]).toEqual(['lead.name', 'lead.company']);
  await page.getByRole('button', { name: 'Revogar acesso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Autorizar acesso à empresa dos leads', exact: true })).toBeVisible();
  expect(writes[1]).toEqual(['lead.name']);
});
