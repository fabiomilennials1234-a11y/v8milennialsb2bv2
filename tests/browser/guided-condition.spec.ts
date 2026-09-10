import { test, expect, type Page } from '@playwright/test';
import type { GuidedConditionDraft } from '../../src/types/workflow';

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/lead_custom_fields?*', route => route.fulfill({ json: [] }));
});

for (const [field, otherField, label] of [
  ['lead.pre_sale_responsible_id', 'lead.sale_responsible_id', 'Responsável de pré-vendas'],
  ['lead.sale_responsible_id', 'lead.pre_sale_responsible_id', 'Responsável de vendas'],
] as const) test(`seleciona ${label} por nome e mantém pessoa entre funções compatíveis`, async ({ page }) => {
  const memberId = 'abcd0000-0000-4000-8000-000000000003';
  await page.route('**/rest/v1/guided_responsible_members?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id')
      ? { id: memberId, name: 'Marina', is_active: false } : [{ id: memberId, name: 'Marina', is_active: false }],
  }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, field);
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await page.getByLabel('Buscar responsável', { exact: true }).fill('Mari');
  await page.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption(memberId);
  await expect(page.getByRole('option', { name: 'Marina (inativo)' })).toHaveCount(1);
  await expect(page.locator('.react-flow__node-condition')).toContainText(`${label} é “Marina”`);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field, operator: 'equals', memberId });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [
      { id: 'rule-1', status: 'evaluated', matched: true, actual: memberId, reference: { id: memberId, name: 'Marina atual' } },
    ] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Marina atual');
  await page.getByLabel('Comparação', { exact: true }).selectOption('not_equals');
  await selectInformation(page, otherField);
  await expect(page.getByRole('combobox', { name: 'Responsável', exact: true })).toHaveValue(memberId);
  await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue('not_equals');
  await expect(page.getByText('A informação mudou. Defina uma nova comparação.')).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByRole('combobox', { name: 'Responsável', exact: true })).toHaveCount(0);
  await selectInformation(page, 'lead.name');
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('');
});

for (const item of [
  { table: 'guided_responsible_members', field: 'lead.sale_responsible_id', key: 'memberId', label: 'Responsável', plural: 'responsáveis', empty: 'Nenhum responsável encontrado. Tente outro nome.' },
  { table: 'lead_origins', field: 'lead.origin', key: 'originId', label: 'Origem', plural: 'origens', empty: 'Nenhuma origem encontrada. Tente outro nome.' },
  { table: 'tags', field: 'lead.tags', key: 'tagId', label: 'Tag', plural: 'tags', empty: 'Nenhuma tag encontrada. Tente outro nome.' },
]) test(`falha na consulta do cadastro de ${item.label} não aparece como catálogo vazio`, async ({ page }) => {
  const id = 'abcd0000-0000-4000-8000-000000000010';
  let recovered = false;
  await page.route(`**/rest/v1/${item.table}?*`, route => {
    if (!new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: [] });
    return recovered ? route.fulfill({ json: { id, name: 'Cadastro atual', is_active: true } })
      : route.fulfill({ status: 503, json: { message: 'unavailable' } });
  });
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: item.field,
    operator: item.field === 'lead.tags' ? 'has_tag' : 'equals', [item.key]: id } as GuidedConditionDraft);
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByText(`Não foi possível carregar ${item.plural}. Tente novamente.`)).toBeVisible();
  await expect(page.getByText(item.empty)).toHaveCount(0);
  await expect(page.getByRole('option', { name: `${item.label} não ${item.label === 'Responsável' ? 'verificado' : 'verificada'}`, exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: item.label, exact: true })).toHaveValue(id);
  recovered = true;
  await page.getByRole('button', { name: `Tentar carregar ${item.plural} novamente` }).click();
  await expect(page.getByRole('option', { name: 'Cadastro atual', exact: true })).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: item.label, exact: true })).toHaveValue(id);
  await expect(page.getByText(`Não foi possível carregar ${item.plural}. Tente novamente.`)).toHaveCount(0);
});

test('responsável removido não é substituído por cadastro homônimo', async ({ page }) => {
  const removedId = 'abcd0000-0000-4000-8000-000000000004';
  const replacementId = 'abcd0000-0000-4000-8000-000000000005';
  await page.route('**/rest/v1/guided_responsible_members?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id') ? null : [
      { id: removedId, name: 'Marina', is_active: true }, { id: replacementId, name: 'Marina', is_active: true },
    ],
  }));
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.sale_responsible_id', operator: 'equals', memberId: removedId, memberLabel: 'Marina' });
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByText('Responsável removido ou sem acesso. Selecione outro responsável.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Responsável', exact: true })).toHaveValue(removedId);
  await expect(page.getByRole('option', { name: 'Responsável indisponível', exact: true })).toBeDisabled();
  await expect(page.getByRole('option', { name: 'Marina', exact: true })).toHaveCount(1);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Responsável de vendas é “Marina”');
});

test('falha no catálogo de responsáveis permite recuperar sem virar lista vazia', async ({ page }) => {
  await page.route('**/rest/v1/guided_responsible_members?*', route => route.fulfill({ status: 503, json: { message: 'unavailable' } }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.sale_responsible_id');
  await expect(page.getByText('Não foi possível carregar responsáveis. Tente novamente.')).toBeVisible();
  await expect(page.getByText('Nenhum responsável encontrado. Tente outro nome.')).toHaveCount(0);
  await page.route('**/rest/v1/guided_responsible_members?*', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Tentar carregar responsáveis novamente' }).click();
  await expect(page.getByText('Nenhum responsável encontrado. Tente outro nome.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
});

test('seleciona origem pelo cadastro e preserva identidade ao mudar comparação', async ({ page }) => {
  const originId = 'abcd0000-0000-4000-8000-000000000002';
  await page.route('**/rest/v1/lead_origins?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id')
      ? { id: originId, name: 'Parceiros', is_active: false }
      : [{ id: originId, name: 'Parceiros', is_active: false }],
  }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.origin');
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await page.getByLabel('Buscar origem', { exact: true }).fill('Parc');
  await page.getByRole('combobox', { name: 'Origem', exact: true }).selectOption(originId);
  await expect(page.getByRole('option', { name: 'Parceiros (inativa)' })).toHaveCount(1);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Origem é “Parceiros”');
  await page.getByLabel('Comparação', { exact: true }).selectOption('not_equals');
  await expect(page.getByRole('combobox', { name: 'Origem', exact: true })).toHaveValue(originId);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Origem não é “Parceiros”');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.origin', operator: 'not_equals', originId });
    return route.fulfill({ json: { status: 'evaluated', matched: false, rules: [
      { id: 'rule-1', status: 'evaluated', matched: false, actual: 'referral', reference: { id: originId, name: 'Parceiros atuais' } },
    ] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Parceiros atuais');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByRole('combobox', { name: 'Origem', exact: true })).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Origem está vazia');
  await selectInformation(page, 'lead.name');
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('');
});

test('troca tag por origem limpando referência com orientação no campo', async ({ page }) => {
  await page.route('**/rest/v1/lead_origins?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ json: [] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.tags');
  await selectInformation(page, 'lead.origin');
  await expect(page.getByText('A informação mudou. Defina uma nova comparação.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Origem', exact: true })).toHaveValue('');
  await expect(page.getByText('Nenhuma origem encontrada. Tente outro nome.')).toBeVisible();
  await expect(page.getByRole('option', { name: 'WhatsApp', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
});

test('permite recuperar catálogo de tags após falha sem apagar a condição', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ status: 503, json: { message: 'unavailable' } }));
  await page.goto('/tests/browser/fixtures/guided-condition.html');
  await selectInformation(page, 'lead.tags');
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar tags. Tente novamente.');
  await expect(page.getByText('Nenhuma tag encontrada. Tente outro nome.')).toHaveCount(0);
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Tentar carregar tags novamente' }).click();
  await expect(page.getByText('Nenhuma tag encontrada. Tente outro nome.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Informação', { exact: true })).toContainText('Lead · Tags');
});

test('seleciona tag pelo nome e testa sua identidade sem digitar referência', async ({ page }) => {
  const tagId = 'abcd0000-0000-4000-8000-000000000001';
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id')
      ? { id: tagId, name: 'Distribuidor' } : [{ id: tagId, name: 'Distribuidor' }],
  }));
  await openGuidedEditor(page, 'JOSE');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.tags', operator: 'has_tag', tagId });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [
      { id: 'rule-1', status: 'evaluated', matched: true, actual: true, reference: { id: tagId, name: 'Distribuidor' } },
    ] } });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.tags');
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await page.getByLabel('Buscar tag', { exact: true }).fill('Distrib');
  await page.getByRole('combobox', { name: 'Tag', exact: true }).selectOption(tagId);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Tem tag “Distribuidor”');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Distribuidor: atribuída');
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({
    status: 422, json: { status: 'error', code: 'reference_unavailable' },
  }));
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('region', { name: 'Teste da condição' }).getByRole('alert')).toContainText('Uma referência foi removida ou não está acessível. Revise as escolhas da condição.');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('not_has_tag');
  await expect(page.getByRole('combobox', { name: 'Tag', exact: true })).toHaveValue(tagId);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Não tem tag “Distribuidor”');
  await selectInformation(page, 'lead.name');
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('');
  await expect(page.getByText('A informação mudou. Defina uma nova comparação.')).toBeVisible();
});


