import { memo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { useResponsibleMembers } from "@/modules/identity";
import { useUpdateLead } from "../../../../hooks/useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useOptimisticConflictHandler } from "@/shared/hooks/useOptimisticConflictHandler";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { useLeadOwnersEnabled } from "../../../../hooks/useLeadOwners";
import {
  recusaDeDonos,
  useAddLeadOwner,
  useRemoveLeadOwner,
  useTransferLeadOwner,
} from "../../../../hooks/useLeadOwnersMutations";
import { notifyError } from "@/shared/errors";
import { useAcaoOtimista } from "@/shared/espera";
import { OptimisticLockConflictError } from "@/modules/platform/lib/optimistic-lock";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ResponsibleSlotProps {
  leadId: string;
  field: "pre_sale_responsible_id" | "sale_responsible_id";
  label: string;
  currentMember: { id: string; name: string; avatar_url?: string | null } | null;
  /**
   * Lead `updated_at` snapshot at render time. When provided, the
   * mutation runs with optimistic locking (#307) — a concurrent edit
   * triggers a toast + force-refetch instead of silent overwrite.
   */
  expectedUpdatedAt?: string | null;
}

type Membro = NonNullable<ResponsibleSlotProps["currentMember"]>;
/** Override local do avatar enquanto a troca não confirma (`null` = slot vazio). */
type Otimista = { membro: Membro | null } | null;

function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function colorFromName(name: string): string {
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/** Quanto a troca espera o eco do servidor antes de destravar o slot. */
const PRAZO_DO_ECO_MS = 8_000;

export const ResponsibleSlot = memo(function ResponsibleSlot({
  leadId,
  field,
  label,
  currentMember,
  expectedUpdatedAt,
}: ResponsibleSlotProps) {
  const members = useResponsibleMembers();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const handleConflict = useOptimisticConflictHandler();
  const { canReassign } = useLeadActionGates(leadId);
  const donosMultiplos = useLeadOwnersEnabled();
  const transfer = useTransferLeadOwner(leadId);
  const addCoOwner = useAddLeadOwner(leadId);
  const removeCoOwner = useRemoveLeadOwner(leadId);
  // Padrão do CTO (08/10): quem passa o lead adiante continua como co-dono.
  const [keepPrevious, setKeepPrevious] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const denied = !canReassign.allowed;

  const filtered = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  /**
   * Esvaziar o slot é UPDATE, e o gatilho do banco decide sozinho o destino de
   * quem saiu pela ORIGEM da linha (principal vindo do backfill sai de vez;
   * vindo de transferência vira co-dono). Aqui a escolha do checkbox manda,
   * igual nos dois casos: manter = garantir a linha de co-dono; não manter =
   * apagá-la. As duas RPCs são idempotentes. PT409 = a pessoa ainda é principal
   * no OUTRO papel, e então não há o que ajustar.
   */
  const ajustarCoDonoDeQuemSaiu = async (saiuId: string, manter: boolean) => {
    try {
      if (manter) await addCoOwner.mutateAsync(saiuId);
      else await removeCoOwner.mutateAsync(saiuId);
    } catch (err) {
      if ((err as { code?: string })?.code === "PT409") return;
      notifyError(err, {
        fallback: "O responsável saiu, mas não foi possível ajustar o co-dono.",
        message: recusaDeDonos(err as { code?: string; message?: string }),
      });
    }
  };

  /**
   * Troca OTIMISTA de escopo local (régua de espera, CX ①): o avatar muda no
   * clique e o popover fecha; a gravação corre por trás. `useLeads.ts` fica
   * intocado — o otimismo é deste slot, não do `useUpdateLead` (uso amplo,
   * colidiria com o optimistic lock #307).
   *
   * Conflito do lock (#307) ou recusa da RPC de donos: o aviso de sempre, e o
   * avatar volta para o que o servidor tem. Outra falha: volta e avisa.
   *
   * UMA TROCA POR VEZ. O slot trava da escolha até o servidor ecoar a troca
   * (`updated_at`/responsável novos no `lead-detail`). Uma 2ª escolha antes
   * disso levaria o `expectedUpdatedAt` antigo e o lock #307 a recusaria —
   * conflito falso e recarga — e executaria sobre o responsável antigo do
   * servidor, não sobre o que a tela mostra (removeria o co-dono errado).
   */
  const [otimista, setOtimista] = useState<Otimista>(null);
  // Troca confirmada cujo eco (refetch do lead-detail) ainda não chegou.
  const [aguardandoEco, setAguardandoEco] = useState(false);
  // O `updated_at` mais recente que a tela recebeu — para saber, no fim da
  // gravação, se o eco já chegou ANTES dela responder (realtime/refetch rápido).
  const ultimoUpdatedAt = useRef(expectedUpdatedAt);
  ultimoUpdatedAt.current = expectedUpdatedAt;
  // O dado do servidor chegou (refetch pós-troca, ou outra edição): ele manda.
  useEffect(() => {
    setOtimista(null);
    setAguardandoEco(false);
  }, [currentMember?.id, expectedUpdatedAt]);
  // A trava do eco nunca é eterna: o refetch do lead-detail falhou, ou o eco
  // não veio no prazo → solta. A próxima troca pode dar conflito #307 (aviso +
  // recarga de sempre), o que é melhor que um slot morto até remontar.
  const qc = useQueryClient();
  useEffect(() => {
    if (!aguardandoEco) return;
    const soltar = () => setAguardandoEco(false);
    const prazo = setTimeout(soltar, PRAZO_DO_ECO_MS);
    const parar = qc.getQueryCache().subscribe((ev) => {
      if (ev.type !== "updated" || ev.action.type !== "error") return;
      const [raiz, id] = ev.query.queryKey as unknown[];
      if (raiz === "lead-detail" && id === leadId) soltar();
    });
    return () => {
      clearTimeout(prazo);
      parar();
    };
  }, [aguardandoEco, qc, leadId]);
  const exibido: Membro | null = otimista ? otimista.membro : currentMember;

  const trocar = useAcaoOtimista<
    {
      next: string | null;
      membro: Membro | null;
      newName: string;
      /** Quem a tela mostrava no clique — a base da troca, não o cache do servidor. */
      anterior: Membro | null;
      /** `updated_at` que a tela tinha no clique. */
      baseUpdatedAt: string | null | undefined;
      manterAnterior: boolean;
    },
    { tratado: boolean },
    Otimista
  >({
    mutationKey: ["lead-responsavel", leadId, field],
    // Rede de segurança: se duas trocas chegarem a ser pedidas, nunca correm
    // juntas. A garantia de "uma por vez" é a trava `ocupado` abaixo.
    scope: `lead-responsavel:${leadId}:${field}`,
    aplicar: (_qc, v) => {
      const antes = otimista;
      setOtimista({ membro: v.membro });
      return antes;
    },
    reverter: (_qc, snap) => setOtimista(snap),
    alvos: () => [["lead-detail", leadId]],
    mensagemDeErro: () => "Falha ao atualizar responsável.",
    executar: async ({ next, anterior, manterAnterior }) => {
      try {
        if (donosMultiplos && next) {
          // Org com N donos: trocar o principal é TRANSFERÊNCIA (RPC), que mantém
          // o anterior como co-dono. Esvaziar o slot continua sendo UPDATE.
          await transfer.mutateAsync({
            toMemberId: next,
            role: field === "sale_responsible_id" ? "venda" : "pre_venda",
            keepPrevious: manterAnterior && !!anterior,
          });
        } else {
          await updateLead.mutateAsync({
            id: leadId,
            [field]: next,
            ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          } as Parameters<typeof updateLead.mutateAsync>[0]);
          if (donosMultiplos && !next && anterior) await ajustarCoDonoDeQuemSaiu(anterior.id, manterAnterior);
        }
        return { tratado: false };
      } catch (err) {
        // Falhas que já têm aviso próprio viram `tratado`: um aviso só, e quem
        // desfaz o avatar é o `aoConfirmar`.
        if (err instanceof OptimisticLockConflictError) {
          // Aviso + recarga do jeito de sempre (#307).
          handleConflict(err, { leadId });
          return { tratado: true };
        }
        if (donosMultiplos) {
          // Org com N donos: a recusa em PT da RPC de donos vira o texto do aviso.
          notifyError(err, {
            fallback: "Falha ao atualizar responsável.",
            message: recusaDeDonos(err as { code?: string; message?: string }),
          });
          return { tratado: true };
        }
        throw err;
      }
    },
    aoConfirmar: ({ tratado }, { newName, baseUpdatedAt }) => {
      if (tratado) {
        setOtimista(null);
        return;
      }
      // Sem lock (#307) não há `updated_at` a esperar: a próxima troca já pode.
      // O eco já chegou antes da resposta (updated_at mudou desde o clique):
      // travar agora seria esperar algo que já passou.
      if (baseUpdatedAt && ultimoUpdatedAt.current === baseUpdatedAt) setAguardandoEco(true);
      logAction({
        leadId,
        action: "field_updated",
        description: `${label} alterado para "${newName}"`,
      });
      toast.success(`${label}: ${newName}`);
    },
  });

  const ocupado = trocar.isPending || aguardandoEco;

  const handleSelect = (memberId: string | null) => {
    if (ocupado) return;
    const next = memberId === exibido?.id ? null : memberId;
    const alvo = members.find((m) => m.id === next) ?? null;
    const membro: Membro | null = alvo
      ? { id: alvo.id, name: alvo.name, avatar_url: (alvo as { avatar_url?: string | null }).avatar_url ?? null }
      : null;
    setOpen(false);
    trocar.mutate({
      next,
      membro,
      newName: alvo?.name ?? "Nenhum",
      anterior: exibido,
      manterAnterior: keepPrevious,
      baseUpdatedAt: expectedUpdatedAt,
    });
  };

  const hasMember = !!exibido;

  return (
    <TooltipProvider delayDuration={300}>
      {/* `modal` + `z-[70]`: este Popover vive dentro de um Dialog (e de um Sheet no
          celular). Sem `modal`, o `react-remove-scroll` do Dialog engole o `wheel`
          e a lista nao rola; sem `z-[70]`, o `z-50` do primitivo perde para o
          `z-[51]` do `SheetContent` e ela nao pinta. #1862/#1867. */}
      <Popover open={open} onOpenChange={setOpen} modal>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={denied || ocupado}
                aria-busy={ocupado || undefined}
                aria-label={`${label}${hasMember ? `: ${exibido.name}` : " — adicionar"}`}
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all",
                  hasMember
                    ? "shadow-sm hover:scale-105"
                    : "border border-dashed border-border/60 hover:border-primary/60 hover:bg-primary/5",
                  denied && "opacity-50 cursor-not-allowed hover:scale-100",
                  ocupado && !denied && "cursor-progress hover:scale-100",
                )}
                style={hasMember ? { backgroundColor: colorFromName(exibido.name) } : undefined}
              >
                {hasMember ? (
                  exibido.avatar_url ? (
                    <img src={exibido.avatar_url} alt={exibido.name}
                         className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-white">
                      {initials(exibido.name)}
                    </span>
                  )
                ) : (
                  <Plus className="w-4 h-4 text-muted-foreground/70" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {denied
              ? "Sem permissão — peça acesso ao seu admin"
              : `${label}${hasMember ? `: ${exibido.name}` : ""}`}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="z-[70] w-64 p-2">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1">
              {label}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <Input
                placeholder="Buscar vendedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            {donosMultiplos && hasMember && (
              <label className="flex cursor-pointer items-center gap-2 px-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={keepPrevious}
                  onChange={(e) => setKeepPrevious(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="truncate">Manter {exibido.name} como co-dono</span>
              </label>
            )}
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {hasMember && (
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-destructive hover:bg-destructive/10"
                >
                  <X className="w-3.5 h-3.5" /> Remover {exibido.name}
                </button>
              )}
              {filtered.length === 0 && (
                <div className="text-xs text-muted-foreground/60 text-center py-3">
                  Nenhum vendedor encontrado
                </div>
              )}
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted",
                    exibido?.id === m.id && "bg-muted"
                  )}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: colorFromName(m.name) }}
                  >
                    <span className="text-[9px] font-semibold text-white">{initials(m.name)}</span>
                  </div>
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
