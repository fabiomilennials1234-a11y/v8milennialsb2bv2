/**
 * MentionPopover — seletor de menção (@) em conversa de grupo.
 *
 * Mesmo contrato visual e de teclado do `SlashCommandPopover`: ancorado acima
 * do campo, ↑↓ navegam, Enter/Tab escolhem, Esc fecha. As teclas são lidas na
 * captura do `document` para o Enter não virar "enviar" no textarea.
 *
 * Sem opção nenhuma (termo que não casa com "Todos" nem com ninguém) o popover
 * não aparece e não segura tecla: Enter volta a enviar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneBR } from "@/shared/format/phone";
import {
  buildMentionOptions,
  type GroupParticipant,
  type MentionOption,
} from "@/modules/communication/lib/groupMentionComposer";

interface MentionPopoverProps {
  query: string;
  participants: readonly GroupParticipant[] | undefined;
  loading?: boolean;
  onSelect: (token: string) => void;
  onClose: () => void;
  className?: string;
}

function initials(name: string | null): string {
  if (!name) return "#";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "#";
}

export function MentionPopover({ query, participants, loading, onSelect, onClose, className }: MentionPopoverProps) {
  const options = useMemo(() => buildMentionOptions(participants, query), [participants, query]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelectedIndex(0), [query]);
  const active = Math.min(selectedIndex, Math.max(options.length - 1, 0));

  const choose = useCallback((option: MentionOption | undefined) => {
    if (option) onSelect(option.token);
  }, [onSelect]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(Math.min(active + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(Math.max(active - 1, 0));
    } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      choose(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }, [active, options, choose, onClose]);

  const hasOptions = options.length > 0;
  useEffect(() => {
    if (!hasOptions) return;
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown, hasOptions]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!hasOptions) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Mencionar participante"
      className={cn(
        "absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border/70 bg-popover p-1 shadow-lg z-50",
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = i === active;
        const isAll = option.kind === "all";
        const name = isAll ? "Todos" : option.participant.name;
        return (
          <button
            key={isAll ? "__all" : option.participant.phone}
            type="button"
            role="option"
            aria-selected={selected}
            data-index={i}
            // Mantém o foco no campo: o clique não pode disparar o blur que fecha.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => choose(option)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
              selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                isAll ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {isAll ? <Users className="h-3.5 w-3.5" /> : initials(name)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {name ?? formatPhoneBR(option.kind === "participant" ? option.participant.phone : "")}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {isAll
                  ? "Notifica todo mundo do grupo"
                  : name
                    ? formatPhoneBR(option.participant.phone)
                    : "Sem nome no WhatsApp"}
              </span>
            </span>
            {!isAll && option.participant.isAdmin && (
              <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Admin
              </span>
            )}
          </button>
        );
      })}
      {loading && (
        <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Carregando participantes…
        </div>
      )}
    </div>
  );
}