for (const uppercase of [false, true]) test(`renomeação de tag atualiza resumo sem trocar identidade nem operador (${uppercase ? 'UUID maiúsculo' : 'UUID canônico'})`, async ({ page }) => {
  const tagId = 'abcd0000-0000-4000-8000-000000000001';
  const savedTagId = uppercase ? tagId.toUpperCase() : tagId;
  await page.route('**/rest/v1/tags?*', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: params.has('id') ? { id: tagId, name: 'Distribuidor regional' }
      : params.has('name') ? [] : [{ id: tagId, name: 'Nome antigo' }],
    });
  });
  let saved: { p_definition: { nodes: Array<{ id: string; data: { guidedCondition?: GuidedConditionDraft } }> } } | undefined;
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.tags', operator: 'not_has_tag', tagId: savedTagId, tagLabel: 'Nome antigo' });
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tag', exact: true }).locator('option:checked')).toHaveText('Distribuidor regional');
  await expect(page.getByRole('combobox', { name: 'Tag', exact: true })).toHaveValue(tagId);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Não tem tag “Distribuidor regional”');
  await page.getByLabel('Buscar tag', { exact: true }).fill('sem correspondência');
  await expect(page.getByText('Nenhuma tag encontrada. Tente outro nome.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Tag', exact: true })).toHaveValue(tagId);
  await expect(page.getByRole('combobox', { name: 'Tag', exact: true })).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => saved?.p_definition.nodes.find(node => node.id === 'condition-1')?.data.guidedCondition).toMatchObject({
    id: 'rule-1', field: 'lead.tags', operator: 'not_has_tag', tagId: savedTagId, tagLabel: 'Distribuidor regional',
  });
});


test('tag removida não é restaurada por lista antiga nem substituída por mesmo nome', async ({ page }) => {
  const removedId = 'abcd0000-0000-4000-8000-000000000001';
  const replacementId = 'abcd0000-0000-4000-8000-000000000002';
  await page.route('**/rest/v1/tags?*', route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    return route.fulfill({ json: id ? id === `eq.${removedId}` ? null : { id: replacementId, name: 'Distribuidor' }
      : [{ id: removedId, name: 'Distribuidor' }, { id: replacementId, name: 'Distribuidor' }],
    });
  });
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.tags', operator: 'has_tag', tagId: removedId, tagLabel: 'Distribuidor' });
  await page.getByText('Nome informado', { exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Tag', exact: true });
  await expect(page.getByRole('alert').filter({ hasText: 'Tag removida ou sem acesso. Selecione outra tag.' })).toBeVisible();
  await expect(picker).toHaveValue(removedId);
  await expect(picker.locator('option:checked')).toHaveText('Tag indisponível');
  await expect(picker).toHaveAttribute('aria-invalid', 'true');
  await picker.selectOption(replacementId);
  await expect(picker).toHaveValue(replacementId);
  await expect(picker).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByRole('alert').filter({ hasText: 'Tag removida ou sem acesso. Selecione outra tag.' })).toHaveCount(0);
});


test('troca de usuário não reutiliza catálogo de tags da conta anterior', async ({ page }) => {
  const tagId = 'abcd0000-0000-4000-8000-000000000001';
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id') ? { id: tagId, name: 'Tag da conta anterior' }
      : [{ id: tagId, name: 'Tag da conta anterior' }],
  }));
  await page.goto('/tests/browser/fixtures/guided-condition.html?identity-switch=1');
  await selectInformation(page, 'lead.tags');
  await page.getByRole('combobox', { name: 'Tag', exact: true }).selectOption(tagId);
  await expect(page.getByRole('option', { name: 'Tag da conta anterior', exact: true })).toHaveCount(1);
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }));
  await page.getByRole('button', { name: 'Trocar usuário' }).click();
  await expect(page.getByRole('option', { name: 'Tag da conta anterior', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar tags. Tente novamente.');
});


test('resultado de grupo usa nome da tag no momento da avaliação', async ({ page }) => {
  const tagId = 'abcd0000-0000-4000-8000-000000000001';
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id') ? { id: tagId, name: 'Distribuidor antigo' }
      : [{ id: tagId, name: 'Distribuidor antigo' }],
  }));
  await openGuidedEditor(page, { version: 1, id: 'group-1', kind: 'group', match: 'all', children: [
    { version: 1, id: 'rule-1', field: 'lead.tags', operator: 'has_tag', tagId, tagLabel: 'Distribuidor antigo' },
  ] });
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({ json: {
    status: 'evaluated', matched: true, groups: [{ id: 'group-1', status: 'evaluated', matched: true }],
    rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: true, reference: { id: tagId, name: 'Distribuidor atual' } }],
  } }));
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('button', { name: 'Recolher grupo', exact: true }).click();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Tem tag “Distribuidor atual”: Sim');
  await expect(page.getByRole('status')).not.toContainText('Distribuidor antigo');
});

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

async function openGuidedEditor(page: Page, draftValue?: string | GuidedConditionDraft, isNew = false, omitDraftTrigger = false, draftSettings?: Record<string, unknown>, liveActive = false, publishedVersion?: string | { unavailable: true }) {
  await page.route('**/rest/v1/workflow_guided_publications?*', route => typeof publishedVersion === 'object'
    ? route.fulfill({ status: 503, json: { message: 'unavailable' } })
    : route.fulfill({ json: publishedVersion ? { version_id: publishedVersion } : null }));
  await page.route('**/rest/v1/workflow_guided_drafts?*', route => route.fulfill({ json: draftValue === undefined ? null : {
    revision: 3, settings: draftSettings, definition: { nodes: [
      ...(!omitDraftTrigger ? [{ id: 'trigger-1', type: 'trigger', position: { x: 400, y: 50 }, data: { type: 'trigger', label: 'Entrada', triggerType: 'lead_created', config: {} } }] : []),
      { id: 'condition-1', type: 'condition', position: { x: 400, y: 220 }, data: { type: 'condition', label: 'Nome informado',
        guidedCondition: typeof draftValue === 'object' ? draftValue : { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: draftValue } } },
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
  await expect(page.getByLabel('Informação', { exact: true })).toContainText('Lead · Nome');
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

for (const located of [false, true]) {
  test(`publicação com referência indisponível preserva rascunho e orienta revisão (localizada=${located})`, async ({ page }) => {
    const message = located
      ? 'Uma referência foi removida ou não está acessível. Revise as escolhas desta condição.'
      : 'Uma referência foi removida ou não está acessível. Revise as escolhas da condição.';
    await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } }));
    await page.route('**/functions/v1/publish-guided-workflow', route => route.fulfill({ status: 422, json: {
      status: 'error', code: 'reference_unavailable',
      ...(located ? { issues: [{ nodeId: 'condition-1', code: 'reference_unavailable', message }] } : {}),
    } }));
    await openGuidedEditor(page, 'Mariana');
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
    if (located) await page.getByRole('button', { name: message, exact: true }).click();
    else await page.getByText('Nome informado', { exact: true }).click();
    await expect(page.getByLabel('Valor da comparação')).toHaveValue('Mariana');
  });
}

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
  await selectInformation(page, 'lead.company');
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('FABRICA AURORA');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Empresa do lead: Fábrica Aurora');
  expect(submitted).toMatchObject({ field: 'lead.company', operator: 'equals', value: 'FABRICA AURORA' });
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await selectInformation(page, 'lead.name');
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
  await selectInformation(page, 'lead.company');
  await expect(page.getByText('Empresa de todos os leads desta organização')).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: 'Autorizar acesso à empresa dos leads', exact: true }).click();
  await expect(page.getByText('Acesso autorizado pela organização')).toBeVisible();
  expect(writes[0]).toEqual(['lead.name', 'lead.company']);
  await page.getByRole('button', { name: 'Revogar acesso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Autorizar acesso à empresa dos leads', exact: true })).toBeVisible();
  expect(writes[1]).toEqual(['lead.name']);
});

test('aprova Tags explicitamente sem apagar concessão de Nome', async ({ page }) => {
  let grant = { fields: ['lead.name'], revision: 1 };
  const writes: string[][] = [];
  await page.route('**/rest/v1/workflow_data_grants?*', route => route.fulfill({ json: grant }));
  await page.route('**/rest/v1/rpc/set_workflow_data_grant', route => {
    const body = route.request().postDataJSON();
    writes.push(body.p_fields);
    grant = { fields: body.p_fields, revision: grant.revision + 1 };
    return route.fulfill({ json: grant });
  });
  await page.route('**/rest/v1/tags?*', route => route.fulfill({ json: [] }));
  await openGuidedEditor(page, 'Aurora');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.tags');
  await expect(page.getByText('Tags de todos os leads desta organização')).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('button', { name: 'Autorizar acesso aos campos selecionados', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Autorizar acesso aos campos selecionados', exact: true }).click();
  await expect(page.getByText('Acesso autorizado pela organização')).toBeVisible();
  expect(writes[0]).toEqual(['lead.name', 'lead.tags']);
  await page.getByRole('button', { name: 'Revogar acesso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Autorizar acesso aos campos selecionados', exact: true })).toBeVisible();
  expect(writes[1]).toEqual(['lead.name']);
});

test('opção removida exige nova escolha e erro de consulta permite recuperar sem trocar identidade', async ({ page }) => {
  const fieldId = '11111111-1111-4111-8111-111111111117';
  let recovered = false;
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.custom', fieldId, fieldType: 'select', fieldLabel: 'Nome antigo', operator: 'equals', value: 'Indústria' });
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    if (!recovered) return route.fulfill({ status: 503, json: { message: 'unavailable' } });
    const field = { id: fieldId, field_name: 'Canal atual', field_type: 'select', field_options: ['industria', 'Revenda'] };
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? field : [field] });
  });
  await page.reload();
  await page.getByText('Nome informado', { exact: true }).click();
  const value = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
  await expect(page.getByText('Não foi possível verificar as opções cadastradas.')).toBeVisible();
  await expect(value).toContainText('Opções não verificadas');
  await expect(value).toBeDisabled();
  await expect(page.getByText('A opção selecionada foi removida. Selecione uma opção cadastrada.')).toHaveCount(0);
  recovered = true;
  await page.getByRole('button', { name: 'Tentar verificar opções novamente' }).click();
  await expect(value).toContainText('Opção removida');
  await expect(page.getByText('A opção selecionada foi removida. Selecione uma opção cadastrada.')).toBeVisible();
  await value.click();
  await page.getByRole('combobox', { name: 'Buscar opção cadastrada', exact: true }).fill('industria');
  await page.getByRole('combobox', { name: 'Buscar opção cadastrada', exact: true }).press('ArrowDown');
  await page.getByRole('combobox', { name: 'Buscar opção cadastrada', exact: true }).press('Enter');
  await expect(value).toContainText('industria');
  await expect(value).toBeFocused();
  await expect(page.getByText('A opção selecionada foi removida. Selecione uma opção cadastrada.')).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Canal atual é “industria”');
  await selectInformation(page, 'lead.company');
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('');
});

