// @vitest-environment node
/**
 * Catálogo de feature_permissions — paridade com produção.
 *
 * has_feature_permission() devolve COALESCE(override_do_membro, default_value_do_catálogo).
 * Se o catálogo local divergir do de produção, todo teste que exercita permissão
 * valida um comportamento que não existe em prod.
 *
 * A fonte de verdade abaixo foi MEDIDA em produção (jsjsmuncfkbsbzqzqhfq) em
 * 2026-08-17, não derivada da seed nem das migrations — senão a asserção
 * concordaria com o código por construção e nunca poderia discordar dele.
 *
 * Descoberta que motivou este teste: `supabase db reset` aplica todas as
 * migrations do repositório e produz 11 chaves. Produção tem 81. Nenhuma
 * migration do repositório cria as outras 70 — ambiente novo nasce sem 86%
 * do catálogo.
 *
 * Prerequisites: `supabase start` + `supabase db reset`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createServiceClient } from './rls-helpers';

interface CatalogRow {
  key: string;
  isAdminOnly: boolean;
  defaultValue: boolean;
}

/** Medido em produção 2026-08-17. Fonte de verdade independente do código. */
const PRODUCTION_CATALOG: CatalogRow[] = [
  { key: 'agenda.create', isAdminOnly: false, defaultValue: true },
  { key: 'agenda.delete', isAdminOnly: false, defaultValue: true },
  { key: 'agenda.edit', isAdminOnly: false, defaultValue: true },
  { key: 'agenda.view', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.create', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.delete', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.edit', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.import_leads', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.manage_stages', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.send_messages', isAdminOnly: false, defaultValue: true },
  { key: 'campaigns.view', isAdminOnly: false, defaultValue: true },
  { key: 'commissions.view', isAdminOnly: false, defaultValue: true },
  { key: 'commissions.view_all', isAdminOnly: false, defaultValue: true },
  { key: 'copilot.create', isAdminOnly: false, defaultValue: true },
  { key: 'copilot.delete', isAdminOnly: false, defaultValue: true },
  { key: 'copilot.edit', isAdminOnly: false, defaultValue: true },
  { key: 'copilot.toggle', isAdminOnly: false, defaultValue: true },
  { key: 'copilot.view', isAdminOnly: false, defaultValue: true },
  { key: 'copilot.view_metrics', isAdminOnly: false, defaultValue: true },
  { key: 'followups.bulk_archive', isAdminOnly: false, defaultValue: true },
  { key: 'followups.configure', isAdminOnly: false, defaultValue: true },
  { key: 'followups.delete', isAdminOnly: false, defaultValue: true },
  { key: 'followups.view', isAdminOnly: false, defaultValue: true },
  { key: 'leads.create', isAdminOnly: false, defaultValue: true },
  { key: 'leads.delete', isAdminOnly: false, defaultValue: true },
  { key: 'leads.edit', isAdminOnly: false, defaultValue: true },
  { key: 'leads.export', isAdminOnly: false, defaultValue: true },
  { key: 'leads.import', isAdminOnly: false, defaultValue: true },
  { key: 'leads.reassign', isAdminOnly: false, defaultValue: true },
  { key: 'leads.remove_from_pipe', isAdminOnly: false, defaultValue: true },
  { key: 'leads.view', isAdminOnly: false, defaultValue: true },
  { key: 'leads.view_all', isAdminOnly: false, defaultValue: true },
  { key: 'leads.view_general_info', isAdminOnly: false, defaultValue: true },
  { key: 'leads.view_subordinates', isAdminOnly: false, defaultValue: true },
  { key: 'leads.view_unassigned', isAdminOnly: false, defaultValue: true },
  { key: 'marketing.configure', isAdminOnly: false, defaultValue: true },
  { key: 'marketing.view', isAdminOnly: false, defaultValue: true },
  { key: 'performance.manage_awards', isAdminOnly: false, defaultValue: true },
  { key: 'performance.manage_goals', isAdminOnly: false, defaultValue: true },
  { key: 'performance.view', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.configure', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.custom_create', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.custom_delete', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.delete_all_stage', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.delete_cards', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.move_cards', isAdminOnly: false, defaultValue: true },
  { key: 'pipeline.view', isAdminOnly: false, defaultValue: true },
  { key: 'products.create', isAdminOnly: false, defaultValue: true },
  { key: 'products.delete', isAdminOnly: false, defaultValue: true },
  { key: 'products.edit', isAdminOnly: false, defaultValue: true },
  { key: 'products.import', isAdminOnly: false, defaultValue: true },
  { key: 'products.view', isAdminOnly: false, defaultValue: true },
  { key: 'settings.integrations', isAdminOnly: false, defaultValue: true },
  { key: 'settings.notifications', isAdminOnly: false, defaultValue: true },
  { key: 'settings.tags', isAdminOnly: false, defaultValue: true },
  { key: 'settings.view', isAdminOnly: false, defaultValue: true },
  { key: 'team.create_member', isAdminOnly: false, defaultValue: true },
  { key: 'team.delete_member', isAdminOnly: false, defaultValue: true },
  { key: 'team.edit_member', isAdminOnly: false, defaultValue: true },
  { key: 'team.manage_permissions', isAdminOnly: false, defaultValue: true },
  { key: 'team.view', isAdminOnly: false, defaultValue: true },
  { key: 'upsell.create', isAdminOnly: false, defaultValue: true },
  { key: 'upsell.move', isAdminOnly: false, defaultValue: true },
  { key: 'upsell.view', isAdminOnly: false, defaultValue: true },
  { key: 'voip.call.answer', isAdminOnly: false, defaultValue: true },
  { key: 'voip.call.dial_manual', isAdminOnly: false, defaultValue: false },
  { key: 'voip.call.start', isAdminOnly: false, defaultValue: true },
  { key: 'voip.session.manage', isAdminOnly: true, defaultValue: false },
  { key: 'whatsapp.archive', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.create_lead', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.delete', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.manage_instances', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.manage_tags', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.send_messages', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.toggle_copilot', isAdminOnly: false, defaultValue: true },
  { key: 'whatsapp.view', isAdminOnly: false, defaultValue: true },
  { key: 'workflows.create', isAdminOnly: false, defaultValue: true },
  { key: 'workflows.delete', isAdminOnly: false, defaultValue: true },
  { key: 'workflows.edit', isAdminOnly: false, defaultValue: true },
  { key: 'workflows.toggle', isAdminOnly: false, defaultValue: true },
  { key: 'workflows.view', isAdminOnly: false, defaultValue: true },];

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('feature_permissions: paridade com produção', () => {
  let local: Map<string, { isAdminOnly: boolean; defaultValue: boolean }>;

  beforeAll(async () => {
    const service = createServiceClient();
    const { data, error } = await service
      .from('feature_permissions')
      .select('key, is_admin_only, default_value');
    if (error) throw new Error(`Falha ao ler feature_permissions: ${error.message}`);
    local = new Map(
      (data ?? []).map((r) => [
        r.key as string,
        { isAdminOnly: r.is_admin_only as boolean, defaultValue: r.default_value as boolean },
      ]),
    );
  });

  it('lê o catálogo local — controle positivo', () => {
    expect(local.size).toBeGreaterThan(0);
  });

  it('tem todas as chaves que produção tem', () => {
    const missing = PRODUCTION_CATALOG.map((r) => r.key).filter((k) => !local.has(k));
    expect(missing).toEqual([]);
  });

  it('tem os mesmos default_value que produção', () => {
    const drift = PRODUCTION_CATALOG.filter(
      (r) => local.has(r.key) && local.get(r.key)!.defaultValue !== r.defaultValue,
    ).map((r) => `${r.key}: prod=${r.defaultValue} local=${local.get(r.key)!.defaultValue}`);
    expect(drift).toEqual([]);
  });

  it('tem os mesmos is_admin_only que produção', () => {
    const drift = PRODUCTION_CATALOG.filter(
      (r) => local.has(r.key) && local.get(r.key)!.isAdminOnly !== r.isAdminOnly,
    ).map((r) => `${r.key}: prod=${r.isAdminOnly} local=${local.get(r.key)!.isAdminOnly}`);
    expect(drift).toEqual([]);
  });

  it('leads.view_all está habilitado por padrão, como em produção', () => {
    // A política de isolamento de #1629 depende deste valor: com ela ligada, o
    // default global deixa de valer e só override explícito abre a visão. Se o
    // default local for false, o teste de "membro sem override não vê" passa
    // pelo motivo errado.
    expect(local.get('leads.view_all')).toEqual({ isAdminOnly: false, defaultValue: true });
  });
});
