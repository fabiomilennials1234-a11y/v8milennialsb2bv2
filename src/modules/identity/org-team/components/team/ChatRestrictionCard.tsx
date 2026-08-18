/**
 * Política de isolamento por responsável — o interruptor da org (#1636).
 *
 * Ligar tira do inbox dos membros toda conversa sem responsável derivável.
 * Medido em produção: agregado, 86,8% das conversas individuais; nas duas orgs
 * que pediram a feature, 96,5% e 99,86%. Por isso a confirmação não é um
 * "tem certeza?" genérico — ela mostra o número DAQUELA org e oferece o
 * caminho de saída, que é atribuir responsável antes de ligar.
 *
 * `organizations` não tem policy de UPDATE para admin de org, então a escrita
 * passa por `set_org_chat_restriction`, que autoriza antes de agir. É esse par
 * que torna a política inalterável pelo membro.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity } from "@/modules/identity";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

interface Preview {
  conversas_total: number;
  conversas_restritas: number;
  leads_sem_responsavel: number;
}

const nf = new Intl.NumberFormat("pt-BR");

/** Bloco de número da prévia. Numeral grande, rótulo silencioso. */
function Stat({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          tone === "warning" ? "text-primary" : "text-foreground",
        )}
      >
        {nf.format(value)}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{label}</div>
    </div>
  );
}

export function ChatRestrictionCard() {
  const { isAdmin, isMaster, organizationId } = useIdentity();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: enabled = false, isLoading } = useQuery({
    queryKey: ["chat_restrict_to_owner", organizationId],
    queryFn: async () => {
      if (!organizationId) return false;
      const { data, error } = await supabase
        .from("organizations")
        .select("chat_restrict_to_owner")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return (data as any)?.chat_restrict_to_owner === true;
    },
    enabled: !!organizationId && (isAdmin || isMaster),
  });

  // A prévia só é buscada quando o diálogo abre: é uma contagem sobre a base de
  // conversas da org, e não faz sentido pagá-la a cada visita à página.
  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ["preview_chat_restriction", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_chat_restriction" as any, {
        p_org_id: organizationId,
      });
      if (error) throw error;
      return data as unknown as Preview;
    },
    enabled: confirmOpen && !!organizationId,
    staleTime: 30_000,
  });

  if (!isAdmin && !isMaster) return null;

  async function applyPolicy(next: boolean) {
    if (!organizationId) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.rpc("set_org_chat_restriction" as any, {
        p_org_id: organizationId,
        p_enabled: next,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["chat_restrict_to_owner"] });
      toast.success(
        next
          ? "Isolamento ligado. Cada vendedor passa a ver só as conversas dos leads dele."
          : "Isolamento desligado. O time volta a ver todas as conversas.",
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível alterar a política.");
    } finally {
      setIsSaving(false);
      setConfirmOpen(false);
    }
  }

  /** Desligar é reversível e imediato; ligar passa pela confirmação. */
  function handleToggle(next: boolean) {
    if (next) setConfirmOpen(true);
    else void applyPolicy(false);
  }

  const restritas = preview?.conversas_restritas ?? 0;
  const total = preview?.conversas_total ?? 0;
  const pct = total > 0 ? Math.round((restritas / total) * 100) : 0;

  return (
    <>
      <div
        className={cn(
          "rounded-xl border bg-card px-5 py-4 transition-colors",
          enabled ? "border-primary/30" : "border-border",
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <ShieldCheck className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium leading-none">Isolamento por responsável</h3>
              {enabled && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  Ativo
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Cada vendedor vê no chat apenas as conversas dos leads de que é responsável.
              Vale para todo membro não-admin, inclusive quem for contratado depois.
              Exceções individuais ficam em Permissões.
            </p>
          </div>

          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isLoading || isSaving}
            aria-label="Isolamento por responsável"
            className="mt-0.5"
          />
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Parte do inbox some para o time
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 pt-1">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Conversa cujo telefone não bate com um lead — ou bate com um lead sem
                  responsável — passa a ser visível só para administradores.
                </p>

                {loadingPreview ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Medindo esta organização...
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <Stat value={total} label="conversas no chat" />
                      <Stat value={restritas} label="ficam só para admin" tone="warning" />
                      <Stat
                        value={preview?.leads_sem_responsavel ?? 0}
                        label="leads sem responsável"
                      />
                    </div>

                    {/* A proporção é o que decide, não o número absoluto. */}
                    <div className="space-y-1.5">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {pct}% das conversas desta organização ficam sem responsável.
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-sm text-muted-foreground leading-relaxed">
                  Atribuir responsável aos leads devolve as conversas ao time. Dá para
                  fazer isso agora, em massa, e voltar aqui depois.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="sm:justify-between gap-2">
            <Button
              variant="ghost"
              className="gap-1.5 sm:mr-auto"
              onClick={() => {
                setConfirmOpen(false);
                navigate("/leads?atribuicao=sem-responsavel");
              }}
            >
              Atribuir responsáveis primeiro
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="flex gap-2">
              <AlertDialogCancel disabled={isSaving}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={isSaving}
                onClick={(e) => {
                  e.preventDefault();
                  void applyPolicy(true);
                }}
              >
                {isSaving ? "Ligando..." : "Ligar mesmo assim"}
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