test('busca opção cadastrada fora dos primeiros resultados e envia valor exato', async ({ page }) => {
  const fieldId = '11111111-1111-4111-8111-111111111116';
  await openGuidedEditor(page, 'Aurora');
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    const field = { id: fieldId, field_name: 'Canal cadastrado', field_type: 'select',
      field_options: [...Array.from({ length: 30 }, (_, i) => `Canal ${i + 1}`), 'Indústria', 'industria'] };
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? field : [field] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Canal cadastrado');
  await page.getByRole('option', { name: 'Canal cadastrado', exact: true }).click({ timeout: 3000 });
  const value = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
  await expect(value).toContainText('Selecione uma opção');
  await value.click();
  await expect(page.getByRole('option', { name: 'Indústria', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Buscar opção cadastrada', exact: true }).fill('industria');
  await expect(page.getByRole('listbox', { name: 'Opções cadastradas' }).getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: 'Indústria', exact: true }).click();
  await expect(value).toContainText('Indústria');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Canal cadastrado é “Indústria”');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.custom', fieldId, fieldType: 'select', operator: 'equals', value: 'Indústria' });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'Indústria', reference: { id: fieldId, name: 'Canal cadastrado' } }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Canal cadastrado é “Indústria”');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(value).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('equals');
  await expect(value).toContainText('Selecione uma opção');
});

for (const timezoneId of ['America/Sao_Paulo', 'Asia/Tokyo']) test.describe(`datas personalizadas em ${timezoneId}`, () => {
  test.use({ timezoneId });
  test('seleciona data pelo calendário e mantém o dia no resumo e no teste', async ({ page }) => {
    const fieldId = '11111111-1111-4111-8111-111111111114', otherId = '11111111-1111-4111-8111-111111111115';
    await openGuidedEditor(page, '2024-02-29');
    await page.route('**/rest/v1/lead_custom_fields?*', route => {
      const field = { id: fieldId, field_name: 'Próxima compra', field_type: 'date' };
      const other = { id: otherId, field_name: 'Data limite', field_type: 'date' };
      const requested = new URL(route.request().url()).searchParams.get('id');
      return route.fulfill({ json: requested ? requested === `eq.${otherId}` ? other : field : [field, other] });
    });
    await page.getByText('Nome informado', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
    await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Próxima compra');
    await page.getByRole('option', { name: 'Próxima compra', exact: true }).click({ timeout: 3000 });
    const value = page.getByLabel('Valor da comparação', { exact: true });
    await expect(value).toHaveAttribute('type', 'date');
    await expect(value).toHaveValue('');
    await value.fill('2024-02-29');
    await expect(page.locator('.react-flow__node-condition')).toContainText('Próxima compra é em 29/02/2024');
    await page.getByLabel('Comparação', { exact: true }).selectOption('before');
    await expect(value).toHaveValue('2024-02-29');
    await value.fill('2024-03-01');
    for (const name of ['Data limite', 'Próxima compra']) {
      await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
      await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill(name);
      await page.getByRole('option', { name, exact: true }).click();
      await expect(value).toHaveValue('2024-03-01');
      await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue('before');
    }
    await page.route('**/functions/v1/test-guided-condition', route => {
      expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.custom', fieldId, fieldType: 'date', operator: 'before', value: '2024-03-01' });
      return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: '2024-02-29', reference: { id: fieldId, name: 'Próxima compra' } }] } });
    });
    await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
    await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Próxima compra é antes de 01/03/2024');
    await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
    await expect(value).toHaveCount(0);
    await expect(page.locator('.react-flow__node-condition')).toContainText('Próxima compra está vazio');
    await page.getByLabel('Comparação', { exact: true }).selectOption('equals');
    await expect(value).toHaveValue('');
    await selectInformation(page, 'lead.company');
    await expect(value).toHaveValue('');
  });
});

test('seleciona booleano personalizado com Sim ou Não sem confundir Não com vazio', async ({ page }) => {
  const fieldId = '11111111-1111-4111-8111-111111111113';
  await openGuidedEditor(page, 'Aurora');
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    const field = { id: fieldId, field_name: 'Aceita contato', field_type: 'boolean' };
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? field : [field] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Aceita contato');
  await page.getByRole('option', { name: 'Aceita contato', exact: true }).click();
  const value = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
  await expect(value).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Testar condição', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Comparação', { exact: true }).locator('option[value="contains"]')).toHaveCount(0);
  await value.selectOption({ label: 'Não' });
  await expect(page.locator('.react-flow__node-condition')).toContainText('Aceita contato é Não');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.custom', fieldId, fieldType: 'boolean', operator: 'equals', value: false });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: false, reference: { id: fieldId, name: 'Aceita contato' } }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Aceita contato é Não');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(value).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Aceita contato está vazio');
  await page.getByLabel('Comparação', { exact: true }).selectOption('equals');
  await expect(value).toHaveValue('');
  await value.selectOption({ label: 'Sim' });
  await expect(page.locator('.react-flow__node-condition')).toContainText('Aceita contato é Sim');
  await selectInformation(page, 'lead.company');
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('');
});

test('seleciona número personalizado com comparação numérica e preserva UUID ao verificar vazio', async ({ page }) => {
  const fieldId = '11111111-1111-4111-8111-111111111112';
  await openGuidedEditor(page, 'Aurora');
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    const field = { id: fieldId, field_name: 'Quantidade prevista', field_type: 'number' };
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? field : [field] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Quantidade');
  await page.getByRole('option', { name: 'Quantidade prevista', exact: true }).click();
  const value = page.getByRole('spinbutton', { name: 'Valor da comparação', exact: true });
  await expect(value).toHaveValue('');
  await expect(page.getByLabel('Comparação', { exact: true }).locator('option[value="contains"]')).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('greater_than');
  await value.fill('10.5');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Quantidade prevista é maior que 10.5');
  await selectInformation(page, 'lead.qualification_score');
  await expect(value).toHaveValue('10.5');
  await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue('greater_than');
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Quantidade');
  await page.getByRole('option', { name: 'Quantidade prevista', exact: true }).click();
  await expect(value).toHaveValue('10.5');
  await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue('greater_than');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.custom', fieldId, fieldType: 'number', operator: 'greater_than', value: 10.5 });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 20, reference: { id: fieldId, name: 'Quantidade prevista' } }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Quantidade prevista');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(value).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Quantidade prevista está vazio');
  await page.getByLabel('Comparação', { exact: true }).selectOption('equals');
  await expect(value).toHaveValue('');
});

for (const fieldType of ['text', 'number', 'boolean', 'date', 'select'] as const) test(`aprova campo personalizado ${fieldType} pelo nome atual e revoga somente seu UUID`, async ({ page }) => {
  const fieldId = '11111111-1111-4111-8111-111111111111';
  let grant = { fields: ['lead.name'], revision: 1 };
  const writes: string[][] = [];
  await page.route('**/rest/v1/workflow_data_grants?*', route => route.fulfill({ json: grant }));
  await page.route('**/rest/v1/rpc/set_workflow_data_grant', route => {
    const body = route.request().postDataJSON();
    writes.push(body.p_fields);
    grant = { fields: body.p_fields, revision: grant.revision + 1 };
    return route.fulfill({ json: grant });
  });
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.custom', fieldId, fieldType, fieldLabel: 'Nome antigo', operator: 'equals', value: fieldType === 'date' ? '2024-02-29' : fieldType === 'boolean' ? false : fieldType === 'number' ? 10 : 'Indústria' });
  await page.route('**/rest/v1/lead_custom_fields?*', route => route.fulfill({ json: { id: fieldId, field_name: 'Especialidade', field_type: fieldType, ...(fieldType === 'select' ? { field_options: ['Indústria'] } : {}) } }));
  await page.reload();
  await page.getByText('Nome informado', { exact: true }).click();
  const access = page.getByRole('region', { name: 'Acesso da automação' });
  await expect(access.getByText('Especialidade de todos os leads desta organização')).toBeVisible();
  await access.getByRole('button', { name: 'Autorizar acesso aos campos selecionados', exact: true }).click();
  await expect(access.getByText('Acesso autorizado pela organização')).toBeVisible();
  expect(writes[0]).toEqual(['lead.name', `lead.custom:${fieldId}`]);
  await access.getByRole('button', { name: 'Revogar acesso', exact: true }).click();
  await expect(access.getByText('Acesso ainda não autorizado')).toBeVisible();
  expect(writes[1]).toEqual(['lead.name']);
});

