/**
 * Integration tests — ghost-stage guard on the canonical system-entry API.
 *
 * Migration: 20261220000000_ghost_stage_guard_pipe_insert.sql
 *
 * Incidente (2026-06-17, "Dna de Almas"): lead caiu em stage_key='novo' numa org
 * migrada pro Funil B (novo DESATIVADA, novo_lead ATIVA) → invisível no Kanban.
 * Causa raiz: a escrita aceitava o status pedido sem validar contra as etapas
 * ATIVAS. A proteção precisa viver em fn_entrada_sistema_criar(), atual porta
 * pública de escrita depois da demolição das views pipe_*.
 *
 * Cenários:
 *   1. Funil B (novo inativa, novo_lead ativa) + criação status='novo'
 *      → coage para 'novo_lead'  (o bug exato da Flávia)
 *   2. Funil B + RPC create_lead_with_pipe(p_pipe_status='novo')
 *      → coage para 'novo_lead'  (path do webhook-new-lead que criou a Flávia)
 *   3. Funil B + criação status='abordado' (etapa ATIVA)
 *      → mantém 'abordado'        (não mexe em pedido válido)
 *   4. Org default-seed (só 'novo' ativa) + criação status='novo'
 *      → mantém 'novo'            (orgs default não regridem)
 *   5. Org sem nenhuma etapa whatsapp ativa + criação status='novo'
 *      → rejeita; nenhuma entrada fantasma é criada
 *
 * Requer:
 *   1. `supabase start` (Postgres em localhost:54322)
 *   2. Migration 20261220000000 aplicada (db reset / db push)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Client } from 'pg';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const PG_CONN =
  process.env.SUPABASE_DB_URL ||
  'postgres://postgres:postgres@localhost:54322/postgres';

const ORG_FUNIL_B   = '00000000-0000-0000-0000-0000000099a1';
const ORG_DEFAULT   = '00000000-0000-0000-0000-0000000099b2';
const ORG_NO_STAGES = '00000000-0000-0000-0000-0000000099c3';

let pg: Client;

async function ensureOrg(orgId: string) {
  await pg.query(
    `INSERT INTO public.organizations (id, name, slug)
     VALUES ($1, $2, $2) ON CONFLICT (id) DO NOTHING`,
    [orgId, `gs-${orgId.slice(-4)}`],
  );
}

async function ensureWhatsappPipeline(orgId: string): Promise<string> {
  await pg.query(
    `INSERT INTO public.pipelines (organization_id, name, slug, type, is_active)
     VALUES ($1, 'WhatsApp', 'whatsapp', 'system', true)
     ON CONFLICT (organization_id, slug) DO UPDATE SET is_active = true`,
    [orgId],
  );
  const { rows } = await pg.query(
    `SELECT id FROM public.pipelines
      WHERE organization_id = $1 AND slug = 'whatsapp' AND type = 'system' LIMIT 1`,
    [orgId],
  );
  return rows[0].id as string;
}

async function setStages(
  orgId: string,
  pipelineId: string,
  stages: { key: string; pos: number; active: boolean }[],
) {
  await pg.query(
    `DELETE FROM public.pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2`,
    [orgId, pipelineId],
  );
  for (const s of stages) {
    await pg.query(
      `INSERT INTO public.pipeline_stages
         (organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active)
       VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6)`,
      [orgId, pipelineId, s.key, s.key, s.pos, s.active],
    );
  }
}

async function createWhatsappEntry(orgId: string, leadId: string, stageKey: string) {
  return pg.query(
    `SELECT public.fn_entrada_sistema_criar(
       p_organization_id => $1,
       p_slug => 'whatsapp',
       p_lead_id => $2,
       p_stage_key => $3
     )`,
    [orgId, leadId, stageKey],
  );
}

async function makeLead(orgId: string, name: string): Promise<string> {
  // Insere com pipeline_entries manual logo após, para o trigger deferred
  // (auto-assign) não interferir. Aqui só precisamos do lead row.
  const { rows } = await pg.query(
    `INSERT INTO public.leads (name, origin, organization_id)
     VALUES ($1, 'outro', $2) RETURNING id`,
    [name, orgId],
  );
  return rows[0].id as string;
}

async function stageKeyOf(leadId: string): Promise<string | null> {
  const { rows } = await pg.query(
    `SELECT pe.stage_key
       FROM public.pipeline_entries pe
       JOIN public.pipelines p ON p.id = pe.pipeline_id
      WHERE pe.lead_id = $1 AND p.slug = 'whatsapp' AND p.type = 'system'
      ORDER BY pe.created_at DESC LIMIT 1`,
    [leadId],
  );
  return rows[0]?.stage_key ?? null;
}

async function cleanupLead(leadId: string) {
  await pg.query(`DELETE FROM public.pipeline_entries WHERE lead_id = $1`, [leadId]);
  await pg.query(`DELETE FROM public.leads WHERE id = $1`, [leadId]);
}

describe.skipIf(shouldSkip)('Ghost-stage guard — canonical system-entry API', () => {
  const createdLeadIds: string[] = [];

  beforeAll(async () => {
    pg = new Client({ connectionString: PG_CONN });
    await pg.connect();

    await ensureOrg(ORG_FUNIL_B);
    await ensureOrg(ORG_DEFAULT);
    await ensureOrg(ORG_NO_STAGES);

    const pipelineFunilB = await ensureWhatsappPipeline(ORG_FUNIL_B);
    const pipelineDefault = await ensureWhatsappPipeline(ORG_DEFAULT);
    const pipelineNoStages = await ensureWhatsappPipeline(ORG_NO_STAGES);

    // Funil B: 'novo' DESATIVADA, 'novo_lead' ATIVA (1ª), 'abordado' ATIVA
    await setStages(ORG_FUNIL_B, pipelineFunilB, [
      { key: 'novo', pos: 0, active: false },
      { key: 'novo_lead', pos: 1, active: true },
      { key: 'abordado', pos: 2, active: true },
    ]);
    // Default-seed: só 'novo' ativa
    await setStages(ORG_DEFAULT, pipelineDefault, [{ key: 'novo', pos: 0, active: true }]);
    // No-stages: nenhuma etapa whatsapp
    await setStages(ORG_NO_STAGES, pipelineNoStages, []);
  });

  afterAll(async () => {
    for (const id of createdLeadIds) await cleanupLead(id);
    for (const org of [ORG_FUNIL_B, ORG_DEFAULT, ORG_NO_STAGES]) {
      await pg.query(`UPDATE public.organizations SET default_pipeline_id = NULL WHERE id = $1`, [org]);
      await pg.query(`DELETE FROM public.pipeline_stages WHERE organization_id = $1`, [org]);
      await pg.query(`DELETE FROM public.followup_reclassify_queue WHERE organization_id = $1`, [org]);
      await pg.query(`DELETE FROM public.pipelines WHERE organization_id = $1`, [org]);
      await pg.query(`DELETE FROM public.organizations WHERE id = $1`, [org]);
    }
    await pg.end();
  });

  afterEach(async () => {
    while (createdLeadIds.length > 0) {
      const id = createdLeadIds.pop();
      if (id) await cleanupLead(id);
    }
  });

  it('cenário 1: Funil B + criação status="novo" → coage para "novo_lead"', async () => {
    const leadId = await makeLead(ORG_FUNIL_B, 'GhostGuard C1');
    createdLeadIds.push(leadId);
    // Remove a entry que o trigger deferred possa ter criado (org sem 'novo' ativa → no-op, mas garantimos).
    await pg.query(`DELETE FROM public.pipeline_entries WHERE lead_id = $1`, [leadId]);

    await createWhatsappEntry(ORG_FUNIL_B, leadId, 'novo');

    expect(await stageKeyOf(leadId)).toBe('novo_lead');
  });

  it('cenário 2: Funil B + RPC create_lead_with_pipe(p_pipe_status="novo") → "novo_lead"', async () => {
    const { rows } = await pg.query(
      `SELECT public.create_lead_with_pipe(
         p_name => 'GhostGuard C2 Flavia',
         p_origin => 'outro',
         p_organization_id => $1,
         p_pipe_type => 'whatsapp',
         p_pipe_status => 'novo'
       ) AS result`,
      [ORG_FUNIL_B],
    );
    const leadId = rows[0].result.lead_id as string;
    createdLeadIds.push(leadId);

    expect(await stageKeyOf(leadId)).toBe('novo_lead');
  });

  it('cenário 3: Funil B + criação status="abordado" (etapa ativa) → mantém "abordado"', async () => {
    const leadId = await makeLead(ORG_FUNIL_B, 'GhostGuard C3');
    createdLeadIds.push(leadId);
    await pg.query(`DELETE FROM public.pipeline_entries WHERE lead_id = $1`, [leadId]);

    await createWhatsappEntry(ORG_FUNIL_B, leadId, 'abordado');

    expect(await stageKeyOf(leadId)).toBe('abordado');
  });

  it('cenário 4: org default-seed (só "novo" ativa) + criação status="novo" → mantém "novo"', async () => {
    const leadId = await makeLead(ORG_DEFAULT, 'GhostGuard C4');
    createdLeadIds.push(leadId);
    await pg.query(`DELETE FROM public.pipeline_entries WHERE lead_id = $1`, [leadId]);

    await createWhatsappEntry(ORG_DEFAULT, leadId, 'novo');

    expect(await stageKeyOf(leadId)).toBe('novo');
  });

  it('cenário 5: org sem etapas ativas + criação status="novo" → rejeita sem criar entrada fantasma', async () => {
    const leadId = await makeLead(ORG_NO_STAGES, 'GhostGuard C5');
    createdLeadIds.push(leadId);
    await pg.query(`DELETE FROM public.pipeline_entries WHERE lead_id = $1`, [leadId]);

    await expect(createWhatsappEntry(ORG_NO_STAGES, leadId, 'novo'))
      .rejects.toThrow(/não possui etapa ativa/);

    expect(await stageKeyOf(leadId)).toBeNull();
  });
});
