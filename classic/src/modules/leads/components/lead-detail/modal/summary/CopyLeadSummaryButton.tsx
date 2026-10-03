import { useRef, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";
import { loadLeadSummary } from "./load-summary";

export function CopyLeadSummaryButton({
  leadId,
  entryId,
}: {
  leadId: string;
  entryId: string;
}) {
  const { organizationId } = useOrganization();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [manualText, setManualText] = useState("");
  const inFlight = useRef(false);
  const scope = useRef({ leadId, organizationId, entryId });
  scope.current = { leadId, organizationId, entryId };

  async function copy(button: HTMLButtonElement) {
    if (inFlight.current || !organizationId) return;
    const pending = () =>
      client.isMutating() > 0 ||
      Boolean(
        button
          .closest("[role=dialog]")
          ?.querySelector('[data-summary-pending="true"]'),
      );
    if (pending()) {
      toast.info("Salve as alterações do card antes de copiar o resumo.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const text = await loadLeadSummary(leadId, organizationId, entryId);
      if (
        !button.isConnected ||
        scope.current.leadId !== leadId ||
        scope.current.entryId !== entryId ||
        scope.current.organizationId !== organizationId
      )
        return;
      if (pending())
        throw new Error(
          "Card em edição. Salve as alterações e copie novamente.",
        );
      try {
        await navigator.clipboard.writeText(text);
        toast.success("Resumo copiado");
      } catch {
        // Safari or restricted clipboard: preserve the complete text for manual copy.
        setManualText(text);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível copiar o resumo. Tente novamente.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs shrink-0"
        disabled={busy || !organizationId}
        onClick={(event) => void copy(event.currentTarget)}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {busy ? "Preparando…" : "Copiar resumo"}
      </Button>
      <Dialog
        open={Boolean(manualText)}
        onOpenChange={(open) => {
          if (!open) setManualText("");
        }}
      >
        <DialogContent className="z-[60]" overlayClassName="z-[60]">
          <DialogTitle>Resumo do negócio</DialogTitle>
          <DialogDescription>
            Navegador bloqueou a cópia automática. Selecione o texto e copie.
          </DialogDescription>
          <Textarea
            aria-label="Resumo do negócio para copiar"
            value={manualText}
            readOnly
            className="h-80"
            onFocus={(event) => event.target.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
