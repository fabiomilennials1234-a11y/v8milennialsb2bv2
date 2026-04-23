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

export interface DeletePipeCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  entityName?: string;
}

export function DeletePipeCardDialog({
  open,
  onOpenChange,
  onConfirm,
  entityName = "oportunidade",
}: DeletePipeCardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover do funil?</AlertDialogTitle>
          <AlertDialogDescription>
            Você irá remover esta {entityName} do funil. O lead será mantido no sistema e pode ser readicionado depois.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Remover do funil
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface DeleteStageLeadsDialogProps {
  stageToDelete: { id: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (stageId: string, stageTitle: string) => Promise<void> | void;
  funnelName: string;
  isPending?: boolean;
}

export function DeleteStageLeadsDialog({
  stageToDelete,
  onOpenChange,
  onConfirm,
  funnelName,
  isPending,
}: DeleteStageLeadsDialogProps) {
  return (
    <AlertDialog open={!!stageToDelete} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Excluir todos os leads da etapa "{stageToDelete?.title}"?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação irá excluir todos os leads que estão na etapa "{stageToDelete?.title}" do funil de{" "}
            <strong>{funnelName}</strong> e da base de dados (histórico, tags, etc.). Leads em outras
            etapas não serão afetados.
            <span className="block mt-2 text-destructive font-medium">Não é possível desfazer.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => stageToDelete && onConfirm(stageToDelete.id, stageToDelete.title)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending}
          >
            {isPending ? "Excluindo..." : "Excluir leads desta etapa"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
