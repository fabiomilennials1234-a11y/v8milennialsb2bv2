# 24. The Leads page shows the person, not the ledger

Date: 2026-08-04

## Status

Accepted

Extends **ADR-0023 §6** (the Leads page states Relação and Situação, never collapsed) with the three surface decisions that page had left open. Those three blocked the design of the page and therefore the last piece of slice 2.

## Context

ADR-0023 made the Leads page the single source of truth about a Lead. It did not say what the page shows *around* that. Three questions stayed open, and each had a measured answer waiting.

The measurements below are from production on 2026-08-04, not from the earlier planning note — the planning figures were three days old and one of them was wrong in a way that changed an option.

## Decision

**1. The "Dados" cluster leaves the list and lives in the drawer.**

It is the widest column on the page — **290px** — and carries lifetime value, average ticket, order count, reorder cycle and days since last order, sourced from Carteira (ERP) or from a won sale in the funnel.

Measured: **35.165 live Leads, 1.018 with anything in it — the column is empty 97,1% of the time.**

Rejected: *keep it only for the orgs with ERP.* This is the option the planning note carried, and the data kills it. The fill rate is not concentrated in a handful of orgs where the column would be useful — **the best-filled organization in the whole base is Basic4u at 23,7%**, Milennials at 10,3%, and nobody exceeds 24%. Restricting by org does not produce a populated column anywhere; it produces a 76%-empty column in 32 orgs instead of a 97%-empty column in 69.

Rejected: *collapse when empty.* It removes the value from 97% of rows but keeps the header and the width, which is the actual cost.

A column that is right 3% of the time is wrong 97% of the time. This is client detail, not list data.

**2. The stat cards count the organization, and the list sorts by clicking the column header.**

Two defects in the same strip.

*The cards lie.* Read in `Leads.tsx:387-397`: `total` comes from `useLeadsCount` (whole org, filters applied), but `highRating`, `thisMonth` and `withSDR` are computed from `leads` — **the current page only**. Three page-scoped numbers sit beside one org-scoped total with nothing marking the difference. In an org with 2.987 Leads, "leads this month" reports whatever fits in one page.

Rejected: *relabel them as "on this page".* Honest, but useless — nobody wants to know how many high-rating leads are on page 4.

*There is no sorting.* Order is fixed by creation, with no control. Sorting arrives on the column header rather than in a separate menu: the affordance sits on the thing being sorted, and the page already has a header row to carry it.

**3. Any member can open a Negócio.**

Measured: **217 active members — 148 admin, 68 member, 1 sdr.** And team size: **22 organizations have exactly one member**, 30 have two or three, 16 have four to six, and only 4 have seven or more.

Restricting to admin would gate 68 people out of 217, almost all of them in teams of two or three where everyone already shares everything. It buys no protection and costs friction.

It also fights the slice. ADR-0023 §3 removed every automated path that created a Negócio — after L1 the robot opens none. Opening one is now the act the product depends on a human performing. Putting a permission gate on the gesture you just made mandatory is working against yourself.

Rejected: *only whoever attends the lead.* Fairer in principle, unworkable in fact: 1.594 Leads still carry a cross-org responsável (cleaned in L2 step 1, not yet run), and in the 22 single-member orgs there is nobody to share with.

## Consequences

- `abrir_negocio` stays `SECURITY INVOKER`, which is what keeps this decision cheap to revisit: tightening it later is a policy change, not a rewrite of the function or its callers.
- The list gets 290px back. That width is the budget for what ADR-0023 §6 actually requires on the page: **Relação** and **Situação** side by side, never collapsed.
- The stat cards change value the day they ship — they will read *higher* than before for every org with more than one page of Leads. That is the correction, not a regression, but it will look like a jump and should be said out loud to the pilot.
- Sorting on the header means the header stops being decoration and starts being a control; empty and loading states of the list have to keep it usable.

## What this ADR does not decide

The Carteira merge (ADR-0023 §8 — Carteira as a facet of the Lead) is the other half of the Leads page and is not settled here. This ADR only clears the three blockers.
