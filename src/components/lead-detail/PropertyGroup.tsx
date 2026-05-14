import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PropertyGroupProps {
  label: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
}

export function PropertyGroup({ label, children, defaultCollapsed = false }: PropertyGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between w-full text-[9px] uppercase tracking-[1px] text-muted-foreground/50 font-semibold hover:text-muted-foreground transition-colors py-1"
      >
        {label}
        <ChevronDown className={cn("w-3 h-3 transition-transform duration-150", collapsed && "-rotate-90")} />
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-150",
          collapsed ? "max-h-0 opacity-0" : "max-h-[1000px] opacity-100"
        )}
        style={{ visibility: collapsed ? "hidden" : "visible" }}
      >
        {children}
      </div>
    </div>
  );
}
