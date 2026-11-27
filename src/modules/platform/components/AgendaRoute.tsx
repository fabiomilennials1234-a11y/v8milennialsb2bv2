import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";

import { ROTA_COMANDO, useAgendaSoNoComando } from "@/modules/platform/hooks/useAgendaSoNoComando";

/**
 * Guarda da rota `/agenda`. Org com `agenda_so_no_comando` vai para o Comando,
 * venha de onde vier: botão, paleta, favorito, push ou o link `/agenda` que o
 * banco grava nos avisos de reunião. Por isso a trava é aqui, e não só nos
 * botões.
 *
 * Fica FORA do chunk preguiçoso da Agenda: quem é redirecionado não baixa a tela.
 */
export function AgendaRoute({ children }: { children: ReactNode }) {
  const { ativa, isLoading } = useAgendaSoNoComando();
  if (isLoading) {
    return (
      <div className="grid h-[50vh] place-items-center text-muted-foreground" role="status" aria-label="Carregando">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (ativa) return <Navigate to={ROTA_COMANDO} replace />;
  return <>{children}</>;
}
