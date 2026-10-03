import { AlertCircle, Lock, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { LeadVisibility, LeadVisibilityMetadata } from "../hooks/useLeadDetail";

interface LeadVisibilityStateProps {
  visibility: Exclude<LeadVisibility, "loading" | "exists">;
  metadata: LeadVisibilityMetadata;
  onClose: () => void;
  /** Optional restore action; only shown when caller can soft-delete. */
  onRestore?: () => void;
  canRestore?: boolean;
}

/**
 * Renders the four non-exists outcomes from `can_view_lead` (#290).
 * Each variant is a centered, focused card — no toolbar, no body.
 * The intent is to make WHY the lead is unavailable explicit so the
 * user can act (close, ask admin, restore).
 */
export function LeadVisibilityState({
  visibility,
  metadata,
  onClose,
  onRestore,
  canRestore = false,
}: LeadVisibilityStateProps) {
  const { Icon, title, description } = stateContent(visibility, metadata);

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mb-5">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <h2 className="text-base font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-6">
        {description}
      </p>
      <div className="flex items-center gap-2">
        {visibility === "deleted" && canRestore && onRestore && (
          <Button onClick={onRestore} variant="default">
            Restaurar
          </Button>
        )}
        <Button onClick={onClose} variant={visibility === "deleted" && canRestore ? "outline" : "default"}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

function stateContent(
  visibility: Exclude<LeadVisibility, "loading" | "exists">,
  metadata: LeadVisibilityMetadata,
): { Icon: typeof AlertCircle; title: string; description: string } {
  switch (visibility) {
    case "not_found":
      return {
        Icon: Search,
        title: "Lead não encontrado",
        description:
          "Esse lead não existe — pode ter sido removido por outro usuário ou o link está velho.",
      };
    case "deleted": {
      const when = metadata.deleted_at
        ? formatDistanceToNow(new Date(metadata.deleted_at), { addSuffix: true, locale: ptBR })
        : null;
      return {
        Icon: Trash2,
        title: "Lead na lixeira",
        description: when
          ? `Esse lead foi removido ${when}. Admins podem restaurar antes da retenção expirar.`
          : "Esse lead foi removido. Admins podem restaurar antes da retenção expirar.",
      };
    }
    case "permission_denied":
      return {
        Icon: Lock,
        title: "Sem permissão",
        description:
          "Você não tem acesso a esse lead. Peça ao admin da sua organização para te dar permissão.",
      };
    default: {
      const _exhaustive: never = visibility;
      return {
        Icon: AlertCircle,
        title: "Estado desconhecido",
        description: String(_exhaustive),
      };
    }
  }
}
