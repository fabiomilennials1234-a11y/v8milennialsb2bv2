/**
 * CommandGroupMessages — grupo de busca full-text de mensagens no Command Palette.
 *
 * C34: renderiza resultados de search_messages RPC quando query > 3 chars.
 *
 * Segurança:
 *   - headline HTML vem da RPC com <mark> — sanitizado via HighlightedText (C37/B5)
 *   - Não renderiza quando query < 3 chars (guard client-side + RPC guard)
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { CommandGroup, CommandItem } from "cmdk";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useMessageSearch } from "@/hooks/chat/useMessageSearch";
import { HighlightedText } from "@/components/chat/search/HighlightedText";
import { pushRecent } from "../recentCommands";

// ─── Props ────────────────────────────────────────────────────────────────────

interface CommandGroupMessagesProps {
  query: string;
  onClose: () => void;
}

// ─── Formatação ───────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "agora";
    if (diffMins < 60) return `${diffMins}min`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function CommandGroupMessages({ query, onClose }: CommandGroupMessagesProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { results, isLoading, activeQuery, search } = useMessageSearch();

  // Sincronizar query prop com o hook (debounce interno no hook)
  const searchRef = useRef(search);
  useEffect(() => { searchRef.current = search; }, [search]);

  useEffect(() => {
    searchRef.current(query);
  }, [query]);

  if (query.length < 3) return null;

  const handleSelect = (phoneNumber: string) => {
    if (user?.id) {
      pushRecent(user.id, `msg-search-${phoneNumber}`);
    }
    navigate(`/chat?phone=${encodeURIComponent(phoneNumber)}`);
    onClose();
  };

  return (
    <CommandGroup
      heading="Mensagens"
      className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
    >
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && results.length === 0 && activeQuery.length >= 3 && (
        <div className="px-3 py-3 text-xs text-muted-foreground/70 text-center">
          Nenhuma mensagem encontrada para &quot;{activeQuery}&quot;
        </div>
      )}

      {!isLoading && results.map((result) => {
        const itemId = `msg-${result.id}`;
        return (
          <CommandItem
            key={itemId}
            value={`${itemId} ${result.phone_number} ${result.message}`}
            onSelect={() => handleSelect(result.phone_number)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
              "cursor-default select-none",
              "aria-selected:bg-muted/60",
              "hover:bg-muted/40",
              "transition-colors duration-75"
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {result.phone_number}
                </span>
                {result.direction === "outgoing" ? (
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground/60 shrink-0" aria-label="Enviada" />
                ) : (
                  <ArrowDownLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" aria-label="Recebida" />
                )}
                <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
                  {formatRelative(result.timestamp)}
                </span>
              </div>
              <HighlightedText
                html={result.headline}
                className="text-sm leading-tight line-clamp-2 text-foreground"
              />
            </div>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
