import { memo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center justify-center min-w-[24px] h-6 px-1.5",
        "rounded border border-border bg-muted text-xs font-mono font-medium",
        "text-muted-foreground shadow-sm"
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
          {i > 0 && <span className="text-[10px] text-muted-foreground mx-0.5">then</span>}
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
            <Keyboard className="w-5 h-5 text-primary" />
            Atalhos de teclado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {Object.entries(grouped).map(([scope, items]) => (
            <div key={scope}>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                {scope}
              </h3>
              <div className="space-y-1.5">
                {items.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    {renderKeys(shortcut.keys)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Pressione <KeyBadge>?</KeyBadge> para abrir/fechar
        </p>
      </DialogContent>
    </Dialog>
  );
});
