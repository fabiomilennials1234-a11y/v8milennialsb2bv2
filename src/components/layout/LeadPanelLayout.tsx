import { type ReactNode, useEffect } from "react";
import { useLeadSheet } from "@/components/lead-detail/hooks/useLeadSheet";
import { cn } from "@/lib/utils";

interface LeadPanelLayoutProps {
  children: ReactNode;
  panel?: ReactNode;
}

export function LeadPanelLayout({ children, panel }: LeadPanelLayoutProps) {
  const { isOpen } = useLeadSheet();
  const panelVisible = isOpen && !!panel;

  useEffect(() => {
    if (!panelVisible) return;
    const wrapper = document.querySelector('[data-layout="main"] > main > div') as HTMLElement | null;
    const main = document.querySelector('[data-layout="main"] > main') as HTMLElement | null;
    if (wrapper) {
      wrapper.style.setProperty("max-width", "none", "important");
      wrapper.style.setProperty("padding", "0", "important");
      wrapper.style.setProperty("height", "100%", "important");
      wrapper.style.setProperty("min-height", "0", "important");
    }
    if (main) {
      main.style.setProperty("overflow", "hidden", "important");
    }
    return () => {
      wrapper?.style.removeProperty("max-width");
      wrapper?.style.removeProperty("padding");
      wrapper?.style.removeProperty("height");
      wrapper?.style.removeProperty("min-height");
      main?.style.removeProperty("overflow");
    };
  }, [panelVisible]);

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={cn(
          "flex-1 min-w-0 overflow-auto transition-all duration-200 ease-out",
          panelVisible && "max-w-[45%]"
        )}
      >
        {children}
      </div>
      {panelVisible && (
        <div className="flex-1 min-w-[480px] border-l border-border bg-background animate-in slide-in-from-right-5 duration-200">
          {panel}
        </div>
      )}
    </div>
  );
}
