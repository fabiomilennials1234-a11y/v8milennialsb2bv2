# Guided conditional acceptance audit

This is a requirements audit, not a completion certificate. All 21 tickets remain in scope. No ticket is closed by this document.

## Ticket 06: standard lead fields

| Requirement | Current evidence | Remaining work |
|---|---|---|
| Existing catalogues, friendly names | Tag, origin and responsible selectors use organization-scoped catalogues; browser cases cover current names and inactive references. | Complete information-catalogue search/grouping and vocabulary aliases from PRD stories 1–3. Native field dropdown is not that search experience. |
| Reference identity survives names | Real integration proves foreign/deleted/master denial; browser cases prevent homonym replacement. | Wider external lifecycle and permission-change certification remains required. |
| Appropriate typed operators; zero/false distinct from absence | Qualification score uses finite numbers; text uses textual operators. Zero is tested in real personal evaluation. | PRD story 11 explicitly requires both empty and filled. Guided contract currently implements only is_empty. Add is_not_empty through editor, evaluation, publication and compatibility boundaries. Boolean/custom-type proof belongs to the custom-field work; canonical monetary deal values belong to the business work. Neither requirement is certified yet. |
| Preserve compatible choices | Browser cases cover text operators, text-field changes and switching between responsible slots. | Extend matrix when the remaining field types arrive. |
| Loading/error/empty/removed are distinct | Existing browser cases cover transport failure, retry and missing references. Current correction adds independent selected-lookup failure versus an empty search page. | Full browser regression after the correction: 69 passed. Final real journey/a11y gates remain required. |
| Legacy tag semantics preserved | New UUID-based tag contract is separate from the old evaluator. Public evaluator/executor tests cover the new contract. | Full legacy conversion/regression certificate remains in ticket 20. |

## Additional standard-field inventory

The existing legacy ConditionPanel lists segment, urgency and faturamento alongside name/company/contact/UTM fields. They are not yet present in the guided field registry. Confirm the actual domain value representation before choosing operators or options; faturamento is stored as text and must not be silently treated as a numeric monetary amount. Retired rating and legacy score aliases must not be exposed as current canonical facts.

## Next implementation priority

Implement the explicitly approved filled/presence comparison (is_not_empty), then complete the standard-field catalogue inventory and continue the dependent custom-field/business paths. Preserve every remaining criterion for final certification; green tests for the currently exposed subset are not proof of all 21 tickets.
