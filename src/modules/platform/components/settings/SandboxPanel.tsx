/**
 * SandboxPanel — admin panel for sandbox org management.
 * Consumes useCreateSandbox.
 */

import { useState } from "react";
import {
  FlaskConical,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          Sandbox
        </h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Crie uma cópia da organização para testes sem afetar dados reais
        </p>
      </div>

      {isSandbox && (
        <Card className="border-warning/40 bg-warning/10 shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <FlaskConical className="h-5 w-5 shrink-0 text-warning-strong" />
            <p className="text-sm">
              Você está em uma organização <strong>Sandbox</strong>. Alterações aqui não afetam a organização principal.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-4 rounded-xl border border-border p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning-strong" />
            <div>
              <p className="text-sm font-medium">Criar sandbox</p>
              <p className="text-xs text-muted-foreground">
                Clona configurações da organização (etapas, tags e funis). Nenhum dado de lead é copiado.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              O que é clonado:
            </h4>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-success" />
                Etapas e configurações dos funis
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-success" />
                Tags e campos customizados
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-success" />
                Agentes Copilot (configurações)
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-success" />
                Workflows (estrutura)
              </li>
            </ul>
          </div>

          <Button
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
        </CardContent>
      </Card>

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
    </div>
  );
}
