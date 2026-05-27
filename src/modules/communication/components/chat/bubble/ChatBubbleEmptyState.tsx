/**
 * Estados vazios do Chat Bubble.
 * - "no-conversations": user não tem msgs ainda
 * - "no-instance": user não tem instância WhatsApp conectada/permitida
 * - "filtered-empty": instância filtrada não tem conversas (com CTA reset)
 */
import { Link } from "react-router-dom";
import { Filter, MessageCircleDashed, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChatBubbleEmptyStateProps =
  | { variant: "no-conversations" }
  | { variant: "no-instance" }
  | { variant: "filtered-empty"; instanceName: string; onReset: () => void };

export function ChatBubbleEmptyState(props: ChatBubbleEmptyStateProps) {
  if (props.variant === "no-instance") {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
        <PlugZap className="w-8 h-8 text-warning/70" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">
            Nenhum WhatsApp conectado
          </p>
          <p className="text-xs text-muted-foreground">
            Conecte um número pra começar a conversar com leads.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/configuracoes/whatsapp">Conectar WhatsApp</Link>
        </Button>
      </div>
    );
  }

  if (props.variant === "filtered-empty") {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
        <Filter className="w-7 h-7 text-muted-foreground/40" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">
            Nenhuma conversa em {props.instanceName}
          </p>
          <p className="text-xs text-muted-foreground">
            Tente outra instância ou veja todas.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={props.onReset}>
          Ver todas as conversas
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
      <MessageCircleDashed className="w-8 h-8 text-muted-foreground/40" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground/80">
          Nenhuma conversa por aqui
        </p>
        <p className="text-xs text-muted-foreground">
          Quando alguém responder no WhatsApp, aparece aqui.
        </p>
      </div>
    </div>
  );
}