test('troca operadores de texto preservando valor compatível e resumo no canvas', async ({ page }) => {
  await openGuidedEditor(page, 'Aurora');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.company');
  for (const [operator, label] of [
    ['contains', 'contém'], ['not_contains', 'não contém'], ['starts_with', 'começa com'],
    ['ends_with', 'termina com'], ['not_equals', 'é diferente de'],
  ]) {
    await page.getByLabel('Comparação', { exact: true }).selectOption(operator, { timeout: 3000 });
    await expect(page.getByLabel('Valor da comparação')).toHaveValue('Aurora');
    await expect(page.locator('.react-flow__node-condition')).toContainText(`Empresa ${label} “Aurora”`);
  }
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('contains');
  await expect(page.getByLabel('Valor da comparação')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Testar condição', exact: true })).toBeDisabled();
});

for (const [field, label, value] of [['lead.email', 'Email', 'comercial@aurora.example'], ['lead.phone', 'Telefone', '5511999990000']]) {
  test(`seleciona ${label} e explica o valor sem confundir com Nome`, async ({ page }) => {
    let submitted: unknown;
    await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
    await page.route('**/functions/v1/test-guided-condition', route => {
      submitted = route.request().postDataJSON().condition;
      return route.fulfill({ json: { status: 'evaluated', matched: true,
        rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: value }] } });
    });
    await page.goto('/tests/browser/fixtures/guided-condition.html');
    await selectInformation(page, field);
    await page.getByLabel('Valor da comparação').fill(value);
    await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
    await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`${label} do lead: ${value}`);
    expect(submitted).toMatchObject({ field, operator: 'equals', value });
  });
}

test('configura pontuação numérica sem confundir zero com comparação incompleta', async ({ page }) => {
  await openGuidedEditor(page, 'JOSE');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.qualification_score', operator: 'equals', value: 0 });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 0 }] } });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.qualification_score');
  const value = page.getByLabel('Valor da comparação');
  await expect(value).toHaveAttribute('type', 'number');
  await expect(value).toHaveValue('');
  await expect(page.getByText('A informação mudou. Defina uma nova comparação.')).toBeVisible();
  await expect(page.getByLabel('Comparação', { exact: true }).getByRole('option', { name: 'contém', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
  await value.fill('0');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Pontuação de qualificação é igual a 0');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText('Pontuação de qualificação do lead: 0');
  for (const [operator, label] of [
    ['greater_than', 'é maior que'], ['greater_than_or_equal', 'é maior ou igual a'],
    ['less_than', 'é menor que'], ['less_than_or_equal', 'é menor ou igual a'],
  ]) {
    await page.getByLabel('Comparação', { exact: true }).selectOption(operator);
    await expect(value).toHaveValue('0');
    await expect(page.locator('.react-flow__node-condition')).toContainText(`Pontuação de qualificação ${label} 0`);
  }
  await value.fill('');
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeDisabled();
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(value).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Testar condição' })).toBeEnabled();
});

for (const [field, label] of [['utm_campaign', 'UTM Campaign'], ['utm_source', 'UTM Source'], ['utm_medium', 'UTM Medium'], ['utm_content', 'UTM Content'], ['utm_term', 'UTM Term']]) test(`seleciona ${label} por busca e aceita texto fora das sugestões`, async ({ page }) => {
  await openGuidedEditor(page, '');
  await page.route('**/rest/v1/leads?*', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('select') !== field) return route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] });
    expect(params.get('limit')).toBe('25');
    return route.fulfill({ json: params.getAll(field).some(value => value.includes('Atacado'))
      ? [{ [field]: 'Atacado verão' }] : [{ [field]: 'Campanha inicial' }] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, `lead.${field}`);
  const picker = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
  await picker.click();
  await expect(page.getByRole('option', { name: 'Campanha inicial', exact: true })).toBeVisible();
  await page.getByPlaceholder('Buscar ou digitar valor…').fill('Atacado');
  await page.getByRole('option', { name: 'Atacado verão', exact: true }).click();
  await expect(page.locator('.react-flow__node-condition')).toContainText(`${label} é igual a “Atacado verão”`);
  await picker.click();
  await page.getByPlaceholder('Buscar ou digitar valor…').fill('Nova campanha');
  await page.getByRole('option', { name: 'Usar "Nova campanha"', exact: true }).click();
  await expect(page.locator('.react-flow__node-condition')).toContainText(`${label} é igual a “Nova campanha”`);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: `lead.${field}`, value: 'Nova campanha' });
    return route.fulfill({ json: { status: 'evaluated', matched: false, rules: [{ id: 'rule-1', status: 'evaluated', matched: false, actual: 'Outra campanha' }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição' }).click();
  await expect(page.getByRole('status')).toContainText(`${label} do lead: Outra campanha`);
});

test('falha de sugestões UTM não vira lista vazia nem impede valor manual', async ({ page }) => {
  await openGuidedEditor(page, '');
  let failed = true;
  await page.route('**/rest/v1/leads?*', route => new URL(route.request().url()).searchParams.get('select') === 'utm_campaign'
    ? route.fulfill(failed ? { status: 503, json: { message: 'unavailable' } } : { json: [] })
    : route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] }));
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.utm_campaign');
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar sugestões UTM.' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Valor da comparação', exact: true }).click();
  await expect(page.getByText('Nenhum valor encontrado nesta org — digite manualmente.')).toHaveCount(0);
  await page.getByPlaceholder('Buscar ou digitar valor…').fill('Campanha manual');
  await page.getByRole('option', { name: 'Usar "Campanha manual"', exact: true }).click();
  await expect(page.locator('.react-flow__node-condition')).toContainText('“Campanha manual”');
  failed = false;
  await page.getByRole('button', { name: 'Tentar carregar sugestões novamente' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar sugestões UTM.' })).toHaveCount(0);
});

test('valor manual UTM pode ser confirmado antes das sugestões responderem', async ({ page }) => {
  await openGuidedEditor(page, '');
  await page.route('**/rest/v1/leads?*', async route => {
    if (new URL(route.request().url()).searchParams.get('select') === 'utm_campaign') return;
    await route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'lead.utm_campaign');
  await page.getByRole('combobox', { name: 'Valor da comparação', exact: true }).click();
  await expect(page.getByText('Carregando valores…')).toBeVisible();
  await page.getByPlaceholder('Buscar ou digitar valor…').fill('Campanha urgente');
  await expect(page.getByRole('option', { name: 'Usar "Campanha urgente"', exact: true })).toBeVisible();
  await page.getByPlaceholder('Buscar ou digitar valor…').press('Enter');
  await expect(page.locator('.react-flow__node-condition')).toContainText('“Campanha urgente”');
});

test('troca de usuário não reutiliza sugestões UTM da conta anterior', async ({ page }) => {
  await page.route('**/rest/v1/leads?*', route => new URL(route.request().url()).searchParams.get('select') === 'utm_campaign'
    ? route.fulfill({ json: [{ utm_campaign: 'Campanha restrita' }] }) : route.fulfill({ json: [] }));
  await page.goto('/tests/browser/fixtures/guided-condition.html?identity-switch=1');
  await selectInformation(page, 'lead.utm_campaign');
  await page.getByRole('combobox', { name: 'Valor da comparação', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Campanha restrita', exact: true })).toBeVisible();
  await page.getByPlaceholder('Buscar ou digitar valor…').press('Escape');
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ status: 403, json: { message: 'denied' } }));
  await page.getByRole('button', { name: 'Trocar usuário' }).click();
  await page.getByRole('combobox', { name: 'Valor da comparação', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Campanha restrita', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar sugestões UTM.' })).toBeVisible();
});


for (const [field, label, actual] of [['lead.name', 'Nome', 'José'], ['lead.qualification_score', 'Pontuação de qualificação', 0], ['lead.origin', 'Origem', 'web'], ['lead.pre_sale_responsible_id', 'Responsável de pré-vendas', 'abcd0000-0000-4000-8000-000000000001'], ['lead.sale_responsible_id', 'Responsável de vendas', 'abcd0000-0000-4000-8000-000000000001']] as const) {
  test(`configura ${label} preenchido sem valor adicional e mantém foco ao duplicar`, async ({ page }) => {
    await openGuidedEditor(page, 'JOSE');
    await page.getByText('Nome informado', { exact: true }).click();
    await selectInformation(page, field);
    await page.getByLabel('Comparação', { exact: true }).selectOption('is_not_empty', { timeout: 3000 });
    await expect(page.getByLabel('Valor da comparação')).toHaveCount(0);
    await expect(page.locator('.react-flow__node-condition')).toContainText(`${label} está ${field === 'lead.origin' ? 'preenchida' : 'preenchido'}`);
    await page.route('**/functions/v1/test-guided-condition', route => {
      expect(route.request().postDataJSON().condition).toEqual({ version: 1, id: 'rule-1', field, operator: 'is_not_empty' });
      return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual }] } });
    });
    await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
    await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Sim');
    await page.getByRole('button', { name: 'Adicionar condição', exact: true }).click();
    await page.getByRole('button', { name: 'Duplicar regra', exact: true }).first().click();
    await expect(page.getByRole('combobox', { name: 'Comparação', exact: true }).nth(1)).toBeFocused();
  });
}


