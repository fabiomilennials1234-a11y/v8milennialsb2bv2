import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, MessageSquare, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import {
  assinarCartoes,
  dispensarCartao,
  estadoDosCartoes,
  varrerCartoesVencidos,
} from "../../lib/cartoes-store";

/**
 * O canal quente: o que muda se você souber agora em vez de daqui a quarenta
 * minutos. Reunião de amanhã é importante e NÃO entra aqui — fica no sino.
 *
 * A pilha é decidida em módulo puro; este componente só desenha e conta o
 * tempo. Se um dia o canto da tela parecer cheio, o conserto é no produtor do
 * Aviso, não em silenciar o usuário.
 */

const VISUAL: Record<string, { icone: typeof MessageSquare; classe: string; borda: string }> = {
  lead_message: { icone: MessageSquare, classe: "text-chart-5", borda: "border-border" },
  lead_new: { icone: UserPlus, classe: "text-success", borda: "border-success/40" },
  workflow_alert: { icone: AlertTriangle, classe: "text-destructive", borda: "border-destructive/50" },
  cron_drift: { icone: AlertTriangle, classe: "text-destructive", borda: "border-destructive/50" },
};

export function PilhaDeCartoes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pilha, excedente } = useSyncExternalStore(assinarCartoes, estadoDosCartoes, estadoDosCartoes);

  // Um varredor só, no dono da pilha — um timer por cartão seria N timers para
  // resolver o mesmo problema.
  useEffect(() => {
    if (pilha.length === 0) return;
    const id = window.setInterval(() => varrerCartoesVencidos(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [pilha.length]);

  if (pilha.length === 0) return null;

  const abrir = async (cartaoId: string, avisoId: string, link: string | null) => {
    dispensarCartao(cartaoId);
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", avisoId);
    await queryClient.invalidateQueries({ queryKey: ["avisos"] });
    if (link) navigate(link);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] flex-col gap-2">
      {excedente > 0 && (
        <p className="pointer-events-none text-right text-xs text-muted-foreground">
          +{excedente} no sino
        </p>
      )}

      <AnimatePresence mode="popLayout">
        {pilha.map((cartao) => {
          const visual = VISUAL[cartao.tipo] ?? {
            icone: MessageSquare,
            classe: "text-muted-foreground",
            borda: "border-border",
          };
          const Icone = visual.icone;

          return (
            <motion.div
              key={cartao.id}
              layout
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "pointer-events-auto flex gap-3 rounded-xl border bg-card p-3 shadow-lg",
                visual.borda,
              )}
            >
              <Icone className={cn("mt-0.5 h-4 w-4 shrink-0", visual.classe)} />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {cartao.titulo}
                  {cartao.eventCount > 1 && (
                    <span className="ml-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                      ×{cartao.eventCount}
                    </span>
                  )}
                </p>
                {cartao.descricao && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {cartao.descricao}
                  </p>
                )}

                {cartao.link && (
                  <button
                    type="button"
                    onClick={() => void abrir(cartao.id, cartao.avisoId, cartao.link)}
                    className="mt-2 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
                  >
                    {cartao.fixo ? "Ver o que parou" : "Abrir"}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => dispensarCartao(cartao.id)}
                aria-label="Dispensar"
                className="h-fit rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
