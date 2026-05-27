import { memo, useState, type ReactNode } from "react";
import { Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * ActionPanel — slide-down container for Meeting/Budget editors. Absorbs
 * the kebab menu that replaces the standalone "Remover de {pipe}" CTA
 * that previously lived inline at the bottom of each accordion section.
 */
interface ActionPanelProps {
  children: ReactNode;
  /** Label rendered in the remove confirmation dialog ("Remover de {pipeLabel}"). */
  pipeLabel: string;
  /** Hide kebab entirely if user can't remove. */
  canRemove: boolean;
  /** Called on confirmed remove. */
  onRemove: () => Promise<void> | void;
  isRemoving?: boolean;
}

export const ActionPanel = memo(function ActionPanel({
  children,
  pipeLabel,
  canRemove,
  onRemove,
  isRemoving = false,
}: ActionPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async () => {
    await onRemove();
    setConfirmOpen(false);
  };

  return (
    <div className="overflow-hidden motion-safe:animate-[panel-down_220ms_cubic-bezier(0.16,1,0.3,1)]">
      <div
        className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-4
                   shadow-[0_1px_2px_hsl(var(--background)/0.5),0_0_0_1px_hsl(var(--primary)/0.08)]
                   relative"
        data-testid="action-panel"
      >
        {canRemove && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-7 w-7"
                  aria-label={`Mais opções de ${pipeLabel}`}
                  data-testid={`action-panel-kebab-${pipeLabel}`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setConfirmOpen(true)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`action-panel-remove-trigger-${pipeLabel}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  Remover de {pipeLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover de {pipeLabel}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Lead continua existindo. Métricas deste pipe vão ignorar
                    este lead. Ação irreversível.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleConfirm}
                    disabled={isRemoving}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid={`action-panel-remove-confirm-${pipeLabel}`}
                  >
                    {isRemoving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "Remover"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        {children}
      </div>
    </div>
  );
});