for (const [field, label, value, manual] of [
  ['segment', 'Segmento', 'Distribuição', 'Indústria'],
  ['urgency', 'Urgência', 'Alta prioridade', 'Próximo trimestre'],
  ['faturamento', 'Faturamento informado', 'r$100_mil_a_r$150_mil', 'Mais de R$ 1 milhão'],
]) test(`seleciona ${label} com sugestões e preserva texto informado`, async ({ page }) => {
  await openGuidedEditor(page, '');
  await page.route('**/rest/v1/leads?*', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('select') !== field) return route.fulfill({ json: [{ id: 'lead-1', name: 'José' }] });
    expect(params.get('organization_id')).toBe('eq.org-1');
    expect(params.get('deleted_at')).toBe('is.null');
    expect(params.get('limit')).toBe('25');
    return route.fulfill({ json: [{ [field]: value }] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, `lead.${field}`);
  const picker = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
  await picker.click();
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(page.locator('.react-flow__node-condition')).toContainText(`${label} é igual a “${value}”`);
  await picker.click();
  await page.getByPlaceholder('Buscar ou digitar valor…').fill(manual);
  await page.getByRole('option', { name: `Usar "${manual}"`, exact: true }).click();
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toEqual({ version: 1, id: 'rule-1', field: `lead.${field}`, operator: 'equals', value: manual });
    return route.fulfill({ json: { status: 'evaluated', matched: false, rules: [{ id: 'rule-1', status: 'evaluated', matched: false, actual: value }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(value);
  await expect(page.getByRole('option', { name: 'é maior que', exact: true })).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_not_empty');
  await expect(page.getByRole('combobox', { name: 'Valor da comparação', exact: true })).toHaveCount(0);
});

test('encontra informação por vocabulário comercial e seleciona pelo teclado', async ({ page }) => {
  await page.route('**/rest/v1/guided_responsible_members?*', route => route.fulfill({ json: [] }));
  await openGuidedEditor(page, 'José');
  await page.getByText('Nome informado', { exact: true }).click();
  const information = page.getByRole('combobox', { name: 'Informação', exact: true });
  await information.focus();
  await information.press('Enter');
  const search = page.getByRole('combobox', { name: 'Buscar informação', exact: true });
  await expect(search).toBeFocused({ timeout: 3000 });
  await expect(page.getByRole('group', { name: 'Lead', exact: true })).toBeVisible();
  await search.fill('VENDEDOR');
  await expect(page.getByRole('option', { name: 'Responsável de vendas', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Nome', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Responsável de pré-vendas', exact: true })).toHaveCount(0);
  await search.press('Enter');
  await expect(information).toContainText('Responsável de vendas');
  await expect(information).toBeFocused();
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_not_empty');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Responsável de vendas está preenchido');
});


async function selectInformation(page: Page, field: string) {
  const labels: Record<string, string> = {
    'lead.name': 'Nome', 'lead.company': 'Empresa', 'lead.email': 'Email', 'lead.phone': 'Telefone',
    'lead.segment': 'Segmento', 'lead.urgency': 'Urgência', 'lead.faturamento': 'Faturamento informado',
    'lead.qualification_score': 'Pontuação de qualificação', 'lead.tags': 'Tags', 'lead.origin': 'Origem',
    'lead.pre_sale_responsible_id': 'Responsável de pré-vendas', 'lead.sale_responsible_id': 'Responsável de vendas',
    'lead.utm_source': 'UTM Source', 'lead.utm_medium': 'UTM Medium', 'lead.utm_content': 'UTM Content',
    'lead.utm_term': 'UTM Term', 'lead.utm_campaign': 'UTM Campaign',
    'business.trigger.stage': 'Etapa',
    'business.trigger.value': 'Valor',
    'business.trigger.stage_elapsed': 'Tempo na etapa',
    'business.exists': 'Existe negócio',
    'business.last_won_date': 'Data da última venda ganha',
    'message.trigger.text': 'Texto da mensagem do gatilho',
    'message.period.exists': 'Mensagem recebida no período',
    'message.search.text': 'Conteúdo de mensagens',
    'message.waiting.elapsed': 'Tempo aguardando resposta',
  };
  if (!labels[field]) throw new Error(`Missing test label for ${field}`);
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('option', { name: labels[field], exact: true }).click();
}

test('configura tempo aguardando resposta com seletores e mostra a âncora sem conteúdo', async ({ page }) => {
  const boxId = 'abcd0000-0000-4000-8000-000000000094';
  const operations: string[] = [];
  await page.route('**/rest/v1/whatsapp_instances?*', route => route.fulfill({ json: [{ id: boxId, instance_name: 'Comercial', provider: 'uazapi' }] }));
  await page.route('**/rest/v1/messaging_channels?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    operations.push('save');
    expect(route.request().postDataJSON().p_definition.nodes[1].data.guidedCondition).toMatchObject({
      field: 'message.waiting.elapsed', waitingFor: 'lead', value: 90, unit: 'minutes',
    });
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await page.route('**/functions/v1/publish-guided-workflow', route => {
    operations.push('publish');
    return route.fulfill({ json: { status: 'published', version_id: 'version-waiting', version_number: 2 } });
  });
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'message.waiting.elapsed');
  const configuration = page.getByRole('complementary', { name: 'Configurar Condição' });
  await configuration.getByLabel('Conversa', { exact: true }).selectOption('explicit');
  await configuration.getByLabel('Caixa de entrada').selectOption(`whatsapp_messages:${boxId}:uazapi`);
  await configuration.getByLabel('Quem está aguardando').selectOption('lead');
  await configuration.getByLabel('Comparação', { exact: true }).selectOption('greater_than_or_equal');
  await configuration.getByLabel('Tempo').fill('90');
  await configuration.getByLabel('Unidade').selectOption('minutes');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Lead aguardando resposta · desde a primeira mensagem sem resposta · é maior ou igual a 90 minutos');
  let evaluations = 0;
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ condition: { field: 'message.waiting.elapsed', waitingFor: 'lead',
      operator: 'greater_than_or_equal', value: 90, unit: 'minutes', conversation: { kind: 'explicit', boxId, provider: 'uazapi' } } });
    if (evaluations++ > 0) return route.fulfill({ status: 422, json: { status: 'error', code: 'history_insufficient' } });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 120,
      reference: { messageId: 'abcd0000-0000-4000-8000-000000000093', messageAt: '2026-09-10T10:00:00Z', direction: 'incoming', provider: 'uazapi', boxId, participantId: '5511999990000' } }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Âncora: primeira mensagem sem resposta');
  await expect(page.getByRole('status')).not.toContainText('conteúdo irrelevante');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Teste da condição' }).getByRole('alert')).toContainText('Histórico insuficiente para localizar o início da espera');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 2 publicada.')).toBeVisible();
  expect(operations).toEqual(['save', 'publish']);
});

