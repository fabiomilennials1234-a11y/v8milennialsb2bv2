import { expect, test } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

type StoredDefinition = {
  nodes: Array<{ data: { guidedCondition: { children: Array<{ value?: string }> } } }>;
};

test.describe('guided condition — real preview journey', () => {
  test.setTimeout(120_000);

  let service: SupabaseClient;
  let session: Session;
  let userId = '';
  const organizationId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();

  test.beforeAll(async () => {
    const ref = process.env.GUIDED_PREVIEW_REF;
    if (!ref || ['jsjsmuncfkbsbzqzqhfq', 'bcfadphgsibjzivtbjvc'].includes(ref)
      || process.env.SUPABASE_URL !== `https://${ref}.supabase.co`) {
      throw new Error('Refusing non-preview browser test target');
    }
    const auth = { persistSession: false, autoRefreshToken: false };
    service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { ...auth, storageKey: `guided-browser-service-${organizationId}` },
    });
    const email = `guided-browser-${crypto.randomUUID()}@example.test`;
    const password = `${crypto.randomUUID()}!Aa1`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    await service.from('organizations').insert({
      id: organizationId, name: 'Guided browser test', slug: `guided-browser-${organizationId}`,
    }).throwOnError();
    await service.from('org_quotas').upsert([
      { organization_id: organizationId, resource_key: 'max_users', plan_base: 2 },
      { organization_id: organizationId, resource_key: 'max_leads', plan_base: 20 },
    ], { onConflict: 'organization_id,resource_key' }).throwOnError();
    await service.from('team_members').insert({
      id: memberId, user_id: userId, organization_id: organizationId,
      name: 'Guided browser tester', role: 'admin', is_active: true,
    }).throwOnError();
    await service.from('leads').insert({
      id: leadId, organization_id: organizationId, name: 'José', company: 'Fábrica Aurora',
    }).throwOnError();

    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { ...auth, storageKey: `guided-browser-caller-${organizationId}` },
    });
    const signedIn = await caller.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('Session missing');
    session = signedIn.data.session;

    const definition = {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 400, y: 50 }, data: {
          type: 'trigger', label: 'Entrada', triggerType: 'lead_created', config: {},
        } },
        { id: 'condition-1', type: 'condition', position: { x: 400, y: 220 }, data: {
          type: 'condition', label: 'Nome informado', guidedCondition: {
            version: 1, id: 'group-1', kind: 'group', match: 'all', children: [
              { version: 1, id: 'rule-name', field: 'lead.name', operator: 'equals', value: 'JOSE' },
              { version: 1, id: 'rule-company', field: 'lead.company', operator: 'contains', value: 'Fábrica' },
            ],
          },
        } },
        { id: 'end-yes', type: 'end', position: { x: 250, y: 440 }, data: { type: 'end', label: 'Fim sim' } },
        { id: 'end-no', type: 'end', position: { x: 550, y: 440 }, data: { type: 'end', label: 'Fim não' } },
      ],
      edges: [
        { id: 'edge-trigger', source: 'trigger-1', target: 'condition-1' },
        { id: 'edge-yes', source: 'condition-1', target: 'end-yes', sourceHandle: 'yes' },
        { id: 'edge-no', source: 'condition-1', target: 'end-no', sourceHandle: 'no' },
      ],
    };
    const draft = await caller.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId,
      p_organization_id: organizationId,
      p_definition: definition,
      p_settings: { name: 'Qualificar lead real' },
    });
    if (draft.error) throw draft.error;
    const grant = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId,
      p_fields: ['lead.name', 'lead.company'],
      p_expected_revision: 0,
    });
    if (grant.error) throw grant.error;
  });

  test.afterAll(async () => {
    if (!service) return;
    const failures: unknown[] = [];
    try {
      const cleared = await service.from('organizations').update({ default_pipeline_id: null }).eq('id', organizationId);
      if (cleared.error) throw cleared.error;
      for (const table of ['workflows', 'leads', 'pipeline_stages', 'followup_reclassify_queue', 'pipelines']) {
        const removed = await service.from(table).delete().eq('organization_id', organizationId);
        if (removed.error) throw removed.error;
      }
      const removed = await service.from('organizations').delete().eq('id', organizationId);
      if (removed.error) throw removed.error;
    } catch (error) { failures.push(error); }
    if (userId) {
      const removed = await service.auth.admin.deleteUser(userId);
      if (removed.error) failures.push(removed.error);
    }
    if (failures.length) throw new AggregateError(failures, 'Real browser fixture cleanup failed');
  });

  test('configura, valida, resume, testa e publica duas versões imutáveis', async ({ page }) => {
    const ref = process.env.GUIDED_PREVIEW_REF!;
    await page.addInitScript(({ storageKey, storedSession }) => {
      localStorage.setItem(storageKey, JSON.stringify(storedSession));
    }, { storageKey: `sb-${ref}-auth-token`, storedSession: session });

    await page.goto(`/tests/browser/fixtures/guided-editor.html?workflow=${workflowId}`);
    await expect(page.getByText('Nome informado', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByText('Nome informado', { exact: true }).click();

    const values = page.getByLabel('Valor da comparação');
    await expect(values).toHaveCount(2);
    await values.first().fill('');
    await expect(values.first()).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Informe um valor ou escolha “está vazio”.')).toBeVisible();
    await values.first().fill('José');

    const collapse = page.getByRole('button', { name: 'Recolher grupo', exact: true });
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Configurar Condição').getByText(/Todas:.*Nome.*José.*Empresa.*Fábrica/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expandir grupo', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await page.getByRole('combobox', { name: 'Lead para testar' }).selectOption(leadId);
    await page.getByRole('button', { name: 'Testar condição', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Sim', { timeout: 30_000 });
    await expect(page.getByRole('status')).toContainText('José');
    await expect(page.getByRole('status')).toContainText('Empresa contém “Fábrica”: Sim');

    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.getByText('Versão 1 publicada.')).toBeVisible({ timeout: 30_000 });
    await values.first().fill('Maria');
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.getByText('Versão 2 publicada.')).toBeVisible({ timeout: 30_000 });

    const versions = await service.from('workflow_guided_versions')
      .select('version_number,definition').eq('workflow_id', workflowId).order('version_number');
    expect(versions.error).toBeNull();
    expect(versions.data?.map(version => version.version_number)).toEqual([1, 2]);
    const firstValue = (versions.data?.[0]?.definition as unknown as StoredDefinition).nodes[1].data.guidedCondition.children[0].value;
    const secondValue = (versions.data?.[1]?.definition as unknown as StoredDefinition).nodes[1].data.guidedCondition.children[0].value;
    expect([firstValue, secondValue]).toEqual(['José', 'Maria']);
  });
});
