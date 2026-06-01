import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatEmptyStateProps {
  contactName: string;
  instanceName?: string;
  onOpenTemplates: () => void;
}

export function ChatEmptyState({ contactName, instanceName, onOpenTemplates }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
        <MessageCircle className="w-8 h-8 text-muted-foreground/40" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold mb-1.5">Comece a conversa</h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-5">
        Primeira interação com{" "}
        <span className="font-medium text-foreground">{contactName}</span>
        {instanceName ? (
          <>
            {" "}no inbox{" "}
            <span className="font-medium text-foreground">{instanceName}</span>
          </>
        ) : null}
        . Envie uma mensagem abaixo ou use{" "}
        <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border border-border">
          /
        </kbd>{" "}
        para templates.
      </p>
      <Button variant="outline" size="sm" onClick={onOpenTemplates}>
        Ver templates
      </Button>
    </div>
  );
}
