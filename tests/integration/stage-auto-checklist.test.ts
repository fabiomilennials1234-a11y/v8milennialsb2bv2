/**
 * Integration test for stage auto-checklist trigger.
 *
 * Requires Supabase local stack running (supabase start) with the
 * 20260521120000_stage_auto_checklist migration applied. Skipped
 * automatically if SUPABASE_LOCAL_URL / SERVICE_ROLE env vars are
 * not set (e.g. CI without local stack).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL;
const SERVICE_ROLE = process.env.SUPABASE_LOCAL_SERVICE_ROLE;

const skipReason = !SUPABASE_URL || !SERVICE_ROLE
  ? "Set SUPABASE_LOCAL_URL + SUPABASE_LOCAL_SERVICE_ROLE to enable"
  : null;

describe.skipIf(skipReason)("stage auto-checklist trigger", () => {
  let admin: SupabaseClient;
  let orgId: string;
  let leadId: string;
  let templateId: string;
  let pipelineId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'torque-test-checklist-service' } });

    const { data: org, error: orgErr } = await admin.from("organizations")
      .insert({ name: `test-stage-checklist-${Date.now()}` })
      .select("id").single();
    if (orgErr) throw orgErr;
    orgId = org!.id;

    const { data: lead, error: leadErr } = await admin.from("leads")
      .insert({ organization_id: orgId, name: "Test Lead" })
      .select("id").single();
    if (leadErr) throw leadErr;
    leadId = lead!.id;

    const { data: tpl, error: tplErr } = await admin.from("checklists")
      .insert({ organization_id: orgId, title: "Onboarding template" })
      .select("id").single();
    if (tplErr) throw tplErr;
    templateId = tpl!.id;

    await admin.from("checklist_items").insert([
      { checklist_id: templateId, title: "Item A", position: 0 },
      { checklist_id: templateId, title: "Item B", position: 1 },
      { checklist_id: templateId, title: "Item C", position: 2 },
    ]);

    const { data: pipe } = await admin.from("pipelines")
      .upsert(
        { organization_id: orgId, slug: "whatsapp", type: "system", name: "whatsapp" },
        { onConflict: "organization_id,slug" },
      )
      .select("id").single();
    pipelineId = pipe!.id;
  });

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
  });

  beforeEach(async () => {
    // Clean lead-scoped checklists between tests
    await admin.from("checklists")
      .delete()
      .eq("lead_id", leadId)
      .not("source_template_id", "is", null);
    await admin.from("pipeline_entries")
      .delete()
      .eq("lead_id", leadId);
  });

  it("creates checklist + copies items in order when lead enters configured stage", async () => {
    await admin.from("pipeline_stages").upsert({
      organization_id: orgId,
      pipeline_type: "whatsapp",
      stage_key: "auto_test_stage",
      name: "Auto Test",
      position: 99,
      is_active: true,
      checklist_template_id: templateId,
    }, { onConflict: "organization_id,pipeline_type,stage_key" });

    const { error } = await admin.from("pipeline_entries").insert({
      organization_id: orgId,
      pipeline_id: pipelineId,
      lead_id: leadId,
      stage_key: "auto_test_stage",
    });
    expect(error).toBeNull();

    const { data: checklists } = await admin.from("checklists")
      .select("id, title, source_template_id")
      .eq("lead_id", leadId);

    expect(checklists).toHaveLength(1);
    expect(checklists![0].source_template_id).toBe(templateId);
    expect(checklists![0].title).toBe("Onboarding template");

    const { data: items } = await admin.from("checklist_items")
      .select("title, position")
      .eq("checklist_id", checklists![0].id)
      .order("position");

    expect(items).toHaveLength(3);
    expect(items!.map(i => i.title)).toEqual(["Item A", "Item B", "Item C"]);
  });

  it("stamps template_item_id lineage on each copied item (ADR-0016)", async () => {
    await admin.from("pipeline_stages").upsert({
      organization_id: orgId, pipeline_type: "whatsapp",
      stage_key: "auto_test_stage", name: "Auto Test", position: 99,
      is_active: true, checklist_template_id: templateId,
    }, { onConflict: "organization_id,pipeline_type,stage_key" });

    await admin.from("pipeline_entries").insert({
      organization_id: orgId, pipeline_id: pipelineId, lead_id: leadId,
      stage_key: "auto_test_stage",
    });

    const { data: checklist } = await admin.from("checklists")
      .select("id").eq("lead_id", leadId).eq("source_template_id", templateId).single();

    const { data: templateItems } = await admin.from("checklist_items")
      .select("id, title").eq("checklist_id", templateId);
    const tplByTitle = new Map(templateItems!.map(i => [i.title, i.id]));

    const { data: leadItems } = await admin.from("checklist_items")
      .select("title, template_item_id").eq("checklist_id", checklist!.id).order("position");

    expect(leadItems).toHaveLength(3);
    // Every copied item points back at the exact template item of the same title.
    for (const item of leadItems!) {
      expect(item.template_item_id).toBe(tplByTitle.get(item.title));
    }
  });

  it("is idempotent: moving away and back does not create a duplicate", async () => {
    await admin.from("pipeline_stages").upsert({
      organization_id: orgId, pipeline_type: "whatsapp",
      stage_key: "auto_test_stage", name: "Auto Test", position: 99,
      is_active: true, checklist_template_id: templateId,
    }, { onConflict: "organization_id,pipeline_type,stage_key" });

    await admin.from("pipeline_entries").insert({
      organization_id: orgId, pipeline_id: pipelineId, lead_id: leadId,
      stage_key: "auto_test_stage",
    });

    await admin.from("pipeline_entries")
      .update({ stage_key: "novo" })
      .eq("lead_id", leadId).eq("pipeline_id", pipelineId);

    await admin.from("pipeline_entries")
      .update({ stage_key: "auto_test_stage" })
      .eq("lead_id", leadId).eq("pipeline_id", pipelineId);

    const { data: checklists } = await admin.from("checklists")
      .select("id").eq("lead_id", leadId).eq("source_template_id", templateId);

    expect(checklists).toHaveLength(1);
  });

  it("no-op when stage has no template", async () => {
    await admin.from("pipeline_stages").upsert({
      organization_id: orgId, pipeline_type: "whatsapp",
      stage_key: "stage_no_tpl", name: "No Template", position: 100,
      is_active: true, checklist_template_id: null,
    }, { onConflict: "organization_id,pipeline_type,stage_key" });

    await admin.from("pipeline_entries").insert({
      organization_id: orgId, pipeline_id: pipelineId, lead_id: leadId,
      stage_key: "stage_no_tpl",
    });

    const { data: checklists } = await admin.from("checklists")
      .select("id").eq("lead_id", leadId);

    expect(checklists).toHaveLength(0);
  });

  it("cross-org safety: template from org A, lead from org B → no checklist created", async () => {
    const { data: orgB } = await admin.from("organizations")
      .insert({ name: `test-org-B-${Date.now()}` })
      .select("id").single();
    const { data: leadB } = await admin.from("leads")
      .insert({ organization_id: orgB!.id, name: "Lead B" })
      .select("id").single();
    const { data: pipeB } = await admin.from("pipelines").upsert({
      organization_id: orgB!.id, slug: "whatsapp", type: "system", name: "whatsapp"
    }, { onConflict: "organization_id,slug" }).select("id").single();

    // Stage exists only in org A; lead enters in org B with same key → JOIN finds nothing
    await admin.from("pipeline_entries").insert({
      organization_id: orgB!.id, pipeline_id: pipeB!.id, lead_id: leadB!.id,
      stage_key: "auto_test_stage",
    });

    const { data: checklistsB } = await admin.from("checklists")
      .select("id").eq("lead_id", leadB!.id);

    expect(checklistsB).toHaveLength(0);

    await admin.from("organizations").delete().eq("id", orgB!.id);
  });
});
