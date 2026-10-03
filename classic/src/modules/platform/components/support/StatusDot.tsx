import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/modules/platform/lib/support-ticket-draft";

/**
 * `aguardando_cliente` é o único estado em que a bola pisca para o usuário:
 * é ele quem está segurando o chamado, e é o estado em que o relógio de
 * resposta do suporte para de correr.
 */
const STATUS_STYLES: Record<TicketStatus, string> = {
  aberto: "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]",
  em_andamento: "bg-sky-500",
  aguardando_cliente: "bg-amber-500 animate-pulse",
  resolvido: "bg-emerald-500",
  fechado: "bg-muted-foreground/40",
};

export function StatusDot({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", STATUS_STYLES[status], className)}
    />
  );
}
