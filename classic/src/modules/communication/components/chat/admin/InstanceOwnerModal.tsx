/**
 * InstanceOwnerModal — admin/master-only.
 *
 * Lista as instâncias da org e permite vincular uma a um team_member
 * (responsável do lead). Confirmação inline quando substituir owner
 * existente. RPC: `set_instance_owner(p_instance_id, p_new_owner_team_member_id, p_reason)`.
 *
 * Spec visual: Obsidian/.../06 — Features/whatsapp-write-instance/02-ui-states.md §Modal "Vincular número".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MessageSquareDashed,
  Search,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWhatsAppInstances } from "@/modules/communication/hooks/useWhatsAppInstances";

type InstanceRow = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string;
  // owner_team_member_id é nova coluna (Etapa A) — types.ts ainda não regen.
  owner_team_member_id?: string | null;
};

interface InstanceOwnerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Team member alvo (geralmente o responsável do lead). */
  targetTeamMemberId: string;
  /** Nome (display) do team_member alvo, p/ description e confirmação. */
  targetTeamMemberName?: string | null;
  /** Quando vínculo é concluído com sucesso. */
  onLinked?: (instanceId: string) => void;
}

function formatPhone(raw: string | null): string {
  if (!raw) return "Sem número";
  const digits = raw.replace(/\D/g, "");
  // BR pattern: 55 11 9 9123-4567
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 5)} ${digits.slice(5, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return raw;
}

function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Conectado";
    case "connecting":
      return "Conectando";
    case "disconnected":
      return "Desconectado";
    default:
      return status || "Desconhecido";
  }
}

