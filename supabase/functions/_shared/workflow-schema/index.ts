/**
 * Shared workflow schema/compiler/validator (docs/adr/0013). Single source of truth for the
 * workflow DAG contract — consumed by the torque-mcp workflow tool now; pluggable into the
 * executor + frontend in a later slice to retire the validation drift.
 */
export * from "./enums.ts";
export * from "./dsl.ts";
export * from "./definition.ts";
export { parseSpec, safeParseSpec, specSchema } from "./dsl-schema.ts";
export { compileWorkflow, HANDLES } from "./compiler.ts";
export { validateWorkflow } from "./validator.ts";
export type { ValidationIssue, ValidationResult } from "./validator.ts";
