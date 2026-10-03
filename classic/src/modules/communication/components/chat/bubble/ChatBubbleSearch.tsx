/**
 * Search bar do Bubble — debounce 200ms, foco automático ao montar.
 *
 * Cmd/Ctrl+K dentro do painel foca este input (handler vive no painel).
 * Esc dentro do input limpa query (handler local); painel cuida do Esc-2x.
 */
import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ChatBubbleSearchProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

export function ChatBubbleSearch({ value, onChange, autoFocus = true }: ChatBubbleSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      // pequeno delay pro animation entry do painel não roubar o foco
      const t = window.setTimeout(() => inputRef.current?.focus(), 220);
      return () => window.clearTimeout(t);
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && value) {
      e.stopPropagation();
      onChange("");
    }
  };

  return (
    <div className="px-3 py-2 border-b border-border/40 bg-popover">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none"
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar contato ou número"
          aria-label="Buscar conversa"
          className="
            h-9 pl-8 pr-8
            bg-muted/40 border-0
            rounded-lg
            text-sm placeholder:text-muted-foreground/60
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0
          "
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground/60 hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
