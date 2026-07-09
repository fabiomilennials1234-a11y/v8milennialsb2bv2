/**
 * PROTOTYPE — wipe me. Observability cockpit prototype.
 * 3 variantes (?variant=A|B|C) da superfície unificada que substitui as ~7
 * páginas master fragmentadas. Dados mockados (data.ts). Rota throwaway
 * /master/observability-prototype. Switcher escondido em prod.
 *
 * Pergunta: qual layout torna o sistema "fácil de entender" pra CTO + devs?
 */
import { useSearchParams } from "react-router-dom";
import { VariantA } from "./_prototype-observability/VariantA";
import { VariantB } from "./_prototype-observability/VariantB";
import { VariantC } from "./_prototype-observability/VariantC";
import { Switcher } from "./_prototype-observability/Switcher";

export default function ObservabilityPrototype() {
  const [params] = useSearchParams();
  const v = params.get("variant") ?? "A";
  return (
    <>
      {v === "A" && <VariantA />}
      {v === "B" && <VariantB />}
      {v === "C" && <VariantC />}
      <Switcher />
    </>
  );
}
