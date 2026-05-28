/**
 * Pill discreto no topo da lista quando realtime está reconectando.
 *
 * Estado: detecção é responsabilidade do consumer (Bubble não tem hook
 * de status do channel). Quando o Provider expor isso no futuro, esse
 * componente recebe `isReconnecting` por prop e renderiza condicionalmente.
 *
 * Por hora, exportamos pronto pra uso opcional. PR3 não dispara — fica
 * preparado pra hardening do PR4.
 */
import { WifiOff } from "lucide-react";

interface ChatBubbleRealtimePillProps {
  show: boolean;
}

export function ChatBubbleRealtimePill({ show }: ChatBubbleRealtimePillProps) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 mx-3 mt-3 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/20 text-warning text-[11px]"
    >
      <WifiOff className="w-3 h-3" aria-hidden />
      <span>Reconectando…</span>
    </div>
  );
}
