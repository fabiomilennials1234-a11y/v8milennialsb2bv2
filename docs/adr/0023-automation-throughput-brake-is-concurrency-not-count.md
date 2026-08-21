# 23. The automation throughput brake is bounded concurrency, and no send-rate brake replaces it

Date: 2026-08-20

## Status

Accepted

Relates to ADR-0015 (per-number daily cap) — which governs **Mass Send only** and does **not** cover
Workflow sends. That gap is the reason this ADR exists.

## Context

Two Organizations reported that automations "don't fire". Measured in production:

- Lag between trigger and first send: **p90 of 35–53 minutes**, worst case 250 minutes.
- `claim_workflow_executions` defaults `per_org_cap` to **5**; the only caller never passed the
  parameter, so every Organization was silently capped at **5 executions per minute**.
- A Workflow Execution takes **4.88s on average** (p99 85s), and **~94% of that is I/O wait** —
  3.38s per `action` node is the WhatsApp provider answering, plus literal `setTimeout` sleeps for
  short delay nodes. CPU is noise.
- The worker processed that I/O-bound load in a **sequential `for … await` loop**, so throughput was
  `1 ÷ 4.88s ≈ 12/min` per invocation regardless of batch size. Neither `batch_size` nor
  `per_org_cap` can buy throughput; they only govern how many rows enter the waiting room.
- The engine is idle **73% of all minutes**. Median contention is **1.15 Organizations per minute**.
  Capacity was never the constraint.

The crucial and uncomfortable part: because the `send-governor` runs in shadow (its decision is
always `allow`) and ADR-0015's per-number cap covers only Mass Send, **the accidental slowness was
the only thing rate-limiting automation sends to WhatsApp**. Nobody designed it as ban protection;
it became ban protection by accident. Removing it removes the protection.

Measured counter-evidence: the cap does not bound daily volume — one Organization sends ~2,870
messages/day against a cap that would permit 7,200. Demand is the limiter. What the cap bounds is
**burstiness**, and burstiness is what ban heuristics react to.

## Decision

1. **The brake changes shape: from a count per Organization per minute to a wall-clock budget plus
   bounded concurrency.** A count ages — 5 was sized for an older volume and silently strangled the
   product for months. A resource budget does not age, because the resource is the same.

2. **`per_org_cap` is raised to 1000 and ceases to be the brake.** Multi-tenant isolation moves to a
   *share of the concurrency pool* per Organization (`floor(pool / 2)`), which scales with the pool
   instead of being a second magic number.

3. **Pool size is set by a self-adjusting controller bounded to `[4, 16]`**, driven by **saturation**
   (did the invocation exhaust its budget with work still due?) and not by Lag. Lag is a lagging
   indicator: by the time it rises, the customer has already waited. Lag remains the metric humans
   read; it is not what closes the loop.

4. **No send-rate brake is introduced.** The interim per-instance rate limit was designed, costed,
   and **deliberately rejected**. Blocking this work until `send-governor` enforces was also
   rejected: that work is larger by design and the affected customers are hurting now.

5. **The ceiling of 16 is therefore the only ban protection that exists**, and `workflow_pool_mode =
   'pinned'` must beat the controller so the human override is real.

## Considered options

- **Interim per-instance send rate limit in the worker.** Rejected by the CTO. It would have bounded
  burst without touching daily volume, but adds a second brake that would later compete with
  `send-governor` — the "fixed threshold stacked on top of a self-adjusting mechanism" failure we
  have hit before.
- **Wait for `send-governor` to enforce.** Rejected: correct brake, wrong timing. Customers wait.
- **Raise `per_org_cap` to 1000 and change nothing else.** Rejected on measurement: with a sequential
  loop, a batch of 1000 would exhaust the edge function's wall-clock after ~80 executions and strand
  the remaining ~920 in `processing` until the 10-minute stale timer released them — strictly worse
  than the status quo. The number is only safe because the loop was fixed.

## Consequences

- **Ban risk on Workflow sends is knowingly accepted.** If a WhatsApp number is banned after a burst,
  this ADR is where to look first. Do not "restore" a throttle here without reading it — the absence
  is deliberate, not an oversight.
- **The instrumentation is not optional.** With no brake, the `claimed_at` column and the Lag readout
  on `/master/automation-health` are the only way to learn that this decision was wrong. A detector
  nobody reads reproduces the incident.
- **When `send-governor` moves to enforce, revisit the ceiling.** At pool 16 / share 8 an
  Organization can reach ~98 executions/min; Salesforce documents ~16.7/min/org for comparable work.
  The ceiling is high on purpose but should be re-derived once a real send-side brake exists.
- **Descaling does not protect against bursts.** The controller raises the pool again when the burst
  arrives — that is its job. Only the ceiling protects.
