# Guided conditional acceptance audit

This is a requirements audit, not a completion certificate. All 21 tickets remain in scope. No ticket is closed by this document.

## Ticket 06: standard lead fields

| Requirement | Current evidence | Remaining work |
|---|---|---|
| Existing catalogues, friendly names | Tag, origin and responsible selectors use organization-scoped catalogues; browser cases cover current names and inactive references. | Information selector now searches supported Lead fields by labels and commercial aliases, with a Lead group and keyboard navigation. The remaining domain groups enter with their evaluators; complete cross-domain discovery still depends on those tickets. |
| Reference identity survives names | Real integration proves foreign/deleted/master denial; browser cases prevent homonym replacement. | Wider external lifecycle and permission-change certification remains required. |
| Appropriate typed operators; zero/false distinct from absence | Qualification score uses finite numbers; text uses textual operators. Zero is tested in real personal evaluation. | PRD story 11 explicitly requires both empty and filled. The guided contract now supports is_not_empty for text, qualification score, origin and responsible assignments through editor, evaluation and publication. Field scope remains mandatory without a comparison reference. Boolean/custom-type proof belongs to the custom-field work; canonical monetary deal values belong to the business work. Neither requirement is certified yet. |
| Preserve compatible choices | Browser cases cover text operators, text-field changes and switching between responsible slots. | Extend matrix when the remaining field types arrive. |
| Loading/error/empty/removed are distinct | Existing browser cases cover transport failure, retry and missing references. Current correction adds independent selected-lookup failure versus an empty search page. | Full browser regression for the catalogue correction: 69 passed. Final real journey/a11y gates remain required. |
| Legacy tag semantics preserved | New UUID-based tag contract is separate from the old evaluator. Public evaluator/executor tests cover the new contract. | Full legacy conversion/regression certificate remains in ticket 20. |

## Additional standard-field inventory

The existing legacy ConditionPanel lists segment, urgency and faturamento alongside name/company/contact/UTM fields. They are now present in the guided field registry with text comparisons and creatable suggestions. The current representation was checked before choosing operators; faturamento is stored as text and must not be silently treated as a numeric monetary amount. Retired rating and legacy score aliases must not be exposed as current canonical facts.

## Next implementation priority

Information-catalogue regression passed (79 browser cases, followed by two focused alias/cancellation cases). Continue UUID-based custom-field evaluation and the dependent business paths. Preserve every remaining criterion for final certification; green tests for the currently exposed subset are not proof of all 21 tickets.


## Value representation confirmed in the current source

- Urgency is editable as free text. The kanban filter's four timeline presets are not an exhaustive set; suggestions must permit other persisted/manual values.
- formatFaturamento documents numeric-looking values, ranges and free text received from forms/Meta Ads. Its display formatting is not a numeric comparison parser. Preserve that distinction when adding Faturamento.
- Presence now has full current-field UI coverage (74 browser tests) and real reference/scalar evaluation/publication coverage (49 integration tests). This does not certify the additional fields or downstream domains.

## Custom-field source inventory for ticket 07

- Current definitions use UUID identity, organization_id, field_name, field_type and field_options (string array). Supported types are text, number, date, select and boolean. Values are string/null with a unique lead_id/field_id pair; deleting a definition cascades its values. Missing definition must therefore be checked separately from an unanswered field.
- Lead editors persist boolean strings with String(value), including "false". The guided evaluator must preserve false as a value and reject malformed typed strings rather than adopting a display component's fallback.
- Existing personal value RLS checks lead visibility; definitions use organization membership. Guided reads must additionally validate the selected definition belongs to the current organization and expected type, and reject unavailable references before short circuit. Existing catalogue hooks do not partition by actor and must not be copied unchanged.
- These are source findings, not implementation or live-security evidence for custom fields.

## Ticket 07: current custom text selector checkpoint

- Personal custom text lookup/evaluation is implemented and real-tested by UUID. The editor now lists text definitions directly in the information catalogue under Lead · Campos personalizados, preserves compatible comparisons, and resolves the selected UUID independently from a 25-result search page. Definition changes update the label; matching server metadata updates the test explanation.
- Browser cases cover reference failure/retry without a false empty catalogue, removed/type-changed fields requiring explicit replacement, and actor changes hiding the previous display hint during lookup. Queries contain only definition metadata, with actor/organization-partitioned keys, escaped name search and abort signals. Real catalogue requests allow the current organization and deny the foreign fixture.
- Remaining: deployed worker execution; select; cross-type lifecycle semantics; broader search/a11y/limits audit. Remote custom-name search currently uses ILIKE, so do not claim accent-insensitive remote matching from the static catalogue's normalization tests. The catalogue currently admits text, number, boolean and date definitions; select remains unavailable until implemented.
- The former personal-test-only gate is removed: administrators approve/revoke exact custom UUID scopes with current definition names. Pending/unavailable metadata blocks new approval, while retained approvals remain revocable. All tickets stay open.

