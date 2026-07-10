import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DockItem, DockOrder } from "@/modules/platform/components/dock/FloatingDock";
import { useSupportUnread } from "@/modules/platform/hooks/useSupportUnread";
import { useSupportPanel } from "./SupportPanelContext";

/**
 * A porta de entrada do Suporte, no dock.
 *
 * O badge é a metade visível do loop de volta: o cliente vive dentro do CRM o
 * dia inteiro, e é aqui que ele descobre que o suporte respondeu (ADR-0018).
 */
export function SupportFab() {
  const { open, isOpen } = useSupportPanel();
  const { total } = useSupportUnread();

  return (
    <DockItem order={DockOrder.support}>
      <button
        type="button"
        onClick={open}
        aria-label={
          total > 0
            ? `Ajuda — ${total} resposta${total > 1 ? "s" : ""} não lida${total > 1 ? "s" : ""}`
            : "Ajuda"
        }
        title="Ajuda"
        className={cn(
          // Sempre dourado: o Suporte é o "?" do dock, não um botão neutro.
          "relative grid h-11 w-11 place-items-center rounded-full border transition-colors",
          "border-primary/40 bg-primary/10 text-primary backdrop-blur",
          "shadow-lg hover:border-primary/60 hover:bg-primary/20",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isOpen && "border-primary/60 bg-primary/20",
        )}
      >
        <HelpCircle className="h-5 w-5" aria-hidden />

        {total > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-background bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
    </DockItem>
  );
}
