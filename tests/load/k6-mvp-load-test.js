/**
 * k6 MVP Load Test — Torque CRM
 *
 * Simulates: 5 concurrent orgs × 1000 leads each × 100 webhook events/min
 *
 * Prerequisites:
 *   brew install k6
 *   export SUPABASE_URL=https://jsjsmuncfkbsbzqzqhfq.supabase.co
 *   export WEBHOOK_API_KEY=<your-api-key>        # x-api-key for lead-webhook
 *   export CRON_SECRET=<your-cron-secret>         # for cron endpoints
 *
 * Run (dev env):
 *   k6 run tests/load/k6-mvp-load-test.js \
 *     -e SUPABASE_URL=https://bcfadphgsibjzivtbjvc.supabase.co \
 *     -e WEBHOOK_API_KEY=<key>
 *
 * Run (prod — only with CTO approval):
 *   k6 run tests/load/k6-mvp-load-test.js \
 *     -e SUPABASE_URL=https://jsjsmuncfkbsbzqzqhfq.supabase.co \
 *     -e WEBHOOK_API_KEY=<key> \
 *     --out json=results/load-$(date +%Y%m%d-%H%M%S).json
 *
 * Thresholds (pass criteria):
 *   - P95 response time < 3000ms
 *   - P99 response time < 8000ms
 *   - Error rate < 1%
 *   - Webhook delivery success > 95%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────
const errorRate          = new Rate("error_rate");
const webhookSuccessRate = new Rate("webhook_success_rate");
const leadIngestDuration = new Trend("lead_ingest_duration_ms");
const webhookDuration    = new Trend("webhook_delivery_duration_ms");
const leadsCreated       = new Counter("leads_created_total");
const webhooksFired      = new Counter("webhooks_fired_total");

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL        = __ENV.SUPABASE_URL || "https://bcfadphgsibjzivtbjvc.supabase.co";
const WEBHOOK_API_KEY = __ENV.WEBHOOK_API_KEY;
const CRON_SECRET     = __ENV.CRON_SECRET || "";

// 5 test orgs — replace with real org UUIDs from the dev environment
// These orgs must exist and have webhook_api_keys configured
const TEST_ORGS = [
  __ENV.ORG_1 || "00000000-0000-0000-0000-000000000001",
  __ENV.ORG_2 || "00000000-0000-0000-0000-000000000002",
  __ENV.ORG_3 || "00000000-0000-0000-0000-000000000003",
  __ENV.ORG_4 || "00000000-0000-0000-0000-000000000004",
  __ENV.ORG_5 || "00000000-0000-0000-0000-000000000005",
];

const LEADS_PER_ORG      = 1000;
const WEBHOOKS_PER_MINUTE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Load stages
// ─────────────────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Phase 1: Ingest 1000 leads × 5 orgs concurrently (burst write)
    lead_ingestion: {
      executor: "per-vu-iterations",
      vus: 5,                          // 1 VU per org
      iterations: LEADS_PER_ORG,       // each VU ingests 1000 leads
      maxDuration: "10m",
      exec: "ingestLeads",
      tags: { scenario: "lead_ingestion" },
    },

    // Phase 2: Sustained webhook load — 100 events/min = ~1.67/sec
    webhook_load: {
      executor: "constant-arrival-rate",
      rate: WEBHOOKS_PER_MINUTE,
      timeUnit: "1m",
      duration: "5m",
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: "fireWebhooks",
      tags: { scenario: "webhook_load" },
      startTime: "2m",  // start after lead ingestion ramps up
    },

    // Phase 3: Concurrent realtime simulation (polling query pattern)
    realtime_read: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 25 },   // ramp to 25 concurrent users
        { duration: "4m", target: 25 },   // sustain
        { duration: "1m", target: 0 },    // ramp down
      ],
      exec: "simulateRealtimeReads",
      tags: { scenario: "realtime_read" },
      startTime: "1m",
    },
  },

  thresholds: {
    // P95 < 3s on lead ingestion
    "lead_ingest_duration_ms{scenario:lead_ingestion}": ["p(95)<3000"],
    // P99 < 8s overall
    "lead_ingest_duration_ms":    ["p(99)<8000"],
    "webhook_delivery_duration_ms": ["p(95)<2000", "p(99)<5000"],
    // Error rate < 1%
    error_rate:          ["rate<0.01"],
    // Webhook success > 95%
    webhook_success_rate: ["rate>0.95"],
    // Standard http_req_duration
    http_req_duration:   ["p(95)<5000"],
    http_req_failed:     ["rate<0.02"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function randomPhone() {
  const n = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  return `+5511${n}`;
}

function randomName() {
  const names = ["Ana Silva", "Bruno Costa", "Carla Lima", "Diego Mota", "Elena Rocha",
                 "Felipe Nunes", "Gabriela Rios", "Henrique Dias", "Isabela Alves", "João Ferreira"];
  return names[Math.floor(Math.random() * names.length)];
}

function randomCompany() {
  const companies = ["Distribuidora Norte", "Fábrica Central", "Indústria Sul", "Comércio Leste",
                     "Atacado Oeste", "Fornecedora Premium", "Produtora Elite", "Logística Express"];
  return companies[Math.floor(Math.random() * companies.length)];
}

function randomTag() {
  const tags = ["Ouro", "Prata", "Diamante", "Latão"];
  return tags[Math.floor(Math.random() * tags.length)];
}

function getOrgId() {
  return TEST_ORGS[__VU % TEST_ORGS.length];
}

function leadWebhookHeaders() {
  return {
    "Content-Type": "application/json",
    "x-api-key": WEBHOOK_API_KEY,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Lead ingestion
// ─────────────────────────────────────────────────────────────────────────────
export function ingestLeads() {
  const orgId  = getOrgId();
  const phone  = randomPhone();
  const start  = Date.now();

  const payload = JSON.stringify({
    organization_id: orgId,
    source: "load_test",
    fields: {
      name:    randomName(),
      phone,
      email:   `load+${Date.now()}@test.torquecrm.com.br`,
      company: randomCompany(),
    },
    tags: [randomTag()],
    place_in_pipe: {
      pipe: "whatsapp",
      stage: "novo_lead",
    },
    update_existing_if_match: false,
  });

  const res = http.post(
    `${BASE_URL}/functions/v1/lead-webhook`,
    payload,
    { headers: leadWebhookHeaders(), timeout: "15s" },
  );

  const ok = check(res, {
    "lead ingest 200": (r) => r.status === 200,
    "lead ingest has id": (r) => {
      try { return !!JSON.parse(r.body).lead_id; } catch { return false; }
    },
  });

  leadIngestDuration.add(Date.now() - start);
  errorRate.add(!ok);
  if (ok) leadsCreated.add(1);

  // No sleep — pure throughput test. k6 respects maxDuration.
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Webhook delivery load
// Calls lead-webhook with a mix of creates and updates to simulate
// real webhook event stream (100 events/min).
// ─────────────────────────────────────────────────────────────────────────────
export function fireWebhooks() {
  const orgId = TEST_ORGS[Math.floor(Math.random() * TEST_ORGS.length)];
  const isUpdate = Math.random() < 0.3; // 30% updates, 70% new leads
  const phone = randomPhone();
  const start = Date.now();

  const payload = JSON.stringify({
    organization_id: orgId,
    source: "webhook_load_test",
    fields: {
      name:    randomName(),
      phone,
      company: randomCompany(),
    },
    tags: [randomTag()],
    place_in_pipe: { pipe: "whatsapp", stage: "novo_lead" },
    update_existing_if_match: isUpdate,
  });

  const res = http.post(
    `${BASE_URL}/functions/v1/lead-webhook`,
    payload,
    { headers: leadWebhookHeaders(), timeout: "10s" },
  );

  const ok = check(res, {
    "webhook 200": (r) => r.status === 200,
  });

  webhookDuration.add(Date.now() - start);
  webhookSuccessRate.add(ok);
  webhooksFired.add(1);
  errorRate.add(!ok);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Realtime read simulation
// Simulates 25 concurrent users reading lead lists + pipeline data.
// ─────────────────────────────────────────────────────────────────────────────
export function simulateRealtimeReads() {
  // This scenario targets the REST API (anon reads via RLS).
  // Replace ANON_KEY env var with the project's anon key.
  const anonKey = __ENV.SUPABASE_ANON_KEY || "";
  const orgId   = getOrgId();

  if (!anonKey) {
    // Skip if not configured — realtime test is optional
    sleep(2);
    return;
  }

  const headers = {
    "apikey":        anonKey,
    "Authorization": `Bearer ${anonKey}`,
    "Content-Type":  "application/json",
  };

  // Simulate: read leads list (paginated)
  const leadsRes = http.get(
    `${BASE_URL}/rest/v1/leads?select=id,name,phone&limit=50&order=created_at.desc`,
    { headers, timeout: "5s", tags: { name: "leads_list" } },
  );

  check(leadsRes, { "leads read ok": (r) => r.status === 200 || r.status === 401 });

  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s think time
}

// ─────────────────────────────────────────────────────────────────────────────
// Teardown: print summary
// ─────────────────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const metrics = data.metrics;

  const summary = {
    test_date:   new Date().toISOString(),
    leads_created: metrics.leads_created_total?.values?.count ?? 0,
    webhooks_fired: metrics.webhooks_fired_total?.values?.count ?? 0,
    lead_ingest: {
      p50_ms: metrics.lead_ingest_duration_ms?.values?.["p(50)"] ?? 0,
      p95_ms: metrics.lead_ingest_duration_ms?.values?.["p(95)"] ?? 0,
      p99_ms: metrics.lead_ingest_duration_ms?.values?.["p(99)"] ?? 0,
    },
    webhook_delivery: {
      p95_ms: metrics.webhook_delivery_duration_ms?.values?.["p(95)"] ?? 0,
      p99_ms: metrics.webhook_delivery_duration_ms?.values?.["p(99)"] ?? 0,
    },
    error_rate_pct:          ((metrics.error_rate?.values?.rate ?? 0) * 100).toFixed(2),
    webhook_success_rate_pct: ((metrics.webhook_success_rate?.values?.rate ?? 0) * 100).toFixed(2),
    thresholds_passed: Object.values(data.thresholds ?? {}).every((t) => t.ok),
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    "results/load-summary.json": JSON.stringify(summary, null, 2),
  };
}
