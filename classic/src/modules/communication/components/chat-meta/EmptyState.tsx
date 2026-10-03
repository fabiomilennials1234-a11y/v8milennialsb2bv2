// src/components/chat-meta/EmptyState.tsx
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Instagram } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-muted p-4">
        <Instagram className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Nenhuma página Meta conectada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte uma página Facebook ou conta Instagram para começar a receber e responder mensagens.
        </p>
      </div>
      <Button asChild>
        <Link to="/configuracoes?tab=integracoes">Ir para Integrações</Link>
      </Button>
    </div>
  );
}
