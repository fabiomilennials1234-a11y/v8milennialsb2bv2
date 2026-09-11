/**
 * Lead creation does not implicitly open a deal (current canonical contract).
 * Explicit system/custom entries survive commit without an extra default card.
 * Uses real PostgreSQL transactions to observe deferred effects after COMMIT.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Client } from 'pg';
import { supabase, TEST_ORG_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const PG_CONN =
  process.env.SUPABASE_DB_URL ||
  'postgres://postgres:postgres@localhost:54322/postgres';

const SCRATCH_ORG_NO_PIPELINE = '00000000-0000-0000-0000-0000000099f1';
const SCRATCH_ORG_NO_STAGE    = '00000000-0000-0000-0000-0000000099f2';

let pg: Client;

async function ensureScratchOrg(orgId: string) {
  await pg.query(
    // `slug` e NOT NULL e nao tem default. Sem ele o INSERT morre com 23502 e
    // a suite inteira cai antes da primeira assercao.
    `INSERT INTO public.organizations (id, name, slug)
     VALUES ($1, $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [orgId, `scratch-${orgId.slice(-4)}`],
  );
}

async function ensureNoWhatsappPipeline(orgId: string) {
  // Remove eventual pipeline system/whatsapp dessa org (evita seed/backfill).
  await pg.query(
    `DELETE FROM public.pipelines
      WHERE organization_id = $1 AND type = 'system' AND slug = 'whatsapp'`,
    [orgId],
  );
}

async function ensureWhatsappPipelineWithoutNovoStage(orgId: string) {
  // Garante pipeline whatsapp existe, mas stage 'novo' NÃO está ativo.
  await pg.query(
    `INSERT INTO public.pipelines (organization_id, name, slug, type, is_active)
     VALUES ($1, 'WhatsApp', 'whatsapp', 'system', true)
     ON CONFLICT (organization_id, slug) DO UPDATE SET is_active = true`,
    [orgId],
  );
  // Marca 'novo' como inativo (ou remove se existir).
  await pg.query(
    `DELETE FROM public.pipeline_stages
      WHERE organization_id = $1
        AND pipeline_id IN (SELECT id FROM public.pipelines WHERE organization_id = $1 AND slug = 'whatsapp')
        AND stage_key = 'novo'`,
    [orgId],
  );
}

async function cleanupLead(leadId: string) {
  await pg.query(`DELETE FROM public.pipeline_entries WHERE lead_id = $1`, [leadId]);
  await pg.query(`DELETE FROM public.leads WHERE id = $1`, [leadId]);
}

describe.skipIf(shouldSkip)('Lead creation — no implicit deal after commit', () => {
  const createdLeadIds: string[] = [];
  const createdPipelineIds: string[] = [];

  beforeAll(async () => {
    pg = new Client({ connectionString: PG_CONN });
    await pg.connect();
  });

  afterAll(async () => {
    // Limpa tudo que foi criado e scratch orgs.
    for (const id of createdLeadIds) {
      await cleanupLead(id);
    }
    for (const id of createdPipelineIds) {
      await pg.query(`DELETE FROM public.pipelines WHERE id = $1`, [id]);
    }
    await pg.query(`UPDATE public.organizations SET default_pipeline_id = NULL WHERE id IN ($1, $2)`, [SCRATCH_ORG_NO_PIPELINE, SCRATCH_ORG_NO_STAGE]);
    await pg.query(`DELETE FROM public.pipeline_stages WHERE organization_id IN ($1, $2)`, [SCRATCH_ORG_NO_PIPELINE, SCRATCH_ORG_NO_STAGE]);
    await pg.query(`DELETE FROM public.followup_reclassify_queue WHERE organization_id IN ($1, $2)`, [SCRATCH_ORG_NO_PIPELINE, SCRATCH_ORG_NO_STAGE]);
    await pg.query(`DELETE FROM public.pipelines WHERE organization_id IN ($1, $2)`, [
      SCRATCH_ORG_NO_PIPELINE,
      SCRATCH_ORG_NO_STAGE,
    ]);
    await pg.query(`DELETE FROM public.organizations WHERE id IN ($1, $2)`, [
      SCRATCH_ORG_NO_PIPELINE,
      SCRATCH_ORG_NO_STAGE,
    ]);
    await pg.end();
  });

  afterEach(async () => {
    while (createdLeadIds.length > 0) {
      const id = createdLeadIds.pop();
      if (id) await cleanupLead(id);
    }
  });

  it('cenário 1: INSERT lead sem negócio explícito não cria card', async () => {
    // org-A do seed tem pipeline whatsapp + stage 'novo' ativo.
    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        name: 'Auto-assign Cenario 1',
        phone: '+5511900090001',
        organization_id: TEST_ORG_ID,
      })
      .select('id, organization_id')
      .single();

    expect(error).toBeNull();
    expect(lead?.id).toBeTruthy();
    if (lead?.id) createdLeadIds.push(lead.id);

    const { rows } = await pg.query(
      `SELECT pe.stage_key, p.slug, p.type
         FROM public.pipeline_entries pe
         JOIN public.pipelines p ON p.id = pe.pipeline_id
        WHERE pe.lead_id = $1`,
      [lead!.id],
    );

    expect(rows).toHaveLength(0);
  });

  it('cenário 2: INSERT lead + INSERT pipeline_entries(novo) na MESMA tx → única entry, sem duplicação', async () => {
    const leadId = '00000000-0000-0000-0000-00000aa00002';
    createdLeadIds.push(leadId);

    // Resolve pipeline whatsapp da org de teste.
    const { rows: pipeRows } = await pg.query(
      `SELECT id FROM public.pipelines
        WHERE organization_id = $1 AND type = 'system' AND slug = 'whatsapp'`,
      [TEST_ORG_ID],
    );
    expect(pipeRows.length).toBe(1);
    const pipelineId = pipeRows[0].id;

    await pg.query('BEGIN');
    try {
      await pg.query(
        `INSERT INTO public.leads (id, name, phone, organization_id)
         VALUES ($1, 'Auto-assign Cenario 2', '+5511900090002', $2)`,
        [leadId, TEST_ORG_ID],
      );

      await pg.query(
        `INSERT INTO public.pipeline_entries (
           organization_id, pipeline_id, lead_id, stage_key, entered_at, stage_changed_at
         ) VALUES ($1, $2, $3, 'novo', NOW(), NOW())`,
        [TEST_ORG_ID, pipelineId, leadId],
      );

      await pg.query('COMMIT');
    } catch (e) {
      await pg.query('ROLLBACK');
      throw e;
    }

    const { rows } = await pg.query(
      `SELECT stage_key FROM public.pipeline_entries WHERE lead_id = $1`,
      [leadId],
    );

    // Commit does not add any implicit card beside the explicit entry.
    expect(rows).toHaveLength(1);
    expect(rows[0].stage_key).toBe('novo');
  });

  it('cenário 3: lead e negócio custom explícito na mesma tx não criam card de sistema', async () => {
    const leadId = '00000000-0000-0000-0000-00000aa00003';
    createdLeadIds.push(leadId);

    // Create a canonical custom pipeline and stage for this fixture.
    const customPipelineId = '00000000-0000-0000-0000-00000cc00003';
    const customStageId    = '00000000-0000-0000-0000-00000cc00103';
    createdPipelineIds.push(customPipelineId);

    await pg.query(
      `INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active)
       VALUES ($1, $2, 'CustomPipe', 'custom-auto-assign-c3', 'custom', true)`,
      [customPipelineId, TEST_ORG_ID],
    );
    await pg.query(
      `INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, stage_key, name, position, is_active)
       VALUES ($1, $2, $3, 'inicio', 'Início', 0, true)`,
      [customStageId, TEST_ORG_ID, customPipelineId],
    );

    await pg.query('BEGIN');
    try {
      await pg.query(
        `INSERT INTO public.leads (id, name, phone, organization_id)
         VALUES ($1, 'Auto-assign Cenario 3', '+5511900090003', $2)`,
        [leadId, TEST_ORG_ID],
      );

      await pg.query(
        `INSERT INTO public.pipeline_entries (
           organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at
         ) VALUES ($1, $2, $3, $4, 'inicio', NOW(), NOW())`,
        [TEST_ORG_ID, customPipelineId, leadId, customStageId],
      );

      await pg.query('COMMIT');
    } catch (e) {
      await pg.query('ROLLBACK');
      throw e;
    }

    const pipelineRows = await pg.query(
      `SELECT pipeline_id FROM public.pipeline_entries WHERE lead_id = $1`,
      [leadId],
    );
    expect(pipelineRows.rows).toEqual([{ pipeline_id: customPipelineId }]);

    const customRows = await pg.query(
      `SELECT stage_id FROM public.pipeline_entries WHERE lead_id = $1`,
      [leadId],
    );
    expect(customRows.rows).toHaveLength(1);
  });

  it('cenário 4: org sem pipeline whatsapp system → lead criado, sem entry, sem erro', async () => {
    await ensureScratchOrg(SCRATCH_ORG_NO_PIPELINE);
    await ensureNoWhatsappPipeline(SCRATCH_ORG_NO_PIPELINE);

    const leadId = '00000000-0000-0000-0000-00000aa00004';
    createdLeadIds.push(leadId);

    await pg.query(
      `INSERT INTO public.leads (id, name, phone, organization_id)
       VALUES ($1, 'Auto-assign Cenario 4', '+5511900090004', $2)`,
      [leadId, SCRATCH_ORG_NO_PIPELINE],
    );

    const leadRows = await pg.query(`SELECT id FROM public.leads WHERE id = $1`, [leadId]);
    expect(leadRows.rows).toHaveLength(1);

    const pipelineRows = await pg.query(
      `SELECT id FROM public.pipeline_entries WHERE lead_id = $1`,
      [leadId],
    );
    expect(pipelineRows.rows).toHaveLength(0);
  });

  it('cenário 5: org com pipeline whatsapp mas sem stage novo ativo → lead criado, sem entry, sem erro', async () => {
    await ensureScratchOrg(SCRATCH_ORG_NO_STAGE);
    await ensureWhatsappPipelineWithoutNovoStage(SCRATCH_ORG_NO_STAGE);

    const leadId = '00000000-0000-0000-0000-00000aa00005';
    createdLeadIds.push(leadId);

    await pg.query(
      `INSERT INTO public.leads (id, name, phone, organization_id)
       VALUES ($1, 'Auto-assign Cenario 5', '+5511900090005', $2)`,
      [leadId, SCRATCH_ORG_NO_STAGE],
    );

    const leadRows = await pg.query(`SELECT id FROM public.leads WHERE id = $1`, [leadId]);
    expect(leadRows.rows).toHaveLength(1);

    const pipelineRows = await pg.query(
      `SELECT id FROM public.pipeline_entries WHERE lead_id = $1`,
      [leadId],
    );
    expect(pipelineRows.rows).toHaveLength(0);
  });
});
