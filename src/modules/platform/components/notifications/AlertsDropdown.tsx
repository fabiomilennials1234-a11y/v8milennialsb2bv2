import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  MessageSquare,
  UserPlus,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

import { instanteDoAviso, type Aviso } from "../../lib/aviso-stream";
import {
  FAMILIAS,
  agruparPorTempo,
  contarPorFamilia,
  filtrarPorFamilia,
  type Familia,
} from "../../lib/aviso-agrupamento";
import { useAvisos } from "../../hooks/useAvisos";
import { motorDeSom } from "../../lib/motor-de-som";
import { usePreferenciasDeAviso } from "../../hooks/usePreferenciasDeAviso";

/**
 * O sino. Lê a lista pronta do hook e não consulta banco: aqui só se decide
 * como o que já existe aparece — filtro por família, agrupamento por tempo,
 * e o que está por ler.
 */

const ICONES: Record<string, { icone: typeof Bell; classe: string; fundo: string }> = {
  lead_message: { icone: MessageSquare, classe: "text-chart-5", fundo: "bg-chart-5/10" },
  lead_new: { icone: UserPlus, classe: "text-success", fundo: "bg-success/10" },
  meeting_booked: { icone: Calendar, classe: "text-primary", fundo: "bg-primary/10" },
  meeting_soon: { icone: Zap, classe: "text-chart-5", fundo: "bg-chart-5/10" },
  follow_up_due: { icone: Clock, classe: "text-warning", fundo: "bg-warning/10" },
  follow_up_overdue: { icone: AlertTriangle, classe: "text-destructive", fundo: "bg-destructive/10" },
  workflow_alert: { icone: AlertTriangle, classe: "text-destructive", fundo: "bg-destructive/10" },
  cron_drift: { icone: AlertTriangle, classe: "text-destructive", fundo: "bg-destructive/10" },
  transfer_to_human: { icone: UserPlus, classe: "text-destructive", fundo: "bg-destructive/10" },
};

const PADRAO = { icone: Bell, classe: "text-muted-foreground", fundo: "bg-muted/50" };

/** Os tipos que valem pintar o badge de vermelho — o resto conta, mas não grita. */
const URGENTES = new Set(["workflow_alert", "cron_drift", "lead_message", "transfer_to_human"]);

export interface AlertsDropdownProps {
  /** Texto ao lado do sino. Faz parte do gatilho: clicar na palavra abre. */
  rotulo?: string;
}

export function AlertsDropdown({ rotulo }: AlertsDropdownProps = {}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [familia, setFamilia] = useState<Familia>("tudo");
  const { avisos, naoLidos, marcarComoLido, marcarTodosComoLidos } = useAvisos();
  const { preferencias, salvar } = usePreferenciasDeAviso();

  const contagem = useMemo(() => contarPorFamilia(avisos), [avisos]);
  const grupos = useMemo(
    () => agruparPorTempo(filtrarPorFamilia(avisos, familia), new Date()),
    [avisos, familia],
  );

  const urgentesNaoLidos = avisos.filter(
    (a) => a.read_at === null && URGENTES.has(a.type),
  ).length;

  const aoClicar = async (aviso: Aviso) => {
    if (aviso.read_at === null) {
      await marcarComoLido(aviso.id);
    }
    if (aviso.link) {
      navigate(aviso.link);
      setOpen(false);
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(proximo) => {
        // Abrir o sino é um gesto do usuário — o único momento garantido para
        // destravar o áudio no navegador. Sem isto, o primeiro Aviso da sessão
        // chega mudo.
        if (proximo) motorDeSom.destravar();
        setOpen(proximo);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={rotulo ? "default" : "icon"}
          className={cn("relative", rotulo && "w-full justify-start gap-3 px-2.5")}
          aria-label="Notificações"
        >
          <Bell className="w-5 h-5 shrink-0" />
          {naoLidos > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                "absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums",
                urgentesNaoLidos > 0
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {naoLidos > 9 ? "9+" : naoLidos}
            </motion.span>
          )}
          {rotulo && <span className="flex-1 truncate text-left font-normal">{rotulo}</span>}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[368px] p-0">
        <div className="p-3 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Notificações</h3>
            {/* Silenciar tudo em um clique: numa reunião, ninguém vai procurar
                a tela de configurações. */}
            <button
              type="button"
              onClick={() => void salvar({ sound_enabled: !preferencias.sound_enabled })}
              aria-pressed={!preferencias.sound_enabled}
              title={preferencias.sound_enabled ? "Silenciar tudo" : "Voltar a tocar"}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {preferencias.sound_enabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-destructive" />
              )}
            </button>
          </div>
          {naoLidos > 0 && (
            <button
              type="button"
              onClick={() => marcarTodosComoLidos()}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Marcar todas como lidas
            </button>
          )}
        </div>

        <div className="flex gap-1 px-2 py-2 border-b border-border overflow-x-auto scrollbar-hide">
          {FAMILIAS.map(({ chave, rotulo: nomeDaFamilia }) => (
            <button
              key={chave}
              type="button"
              onClick={() => setFamilia(chave)}
              aria-pressed={familia === chave}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors",
                familia === chave
                  ? "border-border bg-muted text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50",
              )}
            >
              {nomeDaFamilia}
              {contagem[chave] > 0 && (
                <span className="ml-1.5 tabular-nums text-muted-foreground">{contagem[chave]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Rolagem simples em vez de ScrollArea: o viewport do Radix usa
            display:table, o que anula `truncate` nos filhos — a descrição
            vazava a largura do painel e era cortada no meio da palavra. */}
        {grupos.length > 0 ? (
          <div className="max-h-[320px] overflow-y-auto overscroll-contain">
            <div className="p-2">
              <AnimatePresence mode="popLayout">
                {grupos.map((grupo) => (
                  <div key={grupo.rotulo}>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {grupo.rotulo}
                    </p>
                    {grupo.avisos.map((aviso, index) => {
                      const visual = ICONES[aviso.type] ?? PADRAO;
                      const Icone = visual.icone;
                      const naoLido = aviso.read_at === null;
                      return (
                        <motion.div
                          key={aviso.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ delay: Math.min(index, 6) * 0.04 }}
                          onClick={() => aoClicar(aviso)}
                          className={cn(
                            "mb-1 flex cursor-pointer items-start gap-3 rounded-lg border-l-2 p-3 transition-colors hover:bg-muted/50",
                            naoLido ? cn(visual.fundo, "border-l-primary") : "border-l-transparent opacity-60",
                          )}
                        >
                          <Icone className={cn("mt-0.5 h-4 w-4 shrink-0", visual.classe)} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {aviso.title}
                              {aviso.event_count > 1 && (
                                <span className="ml-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                                  ×{aviso.event_count}
                                </span>
                              )}
                            </p>
                            {aviso.description && (
                              <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                                {aviso.description}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(instanteDoAviso(aviso)), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </p>
                          </div>
                          {naoLido && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </motion.div>
                      );
                    })}
                  </div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center">
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-success/30" />
            <p className="text-sm text-muted-foreground">
              {familia === "tudo"
                ? "Tudo em dia! Nenhuma notificação pendente."
                : "Nada nesta aba. Tente outra família."}
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
