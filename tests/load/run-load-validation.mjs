/**
 * MIL-12 Load Validation — Node.js (k6 fallback)
 * Fires 60 concurrent lead-webhook requests against __integration_test_org__
 * Validates: no P0 errors, P95 < 5s, success rate > 95%
 * Cleanup: deletes all leads with utm_source='load_test' after run
 *
 * Prerequisites:
 *   WEBHOOK_API_KEY=<value>                  # matches WEBHOOK_API_KEY Supabase secret
 *   SUPABASE_SERVICE_ROLE_KEY=<key>          # optional — enables cleanup
 *
 * Run:
 *   WEBHOOK_API_KEY=xxx node tests/load/run-load-validation.mjs
 */

const SUPABASE_URL = "https://jsjsmuncfkbsbzqzqhfq.supabase.co";
const ORG_ID       = "c84f4dea-6cfb-46f0-9802-76608c7c6bba"; // __integration_test_org__
const API_KEY      = process.env.WEBHOOK_API_KEY;
const CONCURRENCY  = 60;  // 5 orgs × 12 requests (scaled-down from 5×1000)
const TIMEOUT_MS   = 10_000;

if (!API_KEY) {
  console.error("Error: WEBHOOK_API_KEY env var required");
  console.error("  WEBHOOK_API_KEY=xxx node tests/load/run-load-validation.mjs");
  process.exit(1);
}

const names    = ["Ana Silva","Bruno Costa","Carla Lima","Diego Mota","Elena Rocha",
                  "Felipe Nunes","Gabriela Rios","Henrique Dias","Isabela Alves","Joao Ferreira"];
const tags     = ["Ouro","Prata","Diamante","Latao"];
const pipe     = ["whatsapp"];

function randomPhone(i) {
  return `+5511${String(9000000 + i).padStart(7, "0")}`;
}

async function sendLead(i) {
  const start = Date.now();
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lead-webhook`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-webhook-key": API_KEY,
      },
      body: JSON.stringify({
        organization_id: ORG_ID,
        source: "outro",
        fields: {
          name:    names[i % names.length],
          phone:   randomPhone(i),
          company: `LoadTest Co ${i}`,
          utm_source: "load_test",
        },
        tags: [tags[i % tags.length]],
        place_in_pipe: { pipe: "whatsapp", stage: "novo_lead" },
        update_existing_if_match: false,
      }),
    });

    const body = await res.json().catch(() => ({}));
    const ms   = Date.now() - start;
    return { ok: res.status === 200, status: res.status, ms, body };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - start, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function cleanup(serviceRoleKey) {
  if (!serviceRoleKey) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?organization_id=eq.${ORG_ID}&utm_source=eq.load_test`,
    {
      method: "DELETE",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Prefer": "return=minimal",
      },
    }
  );
  console.log(`Cleanup: ${res.status === 204 ? "OK" : res.status}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\nMIL-12 Load Validation — ${CONCURRENCY} concurrent requests`);
console.log(`Target: ${SUPABASE_URL}/functions/v1/lead-webhook`);
console.log(`Org: __integration_test_org__ (${ORG_ID})\n`);

const t0 = Date.now();
const results = await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, i) => sendLead(i))
);
const totalMs = Date.now() - t0;

// ── Metrics ───────────────────────────────────────────────────────────────────
const durations  = results.map(r => r.ms).sort((a, b) => a - b);
const successes  = results.filter(r => r.ok).length;
const failures   = results.filter(r => !r.ok);
const p50        = durations[Math.floor(durations.length * 0.50)];
const p95        = durations[Math.floor(durations.length * 0.95)];
const p99        = durations[Math.floor(durations.length * 0.99)] ?? durations[durations.length - 1];
const successPct = ((successes / CONCURRENCY) * 100).toFixed(1);
const errorRate  = (((CONCURRENCY - successes) / CONCURRENCY) * 100).toFixed(1);

console.log("── Results ─────────────────────────────────────────────────────");
console.log(`Total time:     ${totalMs}ms`);
console.log(`Requests:       ${CONCURRENCY}`);
console.log(`Successes:      ${successes} (${successPct}%)`);
console.log(`Failures:       ${failures.length} (${errorRate}%)`);
console.log(`P50:            ${p50}ms`);
console.log(`P95:            ${p95}ms`);
console.log(`P99:            ${p99}ms`);
console.log(`Min:            ${durations[0]}ms`);
console.log(`Max:            ${durations[durations.length - 1]}ms`);

if (failures.length > 0) {
  console.log("\n── Failures ────────────────────────────────────────────────────");
  failures.slice(0, 10).forEach((f, i) =>
    console.log(`  [${i + 1}] status=${f.status} ms=${f.ms} error=${f.error ?? JSON.stringify(f.body)?.slice(0, 120)}`)
  );
}

// ── Threshold checks ──────────────────────────────────────────────────────────
console.log("\n── Threshold Checks ────────────────────────────────────────────");
const checks = [
  { name: "Success rate > 95%",  pass: successes / CONCURRENCY >= 0.95 },
  { name: "Error rate < 5%",     pass: failures.length / CONCURRENCY < 0.05 },
  { name: "P95 < 5000ms",        pass: p95 < 5000 },
  { name: "P99 < 10000ms",       pass: p99 < 10000 },
  { name: "No P0 (5xx) errors",  pass: !failures.some(f => f.status >= 500) },
];

let allPass = true;
for (const c of checks) {
  const icon = c.pass ? "✓" : "✗";
  console.log(`  ${icon} ${c.name}`);
  if (!c.pass) allPass = false;
}

console.log(`\n${allPass ? "PASSED" : "FAILED"} — all thresholds ${allPass ? "met" : "not met"}`);

// ── Cleanup ───────────────────────────────────────────────────────────────────
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (svcKey) {
  process.stdout.write("\nCleaning up test leads... ");
  await cleanup(svcKey);
} else {
  console.log("\nSkipping cleanup (SUPABASE_SERVICE_ROLE_KEY not set)");
  console.log("Manual cleanup: DELETE FROM leads WHERE organization_id = '" + ORG_ID + "' AND utm_source = 'load_test';");
}

process.exit(allPass ? 0 : 1);
