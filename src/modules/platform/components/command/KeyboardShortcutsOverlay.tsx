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
    title: "Navegação",
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
    <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-card-border bg-card px-1.5 text-[11px] font-semibold text-foreground/75 shadow-relevo">
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
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                {group.title}
              </h4>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-xl px-2.5 py-1.5 hover:bg-muted/50"
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
