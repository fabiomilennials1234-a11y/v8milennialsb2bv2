/**
 * CommandPalette — diálogo ⌘K com cmdk + Framer Motion.
 *
 * C24: base visual completa.
 * - Backdrop blur + dialog com tokens command-palette-bg/border (hue cool 220°)
 * - AnimatePresence: scale 0.96→1 + opacity + y -8, 180ms ease-out
 * - prefers-reduced-motion: só opacity
 * - Focus trap via cmdk nativo (autoFocus no input)
 * - Restore focus: gerenciado pelo CommandPaletteProvider
 * - Groups: Navigation, Actions, Conversations, Recentes
 * - Footer de hints ↑↓ ↵ esc
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
  CommandSeparator,
} from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "./CommandPaletteContext";
import { CommandGroupNavigation } from "./groups/CommandGroupNavigation";
import { CommandGroupActions } from "./groups/CommandGroupActions";
import { CommandGroupConversations } from "./groups/CommandGroupConversations";
import { CommandGroupRecents } from "./groups/CommandGroupRecents";
import { CommandGroupMessages } from "./groups/CommandGroupMessages";

// ─── prefers-reduced-motion hook ─────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// ─── Variantes de animação ────────────────────────────────────────────────────

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  hidden: { opacity: 0, scale: 0.96, y: -8 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: -8 },
};

const reducedDialogVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

// ─── Componente ──────────────────────────────────────────────────────────────

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const prefersReduced = usePrefersReducedMotion();
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Fechar no Escape (cmdk já faz internamente, mas garantir pelo dialog wrapper)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isOpen, close]);

  // Reset query ao fechar
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  const activeVariants = prefersReduced ? reducedDialogVariants : dialogVariants;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop ─────────────────────────────────────────────────── */}
          <motion.div
            key="palette-backdrop"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: prefersReduced ? 0.15 : 0.15, ease: "easeOut" }}
            className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md"
            onClick={close}
            aria-hidden="true"
          />

          {/* ── Palette dialog ───────────────────────────────────────────── */}
          <motion.div
            key="palette-dialog"
            variants={activeVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: prefersReduced ? 0.15 : 0.18, ease: "easeOut" }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
            ref={containerRef}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Paleta de comandos"
              className={cn(
                "w-full max-w-[640px]",
                "rounded-xl border shadow-2xl",
                "bg-[hsl(var(--command-palette-bg))]",
                "border-[hsl(var(--command-palette-border))]",
                "overflow-hidden"
              )}
            >
              <Command
                loop
                className="flex flex-col"
                shouldFilter={true}
              >
                {/* ── Input ───────────────────────────────────────────── */}
                <div className="relative flex items-center border-b border-border/60">
                  <Search
                    className="absolute left-4 h-4 w-4 shrink-0 text-muted-foreground pointer-events-none"
                    aria-hidden="true"
                  />
                  <CommandInput
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Buscar ações, conversas, leads..."
                    autoFocus
                    className={cn(
                      "w-full h-12 pl-10 pr-4 text-sm",
                      "bg-transparent",
                      "placeholder:text-muted-foreground/60",
                      "focus:outline-none",
                      "border-0 ring-0 focus:ring-0",
                      "[&:not([cmdk-input])]:hidden"
                    )}
                  />
                </div>

                {/* ── Lista ───────────────────────────────────────────── */}
                <CommandList className="max-h-[400px] overflow-y-auto overflow-x-hidden">
                  <CommandEmpty className="py-10 text-center">
                    <p className="text-sm text-muted-foreground">Nenhum resultado</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Tente &quot;leads&quot;, &quot;analytics&quot; ou o nome de um contato
                    </p>
                  </CommandEmpty>

                  {/* Recentes — só quando query vazia */}
                  {!query && <CommandGroupRecents onClose={close} />}

                  {/* Navegação */}
                  <CommandGroupNavigation onClose={close} />
                  <CommandSeparator className="my-1 bg-border/40" />

                  {/* Ações */}
                  <CommandGroupActions onClose={close} />
                  <CommandSeparator className="my-1 bg-border/40" />

                  {/* Conversas */}
                  <CommandGroupConversations onClose={close} />

                  {/* Mensagens — full-text search (C35), só quando query > 3 chars */}
                  {query.length >= 3 && (
                    <>
                      <CommandSeparator className="my-1 bg-border/40" />
                      <CommandGroupMessages query={query} onClose={close} />
                    </>
                  )}
                </CommandList>

                {/* ── Footer de hints ──────────────────────────────────── */}
                <div
                  className={cn(
                    "flex items-center gap-4 px-4 py-2",
                    "border-t border-border/40",
                    "text-[10px] text-muted-foreground/70"
                  )}
                >
                  <span>
                    <kbd className="font-mono">↑↓</kbd> navegar
                  </span>
                  <span>
                    <kbd className="font-mono">↵</kbd> selecionar
                  </span>
                  <span>
                    <kbd className="font-mono">esc</kbd> fechar
                  </span>
                </div>
              </Command>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
