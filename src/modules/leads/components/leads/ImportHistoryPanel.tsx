import { useState } from "react";
import { FileSpreadsheet, RotateCcw, CheckCircle2, AlertCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useImportBatches, useRollbackImport, type ImportBatch } from "@/modules/leads/hooks/useImportBatches";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function ImportHistoryPanel() {
  const { data: batches, isLoading } = useImportBatches();
  const rollback = useRollbackImport();
  const [confirmBatch, setConfirmBatch] = useState<ImportBatch | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!batches?.length) {
    return (
      <div className="text-center py-12">
        <FileSpreadsheet className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Nenhuma importação registrada.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {batches.map((batch) => (
          <div
            key={batch.id}
            className={cn(
              "rounded-lg border p-4 transition-colors",
              batch.rolled_back
                ? "bg-muted/30 border-border/50 opacity-60"
                : "bg-card border-border hover:border-primary/30"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                  batch.rolled_back ? "bg-muted" : "bg-primary/10"
                )}>
                  <FileSpreadsheet className={cn(
                    "w-4.5 h-4.5",
                    batch.rolled_back ? "text-muted-foreground" : "text-primary"
                  )} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {batch.file_name || "Importação sem nome"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    por {batch.created_by_name} · {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
              </div>

              {!batch.rolled_back && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={() => setConfirmBatch(batch)}
                  disabled={rollback.isPending}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Reverter
                </Button>
              )}

              {batch.rolled_back && (
                <Badge variant="outline" className="shrink-0 bg-muted text-muted-foreground border-border">
                  <XCircle className="w-3 h-3 mr-1" />
                  Revertida
                </Badge>
              )}
            </div>

            <div className="flex gap-4 mt-3 ml-12">
              <Stat
                icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                label="Importados"
                value={batch.imported_count}
              />
              <Stat
                icon={<AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                label="Ignorados"
                value={batch.skipped_count}
              />
              <Stat
                icon={<XCircle className="w-3.5 h-3.5 text-destructive" />}
                label="Erros"
                value={batch.error_count}
              />
              <div className="text-xs text-muted-foreground ml-auto">
                {format(new Date(batch.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </div>
            </div>

            {batch.rolled_back && batch.rolled_back_at && (
              <p className="text-[11px] text-muted-foreground mt-2 ml-12">
                Revertida em {format(new Date(batch.rolled_back_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </p>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={!!confirmBatch} onOpenChange={(open) => !open && setConfirmBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverter importação?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai remover {confirmBatch?.imported_count} leads criados pela importação
              {confirmBatch?.file_name ? ` "${confirmBatch.file_name}"` : ""}. Os leads serão movidos
              para a lixeira e podem ser restaurados em até 30 dias.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmBatch) {
                  rollback.mutate(confirmBatch.id);
                  setConfirmBatch(null);
                }
              }}
            >
              {rollback.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="w-4 h-4 mr-2" />
              )}
              Reverter importação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-xs font-medium">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
