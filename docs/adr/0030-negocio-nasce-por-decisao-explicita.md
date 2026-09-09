# 30. A Negócio is born by an explicit decision, not only by a human click

Date: 2026-08-23

## Status

Accepted

Narrows **ADR-0023 §3** ("a Negócio is born only by human click"). That decision is three weeks old and was correct for the world it was written in; this one keeps what it was protecting and drops the sentence that now blocks the product.

## Context

ADR-0023 §3 reads: *"No ingest path, no integration and no automation creates one. A Lead arriving from an ad, a form, a spreadsheet or Cal.com exists in Leads and nowhere else until a person decides there is a sale to pursue."*

That sentence had one job: stop the pipeline number from meaning nothing. Under the old model every Lead became a card automatically, so "deals in the funnel" and "people who arrived" were the same figure — the funnel could not be read as a forecast because it was really an arrival log.

Two things have changed since.

**The model shipped, and the sentence started costing.** The migrations went to production on 2026-08-23 and 34.966 Negócios were backfilled across 69 organizations. With `deal_manual_only` off in all 107 organizations, the legacy auto-seed trigger still creates a card on every Lead insert — but the card gets no Negócio, because §3 forbids anything but a click from opening one. Measured in production the same evening: **4 orphan cards in 8 minutes**, in organizations whose backfill had already completed. Turning the flag on instead does not fix it: the Lead arriving from an ad then gets nothing at all, and the seller never sees it. §3 as written leaves no third door.

**The read of "human" was too narrow.** §3 conflated *a person decided* with *a person clicked*. A Workflow that opens a Negócio when the Lead answers the second message, or when the `Ouro` tag lands, is a criterion a human wrote down in advance and switched on — with an author, a version and an execution history. It is more auditable than a click, not less. The same holds for an API key: issuing one with `deal:write` is a deliberate act by an administrator.

What §3 was really protecting was never the click. It was **not every Lead that arrives is a sale in progress**. That survives intact under a wider door, as long as the door is one somebody chose to open.

## Decision

**1. A Negócio is born by an explicit decision, human or pre-authorised.** Four doors: a click in the interface, a Workflow node somebody drew and switched on, a scoped API call, a spreadsheet import. What stays forbidden is the *automatic* birth — no Lead becomes a Negócio merely by entering the system.

**2. The pre-authorisation is the tool itself, not a separate setting.** An active Workflow containing the node **is** the human decision. A key carrying `deal:write` **is** the human decision. `organizations.feature_flags.deal_manual_only` is retired: it becomes the permanent behaviour rather than a per-organisation switch, which is what the auto-seed trigger's removal encodes.

Rejected: a per-organisation list of allowed doors, and a two-lock scheme (scope *and* organisation flag). Both build a control surface for an abuse that has not happened — no organisation has a Workflow opening Negócios today. The failure mode this repository actually suffers from is *feature built and never switched on*, not *missing brake*. When a runaway Workflow does appear, the useful brake is a ceiling on automation-opened Negócios per hour, which a checkbox would not have provided: whoever misconfigured the Workflow would have ticked the checkbox too.

**3. The auto-seed dies with no replacement.** `fn_auto_assign_lead_default_pipe` stops creating cards, and no default Workflow is seeded in its place. Organizations that want automatic funnel entry draw the Workflow.

Measured before deciding: over 7 days, 15.462 Leads arrived and 2.886 cards were created. The gap is one organization — Café Jurerê, 12.619 ERP-imported Leads and zero cards. Among organizations that actually feed a funnel, the auto-seed fires at ~100%, and only two exceed 100 Leads/week: **Goletric Pinheiros (1.290 → 1.294)** and **Goletric Perdizes (882 → 884)**.

So the cost is concrete and bounded: those two stop receiving roughly 2.180 cards a week. Existing cards are untouched — the funnel does not empty, it stops filling. Accepted deliberately, to be closed by the Workflow node rather than by a seeded default.

Rejected: seeding a default Workflow per affected organization. It would have preserved behaviour, but it converts a decision the customer never made into 2 Workflows they did not ask for, and the honest version of §3 is that automatic entry should be something somebody chose.

**4. Every Negócio records its Procedência.** A `NOT NULL` column on `deals` with a CHECK over `human · workflow · api · import · backfill`. Written once at birth, never rewritten.

