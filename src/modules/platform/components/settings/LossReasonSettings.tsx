import { useState, type FormEvent } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIdentity, useOrganization } from "@/modules/identity";
import {
  canEditLossReasons,
  LOSS_REASON_NAME_MAX_LENGTH,
  useLossReasons,
  useRenameLossReason,
} from "@/modules/pipelines";
import { notifyError } from "@/shared/errors";
import { CartaoDeAjustes } from "./settings-ui";

export function LossReasonSettings() {
  const { organizationId } = useOrganization();
  const { isAdmin } = useIdentity();
  if (!canEditLossReasons(organizationId, isAdmin)) return null;
  // Trocar a organização desmonta o formulário e descarta qualquer rascunho.
  return <LossReasonEditor key={organizationId} />;
}

function LossReasonEditor() {
  const { data: reasons = [], isLoading, isError, refetch } = useLossReasons();
  const rename = useRenameLossReason();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const original = reasons.find((reason) => reason.id === editingId);
  const valid = name.trim().length > 0 && name.trim().length <= LOSS_REASON_NAME_MAX_LENGTH;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!original || !valid || rename.isPending || name.trim() === original.name) return;
    try {
      await rename.mutateAsync({ id: original.id, name: name.trim() });
      setEditingId(null);
      toast.success("Motivo de perda atualizado.");
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível atualizar o motivo de perda. Tente novamente." });
    }
  }

  return (
    <CartaoDeAjustes
      titulo="Motivos de perda"
      descricao="Edite os nomes usados ao marcar um negócio como perdido. As perdas já registradas mantêm o nome da época."
    >
      {isLoading ? (
        <p role="status" className="py-4 text-sm text-muted-foreground">Carregando motivos de perda…</p>
      ) : isError ? (
        <div role="alert" className="space-y-3 py-4">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os motivos de perda.</p>
          <Button variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      ) : reasons.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Nenhum motivo de perda cadastrado.</p>
      ) : (
        <ul className="divide-y divide-border">
          {reasons.map((reason) => (
            <li key={reason.id} className="py-3 first:pt-1 last:pb-1">
              {editingId === reason.id ? (
                <form onSubmit={save} className="space-y-3" aria-label={`Editar motivo ${reason.name}`}>
                  <label htmlFor={`loss-reason-${reason.id}`} className="text-sm font-bold">Nome do motivo</label>
                  <Input
                    id={`loss-reason-${reason.id}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={LOSS_REASON_NAME_MAX_LENGTH}
                    disabled={rename.isPending}
                    autoFocus
                    required
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" disabled={rename.isPending} onClick={() => setEditingId(null)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={!valid || name.trim() === reason.name || rename.isPending}>
                      {rename.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {rename.isPending ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-words text-sm font-medium">{reason.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={rename.isPending}
                    aria-label={`Editar motivo ${reason.name}`}
                    onClick={() => { setEditingId(reason.id); setName(reason.name); }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Editar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </CartaoDeAjustes>
  );
}