export function InstanceOwnerModal({
  open,
  onOpenChange,
  targetTeamMemberId,
  targetTeamMemberName,
  onLinked,
}: InstanceOwnerModalProps) {
  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Reset state when modal opens.
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedId(null);
      setConfirming(false);
      // Focus search on open (microtask).
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const setOwnerMutation = useMutation({
    mutationFn: async (args: { instanceId: string; reason: string }) => {
      // RPC `set_instance_owner` adicionada na migration 20260930000000.
      // Types.ts ainda não regen (bloqueio MCP) — cast explícito é seguro
      // porque o contrato é validado no backend (Etapa A).
      // `.bind(supabase)` é obrigatório: `const rpc = supabase.rpc` destaca o
      // método e supabase-js lê `this.rest` — sem receiver estoura
      // `Cannot read properties of undefined (reading 'rest')` antes da rede.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc("set_instance_owner", {
        p_instance_id: args.instanceId,
        p_new_owner_team_member_id: targetTeamMemberId,
        p_reason: args.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      const inst = (instances as InstanceRow[]).find((i) => i.id === vars.instanceId);
      toast.success("Número vinculado", {
        description: `${inst?.instance_name ?? "Número"} agora pertence a ${targetTeamMemberName ?? "este vendedor"}.`,
      });
      // Invalida tudo que depende de owner.
      queryClient.invalidateQueries({ queryKey: ["lead-write-instance"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances_with_agent"] });
      onLinked?.(vars.instanceId);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      // supabase.rpc rejeita com objeto plain { message, code, ... } —
      // não Error instance. Cobrir ambos os shapes pra reconhecer códigos.
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : String(err);
      if (msg.includes("INVALID_OWNER")) {
        toast.error("Não foi possível vincular", {
          description: "Este vendedor não está ativo nesta organização.",
        });
      } else if (msg.includes("FORBIDDEN")) {
        toast.error("Sem permissão", {
          description: "Apenas administradores podem vincular números.",
        });
      } else {
        toast.error("Falha ao vincular número", {
          description: "Verifique a conexão e tente novamente.",
        });
      }
    },
  });

  // Ordem da lista: Disponível → Em uso → Atual; conectados antes de desconectados; alfabético.
  const ordered = useMemo<InstanceRow[]>(() => {
    const filtered = (instances as InstanceRow[]).filter((i) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        i.instance_name.toLowerCase().includes(q) ||
        (i.phone_number ?? "").toLowerCase().includes(q)
      );
    });
    const groupOf = (i: InstanceRow): number => {
      if (i.owner_team_member_id === targetTeamMemberId) return 2; // Atual
      if (!i.owner_team_member_id) return 0; // Disponível
      return 1; // Em uso
    };
    return [...filtered].sort((a, b) => {
      const ga = groupOf(a);
      const gb = groupOf(b);
      if (ga !== gb) return ga - gb;
      const ca = a.status === "connected" ? 0 : 1;
      const cb = b.status === "connected" ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.instance_name.localeCompare(b.instance_name);
    });
  }, [instances, search, targetTeamMemberId]);

  const selected = ordered.find((i) => i.id === selectedId) ?? null;
  const isReplacing =
    !!selected &&
    !!selected.owner_team_member_id &&
    selected.owner_team_member_id !== targetTeamMemberId;

  // Quando entra em modo confirming, foco vai pro botão "Confirmar e vincular".
  useEffect(() => {
    if (confirming) {
      requestAnimationFrame(() => confirmBtnRef.current?.focus());
    }
  }, [confirming]);

  // Keyboard nav: ↑↓ para mover seleção, Enter para confirmar.
  const onKeyDownList = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (ordered.length === 0) return;
    const idx = ordered.findIndex((i) => i.id === selectedId);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = idx < 0 ? 0 : Math.min(idx + 1, ordered.length - 1);
      setSelectedId(ordered[next].id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = idx <= 0 ? 0 : idx - 1;
      setSelectedId(ordered[prev].id);
    } else if (e.key === "Enter" && selectedId) {
      e.preventDefault();
      handlePrimaryAction();
    }
  };

  const handlePrimaryAction = () => {
    if (!selected) return;
    if (isReplacing && !confirming) {
      setConfirming(true);
      return;
    }
    setOwnerMutation.mutate({
      instanceId: selected.id,
      reason: confirming ? "admin_replace_owner" : "admin_assign_owner",
    });
  };

  const empty = !isLoading && instances.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle className="text-[16px] font-semibold tracking-tight">
            Vincular número de WhatsApp
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            {targetTeamMemberName
              ? `Conecte um número de WhatsApp a ${targetTeamMemberName}.`
              : "Conecte um número de WhatsApp a este vendedor."}
          </DialogDescription>
        </DialogHeader>

        {empty ? (
          <div className="min-h-[280px] flex flex-col items-center justify-center text-center px-6 py-8">
            <div className="rounded-xl border border-border/60 bg-muted/40 p-3 mb-3">
              <MessageSquareDashed className="w-8 h-8 text-muted-foreground" aria-hidden />
            </div>
            <h3 className="text-[15px] font-semibold text-foreground tracking-tight mb-1">
              Nenhum número conectado
            </h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[36ch] mb-4">
              Esta organização ainda não tem números de WhatsApp configurados.
            </p>
            <Button asChild className="gradient-primary text-white border-0">
              <a href="/configuracoes">Ir para WhatsApp</a>
            </Button>
          </div>
        ) : (
          <div className="px-5 pt-3 pb-2">
            <div className="relative mb-3">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar número, instância ou telefone…"
                aria-label="Buscar número"
                className="pl-9"
                disabled={confirming}
              />
            </div>
            <div
              role="radiogroup"
              aria-label="Números disponíveis"
              tabIndex={0}
              onKeyDown={onKeyDownList}
              className="max-h-[400px] overflow-y-auto flex flex-col gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            >
              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground motion-reduce:animate-none motion-reduce:opacity-70" />
                </div>
              )}
              {!isLoading && ordered.length === 0 && (
                <p className="text-[13px] text-muted-foreground text-center py-6">
                  Nenhum número corresponde à busca.
                </p>
              )}
              {!isLoading &&
                ordered.map((inst) => {
                  const isSelected = inst.id === selectedId;
                  const isCurrent = inst.owner_team_member_id === targetTeamMemberId;
                  const isInUse =
                    !!inst.owner_team_member_id && !isCurrent;
                  const isAvailable = !inst.owner_team_member_id;
                  const isInactive = inst.status !== "connected";
                  return (
                    <button
                      type="button"
                      key={inst.id}
                      role="radio"
                      aria-checked={isSelected}
                      disabled={confirming}
                      onClick={() => setSelectedId(inst.id)}
                      className={cn(
                        "text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border/60 hover:bg-muted/40",
                        confirming && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 w-3.5 h-3.5 rounded-full border shrink-0",
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-muted-foreground/40",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[14px] font-medium text-foreground tracking-tight truncate">
                            {inst.instance_name}
                          </span>
                          {isAvailable && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/20">
                              Disponível
                            </span>
                          )}
                          {isInUse && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
                              Em uso
                            </span>
                          )}
                          {isCurrent && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                              Atual
                            </span>
                          )}
                        </div>
                        <p
                          className={cn(
                            "text-[12px] tabular-nums mt-0.5 flex items-center gap-1.5",
                            isInactive ? "text-warning" : "text-muted-foreground",
                          )}
                        >
                          {isInactive && (
                            <AlertTriangle
                              className="w-3 h-3 shrink-0"
                              aria-hidden
                            />
                          )}
                          <span>
                            {formatPhone(inst.phone_number)} · {statusLabel(inst.status)}
                          </span>
                        </p>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {!empty && (
          <>
            {!confirming && selected && selected.status !== "connected" && (
              <div
                role="status"
                aria-live="polite"
                className="border-t border-warning/20 bg-warning/5 px-4 py-2.5 flex items-center gap-3"
              >
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" aria-hidden />
                <p className="text-[12px] text-foreground/85 leading-snug">
                  Este número está <span className="font-medium">{statusLabel(selected.status).toLowerCase()}</span>.
                  O vendedor verá o composer bloqueado até reconectar.
                </p>
              </div>
            )}
            {confirming && selected && (
              <div
                role="alertdialog"
                aria-live="polite"
                className="border-t border-warning/20 bg-warning/5 px-4 py-3 flex items-center gap-3"
              >
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground">
                    Substituir vínculo deste número?
                  </p>
                  <p className="text-[12px] text-muted-foreground leading-snug">
                    O vendedor anterior perderá acesso de envio por este número.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60 bg-background">
              {confirming ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setConfirming(false)}
                    disabled={setOwnerMutation.isPending}
                  >
                    Voltar
                  </Button>
                  <Button
                    ref={confirmBtnRef}
                    type="button"
                    variant="destructive"
                    onClick={handlePrimaryAction}
                    disabled={setOwnerMutation.isPending}
                  >
                    {setOwnerMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none motion-reduce:opacity-70" />
                    ) : null}
                    Confirmar e vincular
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={setOwnerMutation.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={handlePrimaryAction}
                    disabled={!selected || setOwnerMutation.isPending}
                    className="gradient-primary text-white border-0"
                  >
                    {setOwnerMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none motion-reduce:opacity-70" />
                    ) : null}
                    Vincular
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

