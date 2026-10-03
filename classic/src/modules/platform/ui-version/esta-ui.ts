import type { UiVersion } from "@torque/ui-version";

/** Esta é a build CLÁSSICA (classic.patch). A V5 tem o mesmo arquivo com "v5". */
export const ESTA_UI: UiVersion = "classic";

/**
 * A troca só age com `VITE_UI_SWITCH=true`, que o Dockerfile liga. Dev,
 * harness de prints e E2E servem uma build só: ali a guarda recarregaria à toa.
 */
export function trocaDeUiLigada(): boolean {
  return import.meta.env.VITE_UI_SWITCH === "true";
}
