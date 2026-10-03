/**
 * Sub-conceito gestor — API interna do módulo identity (ADR-0021).
 *
 * Gestor de Portfólio = "scoped master": ator fora de `team_members`, com escrita
 * full de admin operacional nas orgs vinculadas pelo Master. Abaixo do Master,
 * não cria orgs, não acessa área master.
 *
 * O barrel raiz (`../index.ts`) re-exporta `useGestor` + `GestorRoute`.
 * A página `AreaGestor` é deep-imported pelo `App.tsx` (lazy chunk).
 */

export { useGestor } from "./hooks/useGestor";
export { GestorRoute } from "./components/GestorRoute";
export type { GestorRow, GestorOrganizationRow } from "./types";
