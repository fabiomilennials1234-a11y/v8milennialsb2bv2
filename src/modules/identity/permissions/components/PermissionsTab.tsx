/**
 * PermissionsTab — Pitstop > Permissões
 *
 * Renderiza 12 toggles (em 7 grupos) que controlam o que o role 'member' pode
 * fazer na organização. Admin vê e edita; membro vê em modo read-only com banner.
 *
 * Design ref: Linear/Stripe/Vercel — dark-first, tabular, sem decoração inútil.
 * Spec literal: ver brief do design (2026-05-20).
 */

import { useMemo, useState } from "react";
import { Shield, Check, Info, AlertTriangle, RotateCcw, Lock } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";
import {
  PERMISSION_GROUPS,
  findPermissionByKey,
  type PermissionDef,
} from "@/lib/permission-catalog";
import { useOrgRolePermissions } from "../hooks/useOrgRolePermissions";
import { useUpdateRolePermission } from "../hooks/useUpdateRolePermission";
import { useResetOrgRolePermissions } from "../hooks/useResetOrgRolePermissions";
import { useIsAdmin } from "../hooks/useUserRole";
import { useMasterAuth } from "../../master/hooks/useMasterAuth";
import { useTeamMembers } from "../../org-team/hooks/useTeamMembers";

interface PendingConfirm {
  perm: PermissionDef;
  nextEnabled: boolean;
}

