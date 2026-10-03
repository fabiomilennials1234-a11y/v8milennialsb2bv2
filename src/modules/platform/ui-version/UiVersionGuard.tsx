/**
 * Leva a aba para a interface que a organização escolheu.
 *
 * Esta é a build V5. Se a org pede a clássica, troca (cookie + sem SW +
 * reload) e o nginx entrega a outra build. A mesma guarda, com `rodando:
 * "classic"`, vive na cópia congelada em `classic/`.
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
} from "@/shared/ui-version/core";
import { ESTA_UI, trocaDeUiLigada } from "./esta-ui";
import { useOrgInterface } from "./useOrgInterface";

export function UiVersionGuard() {
  // Desligada, nem consulta: os testes que montam o layout não precisam saber
  // da coluna, e o dev local não paga a ida ao banco.
  if (!trocaDeUiLigada()) return null;
  return <GuardaAtiva />;
}

function GuardaAtiva() {
  const { uiV5Enabled, isError } = useOrgInterface();
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    // Carregando ou erro de leitura: fica onde está. Erro passageiro não pode
    // jogar a org inteira na outra interface.
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
