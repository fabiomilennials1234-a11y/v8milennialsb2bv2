import { AlertTriangle, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LegacyConditionReview, LegacyConditionReviewKind } from "@/modules/workflows/lib/legacy-condition-review";

const STATUS: Record<LegacyConditionReviewKind, { label: string; className: string }> = {
  semantic_change: { label: "Mudança revisável", className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  requires_mapping: { label: "Exige seleção", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  unsupported: { label: "Sem equivalência", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  preserved_wait: { label: "Permanece legado", className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
};

export function LegacyConditionReviewDialog({
  open,
  onOpenChange,
  review,
  onCreateDraft,
  isCreating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: LegacyConditionReview;
  onCreateDraft: () => void;
  isCreating: boolean;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl p-0">
      <DialogHeader className="border-b px-6 pb-5 pt-6">
        <DialogTitle>Revisar condicionais legados</DialogTitle>
        <DialogDescription>
          Compare significado antes de criar a nova versão. Abrir esta revisão não altera a automação ativa.
        </DialogDescription>
      </DialogHeader>
      <div className="px-6 pt-5">
        <div className="flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div><p className="font-medium">Execução antiga preservada</p>
            <p className="mt-1 text-muted-foreground">O clique final cria somente um rascunho separado. Publicação e autorização continuam obrigatórias.</p></div>
        </div>
      </div>
      <ScrollArea className="max-h-[52vh] px-6">
        <div className="space-y-3 py-5">
          {review.items.map(item => <article key={item.nodeId} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-medium">{item.label}</p><p className="mt-0.5 text-xs text-muted-foreground">Node {item.nodeId}</p></div>
              <Badge variant="outline" className={STATUS[item.kind].className}>{STATUS[item.kind].label}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="rounded-lg bg-muted/50 p-3"><span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Antes</span>{item.before}</div>
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="rounded-lg bg-muted/50 p-3"><span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Novo</span>{item.after}</div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{item.details}</p>
          </article>)}
        </div>
      </ScrollArea>
      <DialogFooter className="border-t px-6 py-4 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {review.blockingCount > 0 && <><AlertTriangle className="h-4 w-4 text-amber-500" />
            {review.blockingCount} {review.blockingCount === 1 ? "item exige" : "itens exigem"} correção antes de publicar.</>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isCreating}>Cancelar</Button>
          <Button type="button" onClick={onCreateDraft} disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar rascunho para revisão
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
