// Seed dev DB with 10 sample leads from prod (org Milennials)
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/seed-dev-leads.mjs

import fs from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const DEV = "bcfadphgsibjzivtbjvc";
const PROD = "jsjsmuncfkbsbzqzqhfq";
const DEV_PIPELINE_ID = "f875bafe-f6e3-4ac4-ad4e-779175e8e619";
const STAGES = ["novo", "abordado", "respondeu", "conversando_copilot", "agendado"];

async function q(project, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, data: await r.json() };
}

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

const SAMPLE_QUERY = `
  SELECT id, name, company, email, phone, origin, segment, urgency,
         faturamento, notes, rating, qualification_score,
         utm_campaign, utm_source, utm_medium, utm_content, utm_term,
         meta_ad_id, meta_adset_id, meta_campaign_id, created_at
  FROM leads
  WHERE organization_id='${ORG}'
    AND name IS NOT NULL
    AND phone IS NOT NULL
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 10
`;

const { data: leads } = await q(PROD, SAMPLE_QUERY);
console.log(`Loaded ${leads.length} leads from prod`);

if (leads.length === 0) {
  console.error("No leads found in prod");
  process.exit(1);
}

const leadsValues = leads.map(l => `(${[
  esc(l.id), esc(ORG), esc(l.name), esc(l.company), esc(l.email),
  esc(l.phone), esc(l.origin), esc(l.segment), esc(l.urgency),
  esc(l.faturamento), esc(l.notes), esc(l.rating), esc(l.qualification_score),
  esc(l.utm_campaign), esc(l.utm_source), esc(l.utm_medium),
  esc(l.utm_content), esc(l.utm_term),
  esc(l.meta_ad_id), esc(l.meta_adset_id), esc(l.meta_campaign_id),
  esc(l.created_at),
].join(",")})`).join(",\n");

const insertLeads = `
  INSERT INTO public.leads (
    id, organization_id, name, company, email, phone, origin, segment, urgency,
    faturamento, notes, rating, qualification_score,
    utm_campaign, utm_source, utm_medium, utm_content, utm_term,
    meta_ad_id, meta_adset_id, meta_campaign_id, created_at
  ) VALUES
  ${leadsValues}
  ON CONFLICT (id) DO NOTHING
`;

const r1 = await q(DEV, insertLeads);
console.log(`Insert leads: status=${r1.status}`);
if (r1.status !== 201) console.log(JSON.stringify(r1.data).slice(0, 500));

const entryValues = leads.map((l, i) => {
  const stage = STAGES[i % STAGES.length];
  return `(gen_random_uuid(), ${esc(ORG)}, ${esc(DEV_PIPELINE_ID)}, ${esc(l.id)}, ${esc(stage)}, ${esc(l.created_at)})`;
}).join(",\n");

const insertEntries = `
  INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, entered_at)
  VALUES
  ${entryValues}
`;

const r2 = await q(DEV, insertEntries);
console.log(`Insert entries: status=${r2.status}`);
if (r2.status !== 201) console.log(JSON.stringify(r2.data).slice(0, 500));

// Verify
const { data: count } = await q(DEV, `SELECT count(*) FROM pipeline_entries WHERE pipeline_id='${DEV_PIPELINE_ID}'`);
console.log(`Total entries in dev whatsapp pipe:`, JSON.stringify(count));
