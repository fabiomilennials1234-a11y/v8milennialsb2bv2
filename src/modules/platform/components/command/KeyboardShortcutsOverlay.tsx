import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl";

interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}

const groups: ShortcutGroup[] = [
  {
    title: "Geral",
    items: [
      { keys: [mod, "K"], label: "Command Palette" },
      { keys: [mod, "B"], label: "Toggle sidebar" },
      { keys: ["?"], label: "Mostrar atalhos" },
    ],
  },
  {
    title: "Navegacao",
    items: [
      { keys: ["G", "D"], label: "Dashboard" },
      { keys: ["G", "L"], label: "Leads" },
      { keys: ["G", "W"], label: "Funil padrão" },
      { keys: ["G", "F"], label: "Funis" },
      { keys: ["G", "M"], label: "Chat" },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-medium rounded border border-border bg-muted text-muted-foreground">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-2">
          {groups.map((group) => (
            <div key={group.title}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group.title}
              </h4>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
                  >
                    <span className="text-sm">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <span className="text-muted-foreground text-xs mx-0.5">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
