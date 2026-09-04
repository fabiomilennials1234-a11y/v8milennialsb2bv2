// src/components/chat-meta/LinkLeadDialog.tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useLeads, type Lead } from "@/modules/leads";
import { useMetaLinkLead } from "@/modules/communication/hooks/chat-meta/useMetaLinkLead";
import { toast } from "sonner";

interface Props {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LinkLeadDialog({ conversationId, open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  // Real useLeads signature: { page?, searchQuery?, filterOrigin? }
  const { data: leads, isLoading } = useLeads({ searchQuery: search });
  const linkLead = useMetaLinkLead();

  async function handleSelect(leadId: string) {
    try {
      await linkLead.mutateAsync({ conversationId, leadId });
      toast.success("Lead vinculado");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao vincular lead");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular conversa a um lead</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Buscar por nome, telefone ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="max-h-[300px] overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!isLoading &&
            (leads ?? []).map((l: Lead) => (
              <button
                key={l.id}
                type="button"
                onClick={() => handleSelect(l.id)}
                className="flex w-full flex-col items-start rounded px-3 py-2 text-left hover:bg-muted"
              >
                <span className="font-medium">{l.name ?? "Sem nome"}</span>
                {l.phone && (
                  <span className="text-xs text-muted-foreground">
                    {l.phone}
                  </span>
                )}
              </button>
            ))}
          {!isLoading && (!leads || leads.length === 0) && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nenhum lead encontrado.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
