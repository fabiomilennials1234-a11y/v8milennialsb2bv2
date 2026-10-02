import { memo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip } from "@/components/ui/bento";

interface ShortcutDef {
  keys: string;
  description: string;
  scope?: string;
}

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutDef[];
}

function KeyBadge({ children }: { children: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-[24px] items-center justify-center px-1.5",
        "rounded-md border border-card-border bg-card font-mono text-xs font-semibold",
        "text-foreground/75 shadow-relevo"
      )}
    >
      {children}
    </kbd>
  );
}

function renderKeys(keys: string) {
  const parts = keys.split(" ");
  return (
    <div className="flex items-center gap-1">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="mx-0.5 text-[10px] text-muted-foreground">depois</span>}
          <KeyBadge>{part.toUpperCase()}</KeyBadge>
        </span>
      ))}
    </div>
  );
}

export const KeyboardShortcutsHelp = memo(function KeyboardShortcutsHelp({
  open,
  onOpenChange,
  shortcuts,
}: KeyboardShortcutsHelpProps) {
  // Group by scope
  const grouped = shortcuts.reduce<Record<string, ShortcutDef[]>>((acc, s) => {
    const scope = s.scope || "Geral";
    if (!acc[scope]) acc[scope] = [];
    acc[scope].push(s);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconChip icon={Keyboard} />
            Atalhos de teclado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {Object.entries(grouped).map(([scope, items]) => (
            <div key={scope}>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                {scope}
              </h3>
              <div className="space-y-1.5">
                {items.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between rounded-xl px-2.5 py-1.5 hover:bg-muted/50"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    {renderKeys(shortcut.keys)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Pressione <KeyBadge>?</KeyBadge> para abrir/fechar
        </p>
      </DialogContent>
    </Dialog>
  );
});
