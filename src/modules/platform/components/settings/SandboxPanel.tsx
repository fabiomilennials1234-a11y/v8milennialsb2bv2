/**
 * SandboxPanel — admin panel for sandbox org management.
 * Consumes useCreateSandbox.
 */

import { useState } from "react";
import {
  FlaskConical,
  Plus,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartaoDeAjustes, LinhaDeAjuste } from "./settings-ui";
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
import { useCreateSandbox } from "@/modules/platform/hooks/useSandbox";
import { useOrganization } from "@/modules/identity";
// ── Component ─────────────────────────────────────────────────

export function SandboxPanel() {
  const createSandbox = useCreateSandbox();
  const { organizationId } = useOrganization();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isSandbox = false;

  const handleCreate = async () => {
    setConfirmOpen(false);
    await createSandbox.mutateAsync();
  };

  return (
    <CartaoDeAjustes
      titulo="Sandbox"
      descricao="Crie uma cópia da organização para testes sem afetar dados reais"
    >
      {isSandbox && (
        <p className="mb-3 flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-3.5 text-sm">
          <FlaskConical className="h-5 w-5 shrink-0 text-warning-strong" />
          <span>
            Você está em uma organização <strong>Sandbox</strong>. Alterações aqui não afetam a organização principal.
          </span>
        </p>
      )}

      <LinhaDeAjuste
        rotulo="Criar sandbox"
        ajuda="Clona configurações da organização (etapas, tags e funis). Nenhum dado de lead é copiado."
      >
        <Button
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          disabled={createSandbox.isPending}
        >
          {createSandbox.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Criar sandbox
        </Button>
      </LinhaDeAjuste>

      <div className="mt-1 rounded-2xl bg-muted/50 p-4">
        <h4 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          O que é clonado:
        </h4>
        <ul className="mt-2 grid gap-1.5 text-[13px] sm:grid-cols-2">
          <li className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success-strong" />
            Etapas e configurações dos funis
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success-strong" />
            Tags e campos customizados
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success-strong" />
            Agentes Copilot (configurações)
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success-strong" />
            Workflows (estrutura)
          </li>
        </ul>
      </div>

      {/* Confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar sandbox?</AlertDialogTitle>
            <AlertDialogDescription>
              Uma nova organização será criada com as configurações da org atual. Troque de organização para acessar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreate}>
              Criar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CartaoDeAjustes>
  );
}
