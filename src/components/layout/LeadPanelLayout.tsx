import { type ReactNode } from "react";
import { useLeadSheet } from "@/components/lead-detail/hooks/useLeadSheet";
import { cn } from "@/lib/utils";

interface LeadPanelLayoutProps {
  children: ReactNode;
  panel?: ReactNode;
}

export function LeadPanelLayout({ children, panel }: LeadPanelLayoutProps) {
  const { isOpen } = useLeadSheet();

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={cn(
          "flex-1 min-w-0 overflow-auto transition-all duration-200 ease-out",
          isOpen && panel && "max-w-[45%]"
        )}
      >
        {children}
      </div>
      {isOpen && panel && (
        <div className="flex-1 min-w-[480px] border-l border-border bg-background animate-in slide-in-from-right-5 duration-200">
          {panel}
        </div>
      )}
    </div>
  );
}