export function PermissionsTab() {
  const { values, isLoading } = useOrgRolePermissions();
  const { isAdmin } = useIsAdmin();
  const { isMaster } = useMasterAuth();
  const canEdit = isAdmin || isMaster;

  const updateMutation = useUpdateRolePermission();
  const resetMutation = useResetOrgRolePermissions();

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  // Member count for destructive modal context.
  const { data: members } = useTeamMembers();
  const activeMemberCount = useMemo(
    () => (members ?? []).filter((m: { is_active?: boolean; role?: string }) =>
      m.is_active !== false && m.role === "member",
    ).length,
    [members],
  );

  const handleToggle = (perm: PermissionDef, currentlyOn: boolean) => {
    const next = !currentlyOn;
    // Destructive guard: only when transitioning ON -> OFF.
    if (perm.destructive && currentlyOn && !next) {
      setPendingConfirm({ perm, nextEnabled: next });
      return;
    }
    performToggle(perm, next);
  };

  const performToggle = (perm: PermissionDef, next: boolean) => {
    const wasOn = !next;
    updateMutation.mutate(
      { key: perm.key, enabled: next },
      {
        onSuccess: () => {
          toast.success(
            `"${perm.label}" ${wasOn ? "desligado" : "ligado"} para membros.`,
          );
        },
        onError: () => {
          toast.error("Não foi possível atualizar. Tente de novo.");
        },
      },
    );
  };

  const handleConfirmDestructive = () => {
    if (!pendingConfirm) return;
    performToggle(pendingConfirm.perm, pendingConfirm.nextEnabled);
    setPendingConfirm(null);
  };

  const handleReset = () => {
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success("12 permissões resetadas para o padrão.");
        setResetOpen(false);
      },
      onError: () => {
        toast.error("Não foi possível resetar. Tente de novo.");
      },
    });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Permissões da organização
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Controle o que os membros podem fazer. Admins têm acesso total.
            </p>
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => setResetOpen(true)}
              disabled={resetMutation.isPending}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Resetar para padrão
            </Button>
          )}
        </div>

        {/* Read-only banner for members */}
        {!canEdit && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-muted/40">
            <Info className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <div className="text-sm text-muted-foreground">
              Você está vendo as permissões em modo leitura. Apenas administradores
              podem editar.
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border/60 overflow-hidden bg-card">
          {/* Sticky header */}
          <div className="grid grid-cols-[1fr_88px_88px] px-5 py-3 border-b border-border/60 bg-card/95 backdrop-blur sticky top-0 z-10">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">
              Permissão
            </div>
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted-foreground text-center">
              Admin
            </div>
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted-foreground text-center">
              Membro
            </div>
          </div>

          {/* Loading skeleton */}
          {isLoading ? (
            <div className="divide-y divide-border/40">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_88px_88px] min-h-[60px] px-5 py-3.5 items-center"
                >
                  <div className="space-y-2">
                    <div className="h-3.5 w-44 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-64 bg-muted/60 animate-pulse rounded" />
                  </div>
                  <div className="flex justify-center">
                    <div className="h-5 w-9 bg-muted animate-pulse rounded-full" />
                  </div>
                  <div className="flex justify-center">
                    <div className="h-6 w-11 bg-muted animate-pulse rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            PERMISSION_GROUPS.map((group, gi) => (
              <section
                key={group.id}
                aria-labelledby={`group-${group.id}`}
                className={cn(gi > 0 && "border-t border-border/40")}
              >
                <div
                  id={`group-${group.id}`}
                  className="px-5 pt-4 pb-2 text-[11px] uppercase tracking-[0.1em] text-foreground/55 font-medium"
                >
                  {group.label}
                </div>
                <div className="divide-y divide-border/40">
                  {group.permissions.map((perm) => {
                    const enabled = values.get(perm.key) ?? false;
                    return (
                      <PermissionRow
                        key={perm.key}
                        perm={perm}
                        enabled={enabled}
                        canEdit={canEdit}
                        isPending={updateMutation.isPending}
                        onToggle={() => handleToggle(perm, enabled)}
                      />
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Destructive confirmation modal */}
        <AlertDialog
          open={!!pendingConfirm}
          onOpenChange={(open) => !open && setPendingConfirm(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-warning/15 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                </div>
                <AlertDialogTitle>
                  Desligar &quot;{pendingConfirm?.perm.label}&quot;?
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription className="pt-3">
                {activeMemberCount === 0 ? (
                  "Nenhum membro está online no momento, mas a regra valerá para todos os membros futuros."
                ) : (
                  <>
                    Isso vai impactar {activeMemberCount}{" "}
                    {activeMemberCount === 1 ? "membro" : "membros"} que perderão
                    acesso imediatamente.
                  </>
                )}
                {pendingConfirm?.perm.hasRls && (
                  <span className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                    <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    Esta permissão também é aplicada no banco de dados (Fase 1).
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel autoFocus>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDestructive}
                className="bg-destructive hover:bg-destructive/90"
              >
                Desligar permissão
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset confirmation modal */}
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
                  <RotateCcw className="w-4 h-4 text-primary" />
                </div>
                <AlertDialogTitle>Resetar todas as permissões?</AlertDialogTitle>
              </div>
              <AlertDialogDescription className="pt-3">
                As 12 permissões voltam para o padrão (todas ligadas para
                membros). Você pode ajustar individualmente depois.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel autoFocus>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleReset}
                disabled={resetMutation.isPending}
              >
                {resetMutation.isPending ? "Resetando..." : "Resetar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

interface PermissionRowProps {
  perm: PermissionDef;
  enabled: boolean;
  canEdit: boolean;
  isPending: boolean;
  onToggle: () => void;
}

function PermissionRow({
  perm,
  enabled,
  canEdit,
  isPending,
  onToggle,
}: PermissionRowProps) {
  return (
    <div className="grid grid-cols-[1fr_88px_88px] min-h-[60px] px-5 py-3.5 items-center hover:bg-muted/20 transition-colors">
      {/* Label + description + info */}
      <div className="flex items-start gap-2 pr-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{perm.label}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Mais informações sobre ${perm.label}`}
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                {perm.tooltip}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
        </div>
      </div>

      {/* Admin column — always-on pill */}
      <div className="flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex w-9 h-5 rounded-full bg-primary/15 border border-primary/25 items-center justify-center"
              aria-label="Admins têm acesso total"
            >
              <Check className="w-3 h-3 text-primary" strokeWidth={3} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Admins têm acesso total
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Member column — Switch */}
      <div className="flex justify-center">
        <Switch
          checked={enabled}
          disabled={!canEdit || isPending}
          onCheckedChange={onToggle}
          aria-label={`Permissão para membros: ${perm.label}`}
          className={cn(
            perm.destructive && !enabled && "data-[state=unchecked]:bg-destructive/15",
          )}
        />
      </div>
    </div>
  );
}

export default PermissionsTab;
