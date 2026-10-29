/**
 * O "+" ao lado do saldo: abre a compra de créditos (ADR-0045). Liga a tela de compra ao painel de suporte
 * pela ponte de `shared/errors` (`openSupport`), sem importar o módulo `platform`.
 */
import { Plus } from "lucide-react";
import { useState } from "react";

import { canOpenSupport, openSupport, type SupportPrefill } from "@/shared/errors";

import { RECEBEDOR_PIX } from "../lib/pix";
import { ComprarCreditosDialog } from "./ComprarCreditosDialog";

export function BotaoComprarCreditos() {
  const [aberto, setAberto] = useState(false);
  // O painel de suporte só se registra quando o perfil pode usá-lo (gestor não pode): sem ele, o "Outro" fica desligado.
  const podeAbrirChamado = aberto && canOpenSupport();

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Comprar créditos"
        title="Comprar créditos"
        className="ml-0.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3.5" strokeWidth={3} aria-hidden />
      </button>
      <ComprarCreditosDialog
        aberto={aberto}
        onFechar={() => setAberto(false)}
        recebedor={RECEBEDOR_PIX}
        onAbrirChamado={podeAbrirChamado ? (prefill: SupportPrefill) => void openSupport(prefill) : null}
      />
    </>
  );
}
