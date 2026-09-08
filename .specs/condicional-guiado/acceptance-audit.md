# Guided conditional acceptance audit

This is a requirements audit, not a completion certificate. All 21 tickets remain in scope. No ticket is closed by this document.

## Ticket 06: standard lead fields

| Requirement | Current evidence | Remaining work |
|---|---|---|
| Existing catalogues, friendly names | Tag, origin and responsible selectors use organization-scoped catalogues; browser cases cover current names and inactive references. | Complete information-catalogue search/grouping and vocabulary aliases from PRD stories 1–3. Native field dropdown is not that search experience. |
| Reference identity survives names | Real integration proves foreign/deleted/master denial; browser cases prevent homonym replacement. | Wider external lifecycle and permission-change certification remains required. |
| Appropriate typed operators; zero/false distinct from absence | Qualification score uses finite numbers; text uses textual operators. Zero is tested in real personal evaluation. | PRD story 11 explicitly requires both empty and filled. The guided contract now supports is_not_empty for text, qualification score, origin and responsible assignments through editor, evaluation and publication. Field scope remains mandatory without a comparison reference. Boolean/custom-type proof belongs to the custom-field work; canonical monetary deal values belong to the business work. Neither requirement is certified yet. |
| Preserve compatible choices | Browser cases cover text operators, text-field changes and switching between responsible slots. | Extend matrix when the remaining field types arrive. |
| Loading/error/empty/removed are distinct | Existing browser cases cover transport failure, retry and missing references. Current correction adds independent selected-lookup failure versus an empty search page. | Full browser regression for the catalogue correction: 69 passed. Final real journey/a11y gates remain required. |
| Legacy tag semantics preserved | New UUID-based tag contract is separate from the old evaluator. Public evaluator/executor tests cover the new contract. | Full legacy conversion/regression certificate remains in ticket 20. |

## Additional standard-field inventory

The existing legacy ConditionPanel lists segment, urgency and faturamento alongside name/company/contact/UTM fields. They are now present in the guided field registry with text comparisons and creatable suggestions. The current representation was checked before choosing operators; faturamento is stored as text and must not be silently treated as a numeric monetary amount. Retired rating and legacy score aliases must not be exposed as current canonical facts.

## Next implementation priority

Complete searchable information discovery/grouping and vocabulary aliases, then continue the dependent custom-field/business paths. Preserve every remaining criterion for final certification; green tests for the currently exposed subset are not proof of all 21 tickets.


## Value representation confirmed in the current source

- Urgency is editable as free text. The kanban filter's four timeline presets are not an exhaustive set; suggestions must permit other persisted/manual values.
- formatFaturamento documents numeric-looking values, ranges and free text received from forms/Meta Ads. Its display formatting is not a numeric comparison parser. Preserve that distinction when adding Faturamento.
- Presence now has full current-field UI coverage (74 browser tests) and real reference/scalar evaluation/publication coverage (49 integration tests). This does not certify the additional fields or downstream domains.