test('monta busca de mensagens com seletores, chips e proveniência', async ({ page }) => {
  const boxId = 'abcd0000-0000-4000-8000-000000000097';
  const messageId = 'abcd0000-0000-4000-8000-000000000096';
  await page.route('**/rest/v1/whatsapp_instances?*', route => route.fulfill({ json: [
    { id: boxId, instance_name: 'Comercial', provider: 'uazapi' },
  ] }));
  await page.route('**/rest/v1/messaging_channels?*', route => route.fulfill({ json: [] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'message.search.text');
  const configuration = page.getByRole('complementary', { name: 'Configurar Condição' });
  await expect(configuration.getByLabel('Conversa', { exact: true })).not.toContainText('Caixa específica');
  const expression = configuration.getByLabel('Palavra ou expressão', { exact: true });
  await expression.fill('preço final');
  await expression.press('Enter');
  await expression.fill('cotação');
  await expression.press('Enter');
  await expect(configuration.getByRole('list', { name: 'Expressões configuradas' })).toContainText('preço final');
  await configuration.getByRole('button', { name: 'Remover cotação' }).click();
  await expect(configuration.getByRole('button', { name: 'Remover cotação' })).toHaveCount(0);
  await expression.fill('cotação');
  await configuration.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expression.fill('PREÇO,   FINAL');
  await expect(configuration.getByRole('button', { name: 'Adicionar', exact: true })).toBeDisabled();
  await expression.fill('');
  await configuration.getByLabel('Origem da mensagem').selectOption('period');
  await configuration.getByLabel('Conversa', { exact: true }).selectOption('explicit');
  await configuration.getByLabel('Caixa de entrada').selectOption(`whatsapp_messages:${boxId}:uazapi`);
  await configuration.getByLabel('Comparação', { exact: true }).selectOption('not_matches');
  await configuration.getByLabel('Combinação', { exact: true }).selectOption('all');
  await configuration.getByLabel('Modo de correspondência').selectOption('substring');
  await configuration.getByLabel('De', { exact: true }).fill('2026-09-01T00:00');
  await configuration.getByLabel('Até', { exact: true }).fill('2026-09-08T00:00');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Não contém “preço final” E “cotação” · trecho');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ condition: {
      field: 'message.search.text', source: { kind: 'period' }, operator: 'not_matches', expressionMatch: 'all',
      matchMode: 'substring', expressions: ['preço final', 'cotação'],
      conversation: { kind: 'explicit', storage: 'whatsapp_messages', boxId, provider: 'uazapi', boxLabel: 'Comercial' },
    } });
    return route.fulfill({ json: { status: 'evaluated', matched: false, rules: [{ id: 'rule-1', status: 'evaluated', matched: false,
      actual: true, reference: { messageId, textSource: 'transcription', textProvider: 'gemini', textCreatedAt: '2026-09-07T12:00:00Z',
        provider: 'uazapi', boxId, participantId: '5511999990000' } }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Fonte: transcrição persistida · gemini');
});

test('bloqueia negação de busca quando histórico não prova ausência', async ({ page }) => {
  const condition: GuidedConditionDraft = { version: 1, id: 'rule-1', field: 'message.search.text',
    conversation: { kind: 'explicit', storage: 'whatsapp_messages', boxId: 'abcd0000-0000-4000-8000-000000000095', provider: 'uazapi', boxLabel: 'Comercial' },
    source: { kind: 'period', from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' }, operator: 'not_matches',
    expressionMatch: 'any', matchMode: 'whole_phrase', expressions: ['preço'] };
  await page.route('**/rest/v1/whatsapp_instances?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/messaging_channels?*', route => route.fulfill({ json: [] }));
  await openGuidedEditor(page, condition);
  await page.getByText('Não contém “preço”', { exact: false }).click();
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({ status: 422,
    json: { status: 'error', code: 'history_insufficient' } }));
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Teste da condição' }).getByRole('alert')).toContainText('Histórico insuficiente');
});

test('salva e publica busca textual guiada completa', async ({ page }) => {
  const condition: GuidedConditionDraft = { version: 1, id: 'rule-1', field: 'message.search.text', conversation: { kind: 'trigger' },
    source: { kind: 'trigger' }, operator: 'matches', expressionMatch: 'any', matchMode: 'whole_phrase', expressions: ['preço'] };
  const operations: string[] = [];
  await page.route('**/rest/v1/rpc/save_guided_workflow_draft_with_settings', route => {
    operations.push('save');
    expect(route.request().postDataJSON().p_definition.nodes[1].data.guidedCondition).toMatchObject({
      field: 'message.search.text', source: { kind: 'trigger' }, expressions: ['preço', 'cotação'],
    });
    return route.fulfill({ json: { workflow_id: 'workflow-1', revision: 4 } });
  });
  await page.route('**/functions/v1/publish-guided-workflow', route => {
    operations.push('publish');
    expect(route.request().postDataJSON()).toEqual({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 4 });
    return route.fulfill({ json: { status: 'published', version_id: 'version-search', version_number: 2 } });
  });
  await openGuidedEditor(page, condition);
  await page.getByText('Contém “preço”', { exact: false }).click();
  const expression = page.getByLabel('Palavra ou expressão', { exact: true });
  await expression.fill('cotação');
  await expression.press('Enter');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 2 publicada.')).toBeVisible();
  expect(operations).toEqual(['save', 'publish']);
});

test('explica histórico insuficiente na busca de mensagem por período', async ({ page }) => {
  const boxId = 'abcd0000-0000-4000-8000-000000000098';
  await page.route('**/rest/v1/whatsapp_instances?*', route => route.fulfill({ json: [
    { id: boxId, instance_name: 'Comercial', provider: 'uazapi' },
  ] }));
  await page.route('**/rest/v1/messaging_channels?*', route => route.fulfill({ json: [] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'message.period.exists');
  const configuration = page.getByRole('complementary', { name: 'Configurar Condição' });
  await configuration.getByLabel('Conversa', { exact: true }).selectOption('explicit');
  await configuration.getByLabel('Caixa de entrada', { exact: true }).selectOption(`whatsapp_messages:${boxId}:uazapi`);
  await configuration.getByLabel('Comparação', { exact: true }).selectOption('not_exists');
  await configuration.getByLabel('De', { exact: true }).fill('2026-09-01T00:00');
  await configuration.getByLabel('Até', { exact: true }).fill('2026-09-08T00:00');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ condition: { field: 'message.period.exists', operator: 'not_exists',
      conversation: { kind: 'explicit', storage: 'whatsapp_messages', boxId, provider: 'uazapi' } } });
    return route.fulfill({ status: 422, json: { status: 'error', code: 'history_insufficient' } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Teste da condição' }).getByRole('alert')).toContainText('Histórico insuficiente');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Não existe mensagem recebida');
});

test('fixa caixa e mensagem do gatilho e explica a proveniência do texto', async ({ page }) => {
  const boxA = 'abcd0000-0000-4000-8000-000000000081';
  const boxB = 'abcd0000-0000-4000-8000-000000000082';
  const messageId = 'abcd0000-0000-4000-8000-000000000083';
  const candidateRequests: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/whatsapp_instances?*', route => route.fulfill({ json: [
    { id: boxA, instance_name: 'Comercial', provider: 'uazapi' },
    { id: boxB, instance_name: 'Suporte', provider: 'evolution' },
  ] }));
  await page.route('**/rest/v1/messaging_channels?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/test_guided_condition_message_candidates', route => {
    const request = route.request().postDataJSON();
    candidateRequests.push(request);
    return route.fulfill({ json: request.p_box_id === boxA ? [{
      message_id: messageId, storage: 'whatsapp_messages', box_id: boxA, provider: 'uazapi',
      participant_id: '5511999990000', text_preview: 'Quero orçamento', text_source: 'caption',
      message_type: 'image', message_at: '2026-09-07T12:00:00Z',
    }] : [] });
  });
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'message.trigger.text');
  const configuration = page.getByRole('complementary', { name: 'Configurar Condição' });
  await expect(configuration.getByLabel('Conversa', { exact: true })).toHaveValue('trigger');
  await configuration.getByLabel('Conversa', { exact: true }).selectOption('explicit');
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  expect(candidateRequests).toEqual([]);
  await page.getByLabel('Caixa de entrada', { exact: true }).selectOption(`whatsapp_messages:${boxA}:uazapi`);
  await page.getByLabel('Texto esperado', { exact: true }).fill('orcamento');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Comercial · uazapi');
  await page.getByRole('combobox', { name: 'Mensagem que simula o gatilho' }).selectOption(messageId);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({
      condition: { field: 'message.trigger.text', operator: 'contains', value: 'orcamento', conversation: {
        kind: 'explicit', storage: 'whatsapp_messages', boxId: boxA, provider: 'uazapi', boxLabel: 'Comercial',
      } },
      messageContext: { storage: 'whatsapp_messages', messageId, boxId: boxA, provider: 'uazapi', participantId: '5511999990000' },
    });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: 'Quero orçamento', reference: { messageId, textSource: 'caption', textProvider: 'uazapi', textCreatedAt: '2026-09-07T12:00:00Z',
        provider: 'uazapi', boxId: boxA, participantId: '5511999990000' } }] } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Fonte: legenda · uazapi');

  await page.getByLabel('Caixa de entrada', { exact: true }).selectOption(`whatsapp_messages:${boxB}:evolution`);
  await expect(page.getByRole('combobox', { name: 'Mensagem que simula o gatilho' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Testar condição', exact: true })).toBeDisabled();
  await expect.poll(() => candidateRequests.at(-1)).toMatchObject({ p_box_id: boxB, p_provider: 'evolution', p_storage: 'whatsapp_messages' });
});

test('distingue mídia sem texto persistido durante o teste pessoal', async ({ page }) => {
  const boxId = 'abcd0000-0000-4000-8000-000000000091';
  const messageId = 'abcd0000-0000-4000-8000-000000000092';
  await page.route('**/rest/v1/rpc/test_guided_condition_message_candidates', route => route.fulfill({ json: [{
    message_id: messageId, storage: 'whatsapp_messages', box_id: boxId, provider: 'uazapi', participant_id: '5511999990000',
    text_preview: null, text_source: null, message_type: 'audio', message_at: '2026-09-07T12:00:00Z',
  }] }));
  await openGuidedEditor(page, {
    version: 1, id: 'rule-1', field: 'message.trigger.text', conversation: { kind: 'trigger' }, operator: 'is_empty',
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('combobox', { name: 'Mensagem que simula o gatilho' }).selectOption(messageId);
  await page.route('**/functions/v1/test-guided-condition', route => route.fulfill({
    status: 422, json: { status: 'error', code: 'message_text_unavailable' },
  }));
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Teste da condição' }).getByRole('alert'))
    .toContainText('Esta mídia não possui legenda nem transcrição persistida. A condição não gerou conteúdo novo.');
});

test('configura etapa com funil filtrado e testa o negócio exato do gatilho', async ({ page }) => {
  const pipelineId = 'abcd0000-0000-4000-8000-000000000031';
  const otherPipelineId = 'abcd0000-0000-4000-8000-000000000032';
  const stageId = 'abcd0000-0000-4000-8000-000000000033';
  const otherStageId = 'abcd0000-0000-4000-8000-000000000034';
  const entryId = 'abcd0000-0000-4000-8000-000000000035';
  await page.route('**/rest/v1/pipeline_display_config?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/pipelines?*', route => route.fulfill({ json: [
    { id: pipelineId, organization_id: 'org-1', name: 'Comercial', slug: 'comercial', type: 'custom', is_active: true, display_order: 0 },
    { id: otherPipelineId, organization_id: 'org-1', name: 'Renovação', slug: 'renovacao', type: 'custom', is_active: true, display_order: 1 },
  ] }));
  await page.route('**/rest/v1/pipeline_stages?*', route => {
    const pipeline = new URL(route.request().url()).searchParams.get('pipeline_id');
    return route.fulfill({ json: pipeline === `eq.${pipelineId}`
      ? [{ id: stageId, pipeline_id: pipelineId, stage_key: 'proposal', name: 'Proposta', position: 0 }]
      : [{ id: otherStageId, pipeline_id: otherPipelineId, stage_key: 'proposal', name: 'Proposta renovação', position: 0 }] });
  });
  await page.route('**/rest/v1/pipeline_entries?*', route => route.fulfill({ json: [
    { id: entryId, pipeline_id: pipelineId, stage_id: stageId },
  ] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'business.trigger.stage');
  await expect(page.getByRole('combobox', { name: 'Informação', exact: true })).toContainText('Negócio do gatilho · Etapa');
  await page.getByRole('combobox', { name: 'Funil', exact: true }).selectOption(pipelineId);
  await expect(page.getByRole('combobox', { name: 'Etapa', exact: true }).getByRole('option', { name: 'Proposta renovação' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Etapa', exact: true }).selectOption(stageId);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Negócio do gatilho · Etapa é “Comercial · Proposta”');
  await expect(page.getByText('Etapa do negócio do gatilho em execuções desta organização')).toBeVisible();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('combobox', { name: 'Negócio do gatilho', exact: true }).selectOption(entryId);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ entryId, condition: {
      field: 'business.trigger.stage', operator: 'equals', pipelineId, stageId,
    } });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: stageId, reference: { id: stageId, name: 'Proposta' }, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }] } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Comercial · Proposta');
});

test('configura valor numérico e mantém ausência distinta de zero no negócio do gatilho', async ({ page }) => {
  const pipelineId = 'abcd0000-0000-4000-8000-000000000041';
  const stageId = 'abcd0000-0000-4000-8000-000000000042';
  const entryId = 'abcd0000-0000-4000-8000-000000000043';
  await page.route('**/rest/v1/pipelines?*', route => route.fulfill({ json: [{ id: pipelineId, name: 'Comercial' }] }));
  await page.route('**/rest/v1/pipeline_stages?*', route => route.fulfill({ json: [{ id: stageId, name: 'Proposta' }] }));
  await page.route('**/rest/v1/pipeline_entries?*', route => route.fulfill({ json: [{ id: entryId, pipeline_id: pipelineId, stage_id: stageId }] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'business.trigger.value');
  await expect(page.getByRole('combobox', { name: 'Informação', exact: true })).toContainText('Negócio do gatilho · Valor');
  await page.getByLabel('Comparação', { exact: true }).selectOption('greater_than_or_equal');
  await page.getByLabel('Valor da comparação', { exact: true }).fill('1000.50');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Negócio do gatilho · Valor é maior ou igual a 1000.5');
  await expect(page.getByText('Valor do negócio do gatilho em execuções desta organização')).toBeVisible();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('combobox', { name: 'Negócio do gatilho', exact: true }).selectOption(entryId);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ entryId, condition: {
      field: 'business.trigger.value', operator: 'greater_than_or_equal', value: 1000.5,
    } });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: 1250.5, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }] } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Negócio do gatilho · Valor é maior ou igual a 1000.5');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Negócio do gatilho · Valor está vazio');
});

