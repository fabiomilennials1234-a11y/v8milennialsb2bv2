import { useState } from "react";
import { Archive, ArchiveRestore, ListChecks, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/shared/errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useConversationBatch } from "../../../hooks/chat/useConversationBatch";
import { contactKey, contactLabel } from "../../../hooks/chat/types";
import { useNomeDoLeadPrimeiro } from "@/modules/communication/hooks/chat/useNomeDoLeadPrimeiro";
import type { BatchContact, ConversationBatchAction } from "../../../lib/conversationBatch";

interface Props {
  organizationId: string;
  isAdmin: boolean;
  archived: boolean;
  selecting: boolean;
  disabled: boolean;
  eligible: BatchContact[];
  selected: BatchContact[];
  onSelecting: (selecting: boolean) => void;
  onSelection: (keys: Set<string>) => void;
  onBusy: (busy: boolean) => void;
}

export function ConversationBulkToolbar({ organizationId, isAdmin, archived, selecting, disabled, eligible, selected, onSelecting, onSelection, onBusy }: Props) {
  const batch = useConversationBatch(organizationId, isAdmin);
  const nomeDoLeadPrimeiro = useNomeDoLeadPrimeiro();
  // Freeze the reviewed set; incoming messages cannot silently change the confirmation.
  const [deleting, setDeleting] = useState<BatchContact[] | null>(null);
  const busy = batch.isPending;
  const run = async (action: ConversationBatchAction, contacts = selected) => {
    if (busy || disabled || contacts.length === 0) return;
    onBusy(true);
    try {
      const result = await batch.mutateAsync({ action, contacts });
      onSelection(new Set(result.failed.map(contactKey)));
      const verb = action === "delete" ? "excluídas" : action === "archive" ? "arquivadas" : "desarquivadas";
      if (result.failed.length) {
        const message = `${result.succeeded.length} ${verb}; ${result.failed.length} falharam. As que falharam continuam marcadas para tentar novamente.`;
        notifyError(result.errors[0], { fallback: message, message, context: { feature: "conversation-batch" } });
      } else {
        toast.success(`${result.succeeded.length} conversas ${verb}.`);
        onSelecting(false);
      }
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível concluir a ação nas conversas." });
    } finally {
      onBusy(false);
    }
  };
  return (
    <div className="shrink-0 border-y border-foreground/10 px-3 py-2">
      {!selecting ? (
        <Button variant="ghost" size="sm" onClick={() => onSelecting(true)} disabled={disabled || !eligible.length}>
          <ListChecks className="mr-2 h-4 w-4" /> Selecionar conversas
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Checkbox aria-label="Selecionar todas as conversas exibidas" disabled={busy || disabled}
              checked={selected.length === eligible.length && eligible.length > 0 ? true : selected.length ? "indeterminate" : false}
              onCheckedChange={value => onSelection(new Set(value === true ? eligible.map(contactKey) : []))} />
            <span className="flex-1 text-xs font-medium" role="status">{selected.length} selecionadas</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Cancelar seleção" disabled={busy}
              onClick={() => { onSelection(new Set()); onSelecting(false); }}><X className="h-4 w-4" /></Button>
          </div>
          <p className="mb-2 mt-1 text-[11px] text-muted-foreground">Selecionar todas marca apenas as conversas carregadas neste filtro.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || disabled || !selected.length} onClick={() => void run(archived ? "unarchive" : "archive")}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              {archived ? "Desarquivar" : "Arquivar"}
            </Button>
            {isAdmin && <Button size="sm" variant="outline" className="text-destructive" disabled={busy || disabled || !selected.length}
              onClick={() => setDeleting([...selected])}><Trash2 className="mr-2 h-4 w-4" /> Excluir</Button>}
          </div>
        </>
      )}
      <AlertDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleting?.length} {deleting?.length === 1 ? "conversa" : "conversas"}?</AlertDialogTitle>
            <AlertDialogDescription>
              As conversas irão para a lixeira por 30 dias, antes da exclusão definitiva. Os leads serão mantidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 overflow-auto text-sm">{deleting?.map(c => <li key={contactKey(c)}>{contactLabel(c, { nomeDoLeadPrimeiro })}</li>)}</ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!isAdmin || busy || disabled} className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleting) void run("delete", deleting); }}>Excluir conversas</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
