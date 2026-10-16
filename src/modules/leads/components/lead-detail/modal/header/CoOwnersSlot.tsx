import { memo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useResponsibleMembers } from "@/modules/identity";
import { notifyError } from "@/shared/errors";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { useLeadOwners } from "../../../../hooks/useLeadOwners";
import {
  recusaDeDonos,
  useAddLeadOwner,
  useRemoveLeadOwner,
} from "../../../../hooks/useLeadOwnersMutations";
import type { LeadOwner, LeadOwnerRole } from "../../../../lib/lead-owners";
import { OwnerAvatar } from "./OwnerAvatar";

interface CoOwnersSlotProps {
  leadId: string;
}

/** Quantos avatares cabem no botão antes do "+N". */
const MAX_AVATARES = 3;

const ROTULO_DO_PAPEL: Record<LeadOwnerRole, string> = {
  venda: "Venda",
  pre_venda: "Pré-Venda",
  co: "Co-dono",
};

/** "Venda · Pré-Venda" quando a mesma pessoa é principal nos dois papéis. */
function rotuloDosPapeis(owner: LeadOwner): string {
  return owner.papeis.map((p) => ROTULO_DO_PAPEL[p]).join(" · ");
}

const ehCoDono = (o: LeadOwner) => o.papeis.length === 1 && o.papeis[0] === "co";

/**
 * Co-donos do lead (Chamado 793f4b05). O dono PRINCIPAL continua nos slots de
 * Pré-Venda e Venda; aqui moram as pessoas que também enxergam e editam o lead
 * sem serem o dono de comissão/métrica. Quem chama só renderiza este slot com a
 * flag `lead_owners_n_donos` ligada — o banco recusa a escrita sem ela.
 */
export const CoOwnersSlot = memo(function CoOwnersSlot({ leadId }: CoOwnersSlotProps) {
  const members = useResponsibleMembers();
  const { data: owners = [] } = useLeadOwners(leadId, true);
  const add = useAddLeadOwner(leadId);
  const remove = useRemoveLeadOwner(leadId);
  const logAction = useLogLeadAction();
  const { canReassign } = useLeadActionGates(leadId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const denied = !canReassign.allowed;
  const busy = add.isPending || remove.isPending;

  const coDonos = owners.filter(ehCoDono);
  // Principais (e o `responsible_id` legado, sem papel): só leitura aqui.
  const principais = owners.filter((o) => !ehCoDono(o));
  const jaDonos = new Set(owners.map((o) => o.id));
  const candidatos = members.filter(
    (m) => !jaDonos.has(m.id) && m.name.toLowerCase().includes(search.toLowerCase()),
  );

  const visiveis = coDonos.slice(0, MAX_AVATARES);
  const extras = coDonos.length - visiveis.length;
  const resumo = coDonos.length
    ? `Co-donos: ${coDonos.map((o) => o.name).join(", ")}`
    : "Co-donos — adicionar";

  const handleAdd = async (memberId: string, name: string) => {
    try {
      await add.mutateAsync(memberId);
    } catch (err) {
      notifyError(err, {
        fallback: "Não foi possível adicionar o co-dono.",
        message: recusaDeDonos(err as { code?: string; message?: string }),
      });
      return;
    }
    logAction({ leadId, action: "field_updated", description: `Co-dono adicionado: "${name}"` });
    toast.success(`Co-dono: ${name}`);
    setSearch("");
  };

  const handleRemove = async (owner: LeadOwner) => {
    try {
      await remove.mutateAsync(owner.id);
    } catch (err) {
      notifyError(err, {
        fallback: "Não foi possível remover o co-dono.",
        message: recusaDeDonos(err as { code?: string; message?: string }),
      });
      return;
    }
    logAction({ leadId, action: "field_updated", description: `Co-dono removido: "${owner.name}"` });
    toast.success(`${owner.name} saiu dos co-donos`);
  };

  return (
    <TooltipProvider delayDuration={300}>
      {/* `modal` + `z-[70]`: mesmo motivo de ResponsibleSlot (#1862/#1867) — o
          Popover vive dentro de um Dialog/Sheet e perderia o scroll e a pintura. */}
      <Popover open={open} onOpenChange={setOpen} modal>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={denied}
                aria-label={resumo}
                className={cn(
                  "flex h-9 items-center rounded-full transition-all",
                  coDonos.length === 0
                    ? "w-9 justify-center border border-dashed border-border/60 hover:border-primary/60 hover:bg-primary/5"
                    : "pl-0.5 pr-1 hover:scale-105",
                  denied && "cursor-not-allowed opacity-50 hover:scale-100",
                )}
              >
                {coDonos.length === 0 ? (
                  <Plus className="h-4 w-4 text-muted-foreground/70" />
                ) : (
                  <span className="flex items-center -space-x-2">
                    {visiveis.map((o) => (
                      <OwnerAvatar
                        key={o.id}
                        name={o.name}
                        avatarUrl={o.avatarUrl}
                        size={30}
                        className="ring-2 ring-background"
                      />
                    ))}
                    {extras > 0 && (
                      <span className="z-10 inline-flex h-[30px] min-w-[30px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
                        +{extras}
                      </span>
                    )}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {denied ? "Sem permissão — peça acesso ao seu admin" : resumo}
          </TooltipContent>
        </Tooltip>

        <PopoverContent align="end" className="z-[70] w-72 p-2">
          <div className="space-y-2">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Donos do lead
            </div>

            {/* Principais: só leitura aqui — trocam nos slots de Pré-Venda e Venda. */}
            {principais.length > 0 && (
              <ul className="space-y-0.5">
                {principais.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
                    <OwnerAvatar name={o.name} avatarUrl={o.avatarUrl} size={24} />
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {o.papeis.length > 0 ? rotuloDosPapeis(o) : "Responsável"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {coDonos.length > 0 && (
              <ul className="space-y-0.5">
                {coDonos.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                  >
                    <OwnerAvatar name={o.name} avatarUrl={o.avatarUrl} size={24} />
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Co-dono
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remover ${o.name} dos co-donos`}
                      onClick={() => handleRemove(o)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="h-px bg-border/40" aria-hidden />

            <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Adicionar co-dono
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
              <Input
                placeholder="Buscar vendedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {candidatos.length === 0 && (
                <div className="py-3 text-center text-xs text-muted-foreground/60">
                  Nenhum vendedor disponível
                </div>
              )}
              {candidatos.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleAdd(m.id, m.name)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  <OwnerAvatar name={m.name} avatarUrl={m.avatar_url} size={24} />
                  <span className="truncate">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
});