test('configura tempo corrido na etapa com unidade explícita e negócio exato', async ({ page }) => {
  const pipelineId = 'abcd0000-0000-4000-8000-000000000051';
  const stageId = 'abcd0000-0000-4000-8000-000000000052';
  const entryId = 'abcd0000-0000-4000-8000-000000000053';
  await page.route('**/rest/v1/pipelines?*', route => route.fulfill({ json: [{ id: pipelineId, name: 'Comercial' }] }));
  await page.route('**/rest/v1/pipeline_stages?*', route => route.fulfill({ json: [{ id: stageId, name: 'Proposta' }] }));
  await page.route('**/rest/v1/pipeline_entries?*', route => route.fulfill({ json: [{ id: entryId, pipeline_id: pipelineId, stage_id: stageId }] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'business.trigger.stage_elapsed');
  await expect(page.getByRole('combobox', { name: 'Informação', exact: true })).toContainText('Negócio do gatilho · Tempo na etapa');
  await expect(page.getByLabel('Comparação', { exact: true }).getByRole('option', { name: 'está vazio' })).toHaveCount(0);
  await page.getByLabel('Comparação', { exact: true }).selectOption('greater_than_or_equal');
  await page.getByLabel('Tempo', { exact: true }).fill('2');
  await page.getByLabel('Unidade', { exact: true }).selectOption('hours');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Negócio do gatilho · Tempo na etapa é maior ou igual a 2 horas');
  await expect(page.getByText('Tempo na etapa do negócio do gatilho em execuções desta organização')).toBeVisible();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('combobox', { name: 'Negócio do gatilho', exact: true }).selectOption(entryId);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ entryId, condition: {
      field: 'business.trigger.stage_elapsed', operator: 'greater_than_or_equal', value: 2, unit: 'hours',
    } });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: 2.08, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }] } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Tempo na etapa é maior ou igual a 2 horas');
  await page.getByLabel('Unidade', { exact: true }).selectOption('days');
  await expect(page.locator('.react-flow__node-condition')).toContainText('2 dias');
  await page.getByLabel('Tempo', { exact: true }).fill('-1');
  await expect(page.getByRole('button', { name: 'Testar condição', exact: true })).toBeDisabled();
  await expect(page.getByText('Informe um tempo igual ou maior que zero.')).toBeVisible();
});

test('configura existência usando ciclo visível e mantém todos os filtros no mesmo negócio', async ({ page }) => {
  const pipelineId = 'abcd0000-0000-4000-8000-000000000061';
  const stageId = 'abcd0000-0000-4000-8000-000000000062';
  const entryId = 'abcd0000-0000-4000-8000-000000000063';
  await page.route('**/rest/v1/pipeline_display_config?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/pipelines?*', route => route.fulfill({ json: [{ id: pipelineId, name: 'Comercial' }] }));
  await page.route('**/rest/v1/pipeline_stages?*', route => route.fulfill({ json: [{ id: stageId, pipeline_id: pipelineId, name: 'Proposta' }] }));
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'business.exists');
  await expect(page.getByRole('combobox', { name: 'Informação', exact: true })).toContainText('Negócios · Existe negócio');
  await expect(page.getByLabel('Ciclo do negócio', { exact: true })).toHaveValue('open');
  await expect(page.getByRole('option', { name: 'Em aberto', exact: true })).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Funil', exact: true }).selectOption(pipelineId);
  await page.getByRole('combobox', { name: 'Etapa', exact: true }).selectOption(stageId);
  await page.getByRole('button', { name: 'Adicionar filtro do negócio', exact: true }).click();
  await page.getByLabel('Informação do negócio 2', { exact: true }).selectOption('business.value');
  await page.getByLabel('Comparação do negócio 2', { exact: true }).selectOption('greater_than');
  await page.getByLabel('Valor do negócio 2', { exact: true }).fill('1000');
  await page.getByLabel('Ciclo do negócio', { exact: true }).selectOption('won');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Existe negócio · Ganho · Todas');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Comercial · Proposta');
  await expect(page.getByText('Ciclo, etapa e valor dos negócios de todos os leads desta organização')).toBeVisible();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await expect(page.getByRole('combobox', { name: 'Negócio do gatilho', exact: true })).toHaveCount(0);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ condition: {
      version: 1, id: 'rule-1', kind: 'business_exists', lifecycle: 'won', match: 'all', children: [
        { field: 'business.stage', operator: 'equals', pipelineId, stageId },
        { field: 'business.value', operator: 'greater_than', value: 1000 },
      ],
    } });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: entryId, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }] } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Existe negócio · Ganho · Todas');
});

test('configura a última venda que permanece ganha por data e mostra o negócio encontrado', async ({ page }) => {
  const dealId = 'abcd0000-0000-4000-8000-000000000071';
  await openGuidedEditor(page, 'JOSE');
  await page.getByText('Nome informado', { exact: true }).click();
  await selectInformation(page, 'business.last_won_date');
  await expect(page.getByRole('combobox', { name: 'Informação', exact: true })).toContainText('Negócios · Data da última venda ganha');
  await page.getByLabel('Comparação', { exact: true }).selectOption('on_or_after');
  await page.getByLabel('Valor da comparação', { exact: true }).fill('2026-08-20');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Última venda ganha · Data é a partir de 20/08/2026');
  await expect(page.getByText('Data da última venda ganha de todos os leads desta organização')).toBeVisible();
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await expect(page.getByRole('combobox', { name: 'Negócio do gatilho', exact: true })).toHaveCount(0);
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON()).toMatchObject({ condition: {
      field: 'business.last_won_date', operator: 'on_or_after', value: '2026-08-20',
    } });
    expect(route.request().postDataJSON()).not.toHaveProperty('entryId');
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: '2026-08-21', reference: { id: dealId, name: 'Contrato anual' } }] } });
  });
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Contrato anual');
  await expect(page.getByRole('status')).toContainText('21/08/2026');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_empty');
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Última venda ganha · Data está vazia');
});

test('busca informação sem acento e cancela sem perder comparação', async ({ page }) => {
  await openGuidedEditor(page, 'José');
  await page.getByText('Nome informado', { exact: true }).click();
  const information = page.getByRole('combobox', { name: 'Informação', exact: true });
  await information.click();
  const search = page.getByRole('combobox', { name: 'Buscar informação', exact: true });
  await search.fill('  QUALIFICACAO  ');
  await expect(page.getByRole('option', { name: 'Pontuação de qualificação', exact: true })).toBeVisible();
  await search.fill('campo inexistente xyz');
  await expect(page.getByText('Nenhuma informação encontrada. Tente outro termo.')).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Informações disponíveis' }).getByRole('option')).toHaveCount(0);
  await search.press('Escape');
  await expect(information).toBeFocused();
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('José');
  await information.click();
  await expect(search).toHaveValue('');
  await page.getByRole('option', { name: 'Nome', exact: true }).click();
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('José');
  await expect(page.getByText('A informação mudou. Defina uma nova comparação.')).toHaveCount(0);
});

