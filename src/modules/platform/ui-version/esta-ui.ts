import type { UiVersion } from "@/shared/ui-version/core";

/** Esta é a build V5. A cópia em `classic/` tem o mesmo arquivo com "classic". */
export const ESTA_UI: UiVersion = "v5";

/**
 * A troca só age com `VITE_UI_SWITCH=true`, que o Dockerfile liga. Dev,
 * harness de prints e E2E servem uma build só: ali a guarda recarregaria à toa.
 */
export function trocaDeUiLigada(): boolean {
  return import.meta.env.VITE_UI_SWITCH === "true";
}
