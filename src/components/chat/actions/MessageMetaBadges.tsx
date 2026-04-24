/**
 * MessageMetaBadges — renderiza indicadores de estado do bubble:
 *  - "editado" badge (message.edited === true)
 *  - pin icon (pinned_at !== null)
 *  - reactions cluster (ex: "❤️ 3  👍 1")
 *  - strikethrough + "Mensagem apagada" quando deleted_at !== null
 *
 * Componente puro de presentation — consumidor passa os campos diretamente.
 */
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";

type Reaction = { emoji: string; from?: "me" | "them"; count?: number };

interface Props {
  edited?: boolean | null;
  pinnedAt?: string | null;
  deletedAt?: string | null;
  reactions?: unknown;
  className?: string;
}

function parseReactions(raw: unknown): Reaction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Reaction => !!r && typeof r === "object" && "emoji" in r)
    .map((r) => ({
      emoji: String((r as Reaction).emoji),
      from: (r as Reaction).from,
      count: typeof (r as Reaction).count === "number" ? (r as Reaction).count : 1,
    }));
}

/**
 * Renderiza o placeholder "Mensagem apagada" quando aplicável.
 * Retorna null se não deletada (consumidor deve renderizar conteúdo normal).
 */
export function DeletedPlaceholder({ deletedAt }: { deletedAt?: string | null }) {
  if (!deletedAt) return null;
  return (
    <p className="text-sm italic text-muted-foreground line-through">
      Mensagem apagada
    </p>
  );
}

/**
 * Renderiza indicadores ao redor/dentro do bubble:
 *  - Pin icon (topo)
 *  - Edited badge + Reactions cluster (rodapé)
 */
export function MessageMetaBadges({
  edited,
  pinnedAt,
  deletedAt,
  reactions,
  className,
}: Props) {
  const reactionsList = parseReactions(reactions);
  const hasAny = edited || pinnedAt || reactionsList.length > 0;
  if (!hasAny || deletedAt) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 mt-1", className)}>
      {pinnedAt && (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-primary/70"
          aria-label="Mensagem fixada"
        >
          <Pin className="h-3 w-3 fill-current" />
          fixada
        </span>
      )}
      {edited && (
        <span className="text-[10px] italic text-muted-foreground/60">editado</span>
      )}
      {reactionsList.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Reações">
          {reactionsList.map((r, i) => (
            <span
              key={`${r.emoji}-${r.from ?? "x"}-${i}`}
              className={cn(
                "inline-flex items-center gap-0.5 text-[11px] rounded-full px-1.5 py-0.5",
                r.from === "me"
                  ? "bg-primary/12 text-primary"
                  : "bg-muted/60 text-foreground/80"
              )}
            >
              <span>{r.emoji}</span>
              {r.count && r.count > 1 ? (
                <span className="font-medium">{r.count}</span>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