test('seleciona campo personalizado pelo nome e testa preservando UUID', async ({ page }) => {
  const fieldId = 'abcd0000-0000-4000-8000-000000000022';
  await openGuidedEditor(page, 'elétrica');
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('organization_id')).toBe('eq.org-1');
    const field = { id: fieldId, field_name: 'Especialidade', field_type: 'text' };
    if (params.has('id')) return route.fulfill({ json: field });
    expect(params.get('limit')).toBe('25');
    expect(params.get('field_type')).toBe('in.(text,number,boolean,date,select)');
    return route.fulfill({ json: [field] });
  });
  await page.getByText('Nome informado', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Especialidade');
  await page.getByRole('option', { name: 'Especialidade', exact: true }).click({ timeout: 3000 });
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('elétrica');
  await page.getByLabel('Comparação', { exact: true }).selectOption('contains');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Especialidade contém “elétrica”');
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.custom', fieldId, fieldType: 'text', operator: 'contains', value: 'elétrica' });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [{ id: 'rule-1', status: 'evaluated', matched: true,
      actual: 'Distribuição elétrica', reference: { id: fieldId, name: 'Especialidade atual' } }] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Especialidade atual');
  await page.getByLabel('Comparação', { exact: true }).selectOption('is_not_empty');
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveCount(0);
  await expect(page.locator('.react-flow__node-condition')).toContainText('Especialidade está preenchido');
  for (const operator of ['is_empty', 'is_not_empty']) {
    await selectInformation(page, 'lead.company');
    await page.getByLabel('Comparação', { exact: true }).selectOption(operator);
    await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
    await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Especialidade');
    await page.getByRole('option', { name: 'Especialidade', exact: true }).click();
    await expect(page.getByLabel('Comparação', { exact: true })).toHaveValue(operator);
    await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveCount(0);
  }
});

test('falha na referência personalizada não vira catálogo vazio e recupera pelo mesmo UUID', async ({ page }) => {
  const fieldId = 'abcd0000-0000-4000-8000-000000000023';
  let recovered = false;
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.custom', fieldId, fieldType: 'text', fieldLabel: 'Especialidade antiga', operator: 'equals', value: 'Indústria' });
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    if (!new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: [] });
    return recovered ? route.fulfill({ json: { id: fieldId, field_name: 'Especialidade atual', field_type: 'text' } })
      : route.fulfill({ status: 503, json: { message: 'unavailable' } });
  });
  await page.reload();
  await page.getByText('Nome informado', { exact: true }).click();
  await expect(page.getByText('Não foi possível verificar o campo selecionado.')).toBeVisible();
  const information = page.getByRole('combobox', { name: 'Informação', exact: true });
  await expect(information).toContainText('Campo não verificado');
  await information.click();
  const search = page.getByRole('combobox', { name: 'Buscar informação', exact: true });
  await search.fill('Especialidade');
  await expect(page.getByText('Buscando campos personalizados…')).toHaveCount(0);
  await expect(page.getByText('Nenhuma informação encontrada. Tente outro termo.')).toHaveCount(0);
  await search.press('Escape');
  recovered = true;
  await page.getByRole('button', { name: 'Tentar verificar campo novamente' }).click();
  await expect(information).toContainText('Especialidade atual');
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('Indústria');
  await expect(page.locator('.react-flow__node-condition')).toContainText('Especialidade atual é igual a “Indústria”');
});

for (const [fieldType, comparison] of [['text', 'Indústria'], ['number', 10], ['boolean', false], ['date', '2024-02-29'], ['select', 'Indústria']] as const)
for (const state of ['removed', 'type_changed'] as const) test(`cadastro personalizado ${fieldType} ${state} exige escolha explícita de outro UUID`, async ({ page }) => {
  const oldId = 'abcd0000-0000-4000-8000-000000000024';
  const newId = 'abcd0000-0000-4000-8000-000000000025';
  await openGuidedEditor(page, { version: 1, id: 'rule-1', field: 'lead.custom', fieldId: oldId, fieldType, fieldLabel: 'Especialidade', operator: 'equals', value: comparison });
  await page.route('**/rest/v1/lead_custom_fields?*', route => {
    const requested = new URL(route.request().url()).searchParams.get('id');
    if (requested === `eq.${oldId}`) return route.fulfill({ json: state === 'removed' ? null : { id: oldId, field_name: 'Especialidade', field_type: fieldType === 'text' ? 'number' : 'text' } });
    if (requested) return route.fulfill({ json: { id: newId, field_name: 'Especialidade', field_type: fieldType, field_options: ['Indústria'] } });
    return route.fulfill({ json: [{ id: oldId, field_name: 'Especialidade', field_type: fieldType, field_options: ['Indústria'] }, { id: newId, field_name: 'Especialidade', field_type: fieldType, field_options: ['Indústria'] }] });
  });
  await page.reload();
  await page.getByText('Nome informado', { exact: true }).click();
  const message = state === 'removed' ? 'Campo removido ou sem acesso. Selecione outro campo.' : 'O tipo deste campo mudou. Selecione outra informação.';
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Informação', exact: true })).toContainText('Campo indisponível');
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('combobox', { name: 'Buscar informação', exact: true }).fill('Especialidade');
  await expect(page.getByRole('option', { name: 'Especialidade', exact: true })).toHaveCount(1);
  await page.getByRole('option', { name: 'Especialidade', exact: true }).click();
  await expect(page.getByText(message)).toHaveCount(0);
  if (fieldType === 'select') {
    const value = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
    await expect(value).toContainText('Selecione uma opção');
    await value.click();
    await page.getByRole('option', { name: 'Indústria', exact: true }).click();
  } else await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue(String(comparison));
  await page.route('**/functions/v1/test-guided-condition', route => {
    expect(route.request().postDataJSON().condition).toMatchObject({ field: 'lead.custom', fieldId: newId, fieldType, value: comparison });
    return route.fulfill({ json: { status: 'evaluated', matched: true, rules: [] } });
  });
  await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption('lead-1');
  await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
  await expect(page.getByRole('status')).toBeVisible();
});

test('troca de usuário não mostra nome personalizado da conta anterior durante nova consulta', async ({ page }) => {
  const fieldId = 'abcd0000-0000-4000-8000-000000000026';
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/lead_custom_fields?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id') ? { id: fieldId, field_name: 'Preferência da conta anterior', field_type: 'text' }
      : [{ id: fieldId, field_name: 'Preferência da conta anterior', field_type: 'text' }],
  }));
  await page.goto('/tests/browser/fixtures/guided-condition.html?identity-switch=1');
  const information = page.getByRole('combobox', { name: 'Informação', exact: true });
  await information.click();
  await page.getByRole('option', { name: 'Preferência da conta anterior', exact: true }).click();
  await expect(information).toContainText('Preferência da conta anterior');
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/lead_custom_fields?*', async route => {
    await gate;
    await route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } });
  });
  try {
    await page.getByRole('button', { name: 'Trocar usuário' }).click();
    await expect(information).toContainText('Consultando campo…', { timeout: 3000 });
    await expect(information).not.toContainText('Preferência da conta anterior');
  } finally { release?.(); }
  await expect(page.getByText('Não foi possível verificar o campo selecionado.')).toBeVisible();
});

test('seletor de informação expõe popup acessível e devolve foco após escolha pelo teclado', async ({ page }) => {
  await openGuidedEditor(page, 'Aurora');
  await page.getByText('Nome informado', { exact: true }).click();
  const information = page.getByRole('combobox', { name: 'Informação', exact: true });
  await information.focus();
  await information.press('Enter');
  const controls = await information.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  await expect(page.locator(`[id="${controls}"]`)).toBeVisible({ timeout: 3000 });
  await expect(information).toHaveAttribute('aria-haspopup', 'dialog');
  const list = page.getByRole('listbox', { name: 'Informações disponíveis', exact: true });
  await expect(list).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Buscar informação', exact: true });
  await expect(search).toBeFocused();
  await search.fill('empresa');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(information).toContainText('Empresa');
  await expect(information).toBeFocused();
  await expect(page.getByLabel('Valor da comparação', { exact: true })).toHaveValue('Aurora');
});

test('troca de usuário fecha opções abertas sem anunciar catálogo vazio durante consulta', async ({ page }) => {
  const fieldId = 'abcd0000-0000-4000-8000-000000000027';
  const field = { id: fieldId, field_name: 'Canal', field_type: 'select', field_options: ['Canal privado'] };
  await page.route('**/rest/v1/leads?*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/lead_custom_fields?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('id') ? field : [field],
  }));
  await page.goto('/tests/browser/fixtures/guided-condition.html?identity-switch=1');
  await page.getByRole('combobox', { name: 'Informação', exact: true }).click();
  await page.getByRole('option', { name: 'Canal', exact: true }).click();
  const value = page.getByRole('combobox', { name: 'Valor da comparação', exact: true });
  await value.click();
  await expect(value).toHaveAttribute('aria-haspopup', 'dialog');
  await page.getByRole('option', { name: 'Canal privado', exact: true }).click();
  await value.click();
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/lead_custom_fields?*', async route => {
    await gate;
    await route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } });
  });
  try {
    await page.getByRole('button', { name: 'Trocar usuário' }).focus();
    await page.getByRole('button', { name: 'Trocar usuário' }).press('Enter');
    await expect(value).toContainText('Consultando opções…');
    await expect(value).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Este campo não tem opções cadastradas.')).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Canal privado', exact: true })).toHaveCount(0);
  } finally { release?.(); }
  await expect(value).toContainText('Opções não verificadas');
  await expect(value).toBeDisabled();
});
