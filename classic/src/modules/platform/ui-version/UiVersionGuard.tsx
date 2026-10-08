/**
 * Leva a aba para a interface que a organização escolheu — lado CLÁSSICO
 * (classic.patch). A guarda da V5 está em
 * src/modules/platform/ui-version/UiVersionGuard.tsx; a decisão é uma só,
 * importada de `@torque/ui-version` (src/shared/ui-version/core.ts).
 *
 * Só age com `VITE_UI_SWITCH=true` (ver `esta-ui.ts`).
 */
import { useEffect, useState } from "react";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import {
  decidirUi,
  gravarCookieUi,
  lerCookieUi,
  lerTentativa,
  trocarUi,
  uiPedidaPelaOrg,
} from "@torque/ui-version";
import { ESTA_UI, trocaDeUiLigada } from "./esta-ui";
import { useOrgInterface } from "./useOrgInterface";

export function UiVersionGuard() {
  if (!trocaDeUiLigada()) return null;
  return <GuardaAtiva />;
}

function GuardaAtiva() {
  const { uiV5Enabled, isError } = useOrgInterface();
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    if (uiV5Enabled === null || isError) return;
    const pedida = uiPedidaPelaOrg(uiV5Enabled);
    const decisao = decidirUi({
      rodando: ESTA_UI,
      pedida,
      cookie: lerCookieUi(document.cookie),
      ultimaTentativa: lerTentativa(),
      agora: Date.now(),
    });
    if (decisao === "sincronizar-cookie") gravarCookieUi(ESTA_UI);
    else if (decisao === "trocar") {
      setTrocando(true);
      void trocarUi(pedida);
    } else if (decisao === "desistir") {
      console.warn(
        `[ui] a org pede a interface "${pedida}", mas o servidor continua entregando "${ESTA_UI}". ` +
          "O nginx deste ambiente não escolhe pelo cookie — fica aqui.",
      );
    }
  }, [uiV5Enabled, isError]);

  return trocando ? <TorqueLoader message="Abrindo a interface da sua organização…" /> : null;
}
