import { cn } from "@/lib/utils";
import type { LeadsUiVersion } from "../../hooks/useLeadsUiVersion";

/**
 * Controle segmentado Antes / Depois — par do hook `useLeadsUiVersion`.
 * Sai junto com o ramo "antes" quando a versão nova for aprovada.
 */
const OPTIONS: { value: LeadsUiVersion; label: string }[] = [
  { value: "antes", label: "Antes" },
  { value: "depois", label: "Depois" },
];

export function LeadsUiVersionToggle({
  value,
  onChange,
}: {
  value: LeadsUiVersion;
  onChange: (v: LeadsUiVersion) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Versão da interface"
      className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-full rounded-md px-3 text-[12.5px] font-medium tracking-[-0.005em]",
              "transition-[background-color,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