## Organizational custom text scopes

Per-definition approval and atomic automatic reads are now implemented and real-tested, including mixed fields, exact projection, revocation, foreign identities and post-deletion revocability. Custom text publication now validates every definition/type/scope, and real authenticated publication plus pinned shared-executor Yes routing passed. Rejection preserves the published version. This is not a deployed worker certificate. A defensive 256-scope budget now exists in the grant validator and public evaluator; ticket 21 must validate its performance and corresponding editor/publication feedback.

## Numeric custom fields

Custom numeric definitions now use typed comparisons, numeric inputs and UUID-based approval/publication. Real tests cover explicit decimal/scientific conversion, zero vs absence, invalid stored formats, rounding/underflow rejection, conflicting expected types, caller isolation, published-version routing and reference invalidation. Conversion must preserve canonical decimal spelling across the numeric API representation; unsupported precision fails explicitly instead of rounding or becoming zero. No numeric data is rewritten.

The selector retains compatible numeric comparisons when moving between the standard score and custom numeric definitions. Text-to-number changes clear incompatible values. Select, option lifecycle, complete cross-type repair, remote accent matching and cost/limit feedback remain open; this is not ticket 07 certification.

## Boolean custom fields

Boolean evaluation now preserves false as a filled value, distinguishes unanswered fields, rejects malformed stored values and validates expected type before any comparison. The editor uses explicit Sim/Não choices and transmits booleans rather than strings. Per-UUID approval/publication schema supports boolean definitions with the same current-reference checks; 62 real integration tests and 89 browser tests passed, with TypeScript reporting zero introduced errors. This is evidence for the boolean slice, not full ticket certification. Select and the broader ticket 07 acceptance audit remain open.

## Calendar-date custom fields

Calendar dates now have strict shared validation, date-specific operators and native date inputs. Comparison and display avoid timestamp conversion. Two browser timezone contexts preserve the exact same day; real tests cover leap/century/month/year boundaries, absence, invalid dates and expected-type/tenant checks. Date approval/publication is implemented, with 64 real integration tests and 92 browser tests passing, including impossible-date publication rejection. TypeScript reports zero introduced errors. Registered options and the broader ticket 07 acceptance audit remain open.

## Ticket 07 — registered option implementation checkpoint

Select now joins text, number, boolean and calendar date. Registered strings are exact identities; there is no independent option UUID in the current schema. The editor searches the complete option list with at most 25 visible matches and resolves the selected option independently. Removed configured values fail before short circuiting; stale nonempty answers and malformed metadata fail explicitly. Personal RLS and organizational grant/publication paths are covered by real integration; browser covers selection, typed payload, removal, retry, keyboard focus, current definition labels and explicit grant/revocation. Migration rollback and effective privileges checked live.

This implements registered-option behavior, not a ticket certificate. Remaining audit includes the complete actual-type inventory, cross-type/actor lifecycle matrix, malformed persisted drafts, broader accessibility, performance/limit evidence and a real editor-to-preview journey. All 21 tickets remain in scope.

Live preview CHECK constraint and source manager confirm the five custom types above. Verification: 66 integration, 92 units; browser 94 passed in full run plus the corrected four-to-five-type expectation passed in focused rerun. Final TypeScript ratchet zero introduced errors. Rollback rehearsal additionally preserves a select definition's exact option list and selected answer.

## 2026-09-09 — lifecycle and business prerequisites

- Custom definitions: removed/type-change coverage now includes all five actual types (10 browser journeys). Select options retain exact identity, recover from lookup denial/error and are hidden during actor changes. Information and registered-option popup semantics corrected; keyboard focus behavior tested. Full browser regression: 105 passed.
- Direct custom RPC limits: exact boundary tested with real Auth/RLS. Migration 37 closes the direct-call gap above the evaluator's existing 256-reference ceiling. Full integration after this change: 68 passed; effective privileges and rollback checked. Performance tuning/product limit decisions remain ticket 21 work.
- Business clock prerequisite: live schema confirms stage_id/pipeline_id identity and optional financial deal_id. Real API test reproduced and corrected equal-key cross-funnel moves failing to restart stage_changed_at. Notes preserve the clock; return restarts it. This covers that transition through authenticated direct UPDATE; it does not certify every writer, missing historic timestamps, business evaluation or UI.
- Next implementation: exact triggering entry context and stage selector/evaluation with explicit organization approval. Then value/elapsed-time rules and the separate existence query. No fallback to another lead entry; no absent-value-to-zero conversion. No ticket closed by this audit.

Additional business-source finding to retain for ticket 08: several existing stage-event/workflow triggers still compare only stage_key. Equal-key cross-funnel transfer now corrects the stage clock, but event fan-out for that transfer was not changed or certified here. Canonical guided context must use the triggering execution's pipeline_entry_id and never infer a replacement from the lead's most recent card.
