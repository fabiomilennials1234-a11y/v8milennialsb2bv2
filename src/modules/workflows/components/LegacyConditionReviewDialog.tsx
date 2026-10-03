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
  semantic_change: { label: "Mudança revisável", className: "border-transparent bg-insights/10 text-insights" },
  requires_mapping: { label: "Exige seleção", className: "border-transparent bg-warning/15 text-warning-strong" },
  unsupported: { label: "Sem equivalência", className: "border-transparent bg-destructive/10 text-destructive" },
  preserved_wait: { label: "Permanece legado", className: "border-transparent bg-muted text-foreground/80" },
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
        <div className="flex gap-3 rounded-2xl border border-success/20 bg-success/[.06] p-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div><p className="font-semibold">Execução antiga preservada</p>
            <p className="mt-1 text-muted-foreground">O clique final cria somente um rascunho separado. Publicação e autorização continuam obrigatórias.</p></div>
        </div>
      </div>
      <ScrollArea className="max-h-[52vh] px-6">
        <div className="space-y-3 py-5">
          {review.items.map(item => <article key={item.nodeId} className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-semibold">{item.label}</p><p className="mt-0.5 text-xs text-muted-foreground">Node {item.nodeId}</p></div>
              <Badge variant="outline" className={STATUS[item.kind].className}>{STATUS[item.kind].label}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="rounded-xl bg-sunken p-3"><span className="block text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Antes</span>{item.before}</div>
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="rounded-xl bg-sunken p-3"><span className="block text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Novo</span>{item.after}</div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{item.details}</p>
          </article>)}
        </div>
      </ScrollArea>
      <DialogFooter className="border-t px-6 py-4 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {review.blockingCount > 0 && <><AlertTriangle className="h-4 w-4 text-warning-strong" />
            {review.blockingCount} {review.blockingCount === 1 ? "item exige" : "itens exigem"} correção antes de publicar.</>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isCreating}>Cancelar</Button>
          <Button type="button" onClick={onCreateDraft} disabled={isCreating}>
            {isCreating && <Loader2 className="animate-spin" />}
            Criar rascunho para revisão
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