Rejected: a key inside the existing `metadata` jsonb. Provenance is a trail, not a state, and the trail has to be answerable in one query years later. A jsonb key with no CHECK and no `NOT NULL` drifts — half the rows carry `source`, some carry `origem`, and the question stops having an answer exactly where it matters. `created_by` cannot serve either: it names a person and is null for every door that is not one — all 34.966 backfilled rows have it empty.

`ingest` is deliberately absent from the vocabulary. With the auto-seed gone and the ingest edge functions no longer opening Negócios, it would be a value with no case. It can be added when it has one.

## Consequences

**What this forces**

- The gate `isDealManualOnly` and its six call sites come out — the choke in the pipeline adapter, the four ingest edge functions, `import-leads`, and both custom-funnel branches of the move-stage handler. They stop being conditional and start being unconditional.
- The public API grows a `deals` resource, because door 3 has to exist somewhere. The API is English (`/api/v1/deals`) even though the interface says *Negócio*; the documentation opens by saying so, which also disambiguates for anyone arriving from Kommo, where "lead" means our Negócio.
- Provenance has to be supplied at every creation path before the column can be `NOT NULL`. A path that forgets becomes a permanent hole in the answer.

**What we accept**

- Two organizations lose automatic funnel entry until the Workflow node ships. This is a visible regression for their sellers and needs to be told to them, not discovered by them.
- The wider door means the funnel count can be inflated by a badly drawn Workflow. The brake is deferred on purpose; `source` is what makes the damage measurable when it happens, and it is what a per-organisation flag would not have given.

---

## Amendment 1 — Entering a funnel *is* the explicit decision (2026-09-01)

**Status:** accepted (grill com o CTO, 2026-09-01) · **Narrows nothing, widens the doors:** the prohibition this ADR protects — no automatic birth — stands untouched. See **ADR-0034** ("Funil é funil"), whose D2 this amendment records.

### What changes

**1. Entering a funnel IS the explicit decision that creates the Negócio.** Under the original text a card and a Negócio were separable: a card could sit in a funnel with no `deals` row behind it — and 12.598 of 47.270 cards (26,6%, measured 2026-08-28) did. ADR-0034 unifies the funnels, and with one kind of funnel there is one kind of card: **every card is a Negócio**, value optional (a R$ 0 Negócio is normal — a qualification funnel is a funnel of deals that have no value yet). The decision that opens the Negócio is the decision to put it in a funnel; there is no second, later moment at which someone "upgrades" a card into a Negócio.

**2. The door that lets it into the funnel records the Procedência.** The doors, in the vocabulary of ADR-0034 D2: `human` (a click — the CHECK's existing value, kept; the spec's earlier `manual` was renamed to it, CTO decision 2026-09-01), `import` (a spreadsheet), `webhook` (an ingest payload whose `place_in_pipe` someone configured), `workflow` (a node somebody drew and switched on), `api` (a scoped key), `backfill_funil_custom` (the one-Negócio-per-custom-card backfill this wave runs, value null). On `webhook`: §4 of this ADR left `ingest` deliberately absent *"until it has a case"* — it now has one, and the case satisfies the original test: the destination funnel in a webhook payload is configuration a human wrote down in advance, in the n8n flow or the form settings, not a blind automatism. The naming seam is settled: `human` stays (CTO, 2026-09-01) — no rename migration needed. This amendment as a whole was confirmed by the CTO the same day.

**3. What stays forbidden is unchanged: the purely automatic birth.** A Lead entering the system creates nothing — no funnel entry, no Negócio. The auto-seed stays dead (§3), no default Workflow is seeded in its place, and "every card is a Negócio" never means "every Lead gets a card".

### Why this is not a reversal

This ADR's §1 already held that the decision may be pre-authorised — the Workflow is the decision, the key is the decision. The amendment moves one thing: the *object* of the decision. Before, the decision was "open a Negócio" and the card followed; now the decision is "put this into a funnel" and the Negócio is what that means. Same door-keeper, same prohibition, one fewer way for a card to exist outside the model — which is the gap ADR-0031 §2 had to engineer around when it keyed the execution subject on `pipeline_entries.id` because 26% of cards had no `deals` row.
