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
import { useCreateSandbox } from "@/hooks/useSandbox";
import { useOrganization } from "@/hooks/useOrganization";

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
        <h3 className="text-lg font-medium flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          Sandbox
        </h3>
        <p className="text-sm text-muted-foreground">
          Crie uma copia da organizacao para testes sem afetar dados reais
        </p>
      </div>

      {isSandbox && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6 flex items-center gap-3">
            <FlaskConical className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm">
              Voce esta em uma organizacao <strong>Sandbox</strong>. Alteracoes aqui nao afetam a organizacao principal.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-lg border border-border">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Criar sandbox</p>
              <p className="text-xs text-muted-foreground">
                Clona configuracoes da org (stages, tags, pipelines). Nenhum dado de lead e copiado.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              O que e clonado:
            </h4>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                Pipeline stages e configuracoes
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                Tags e campos customizados
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                Agentes Copilot (configuracoes)
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                Workflows (estrutura)
              </li>
            </ul>
          </div>

          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={createSandbox.isPending}
            className="gap-2"
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
              Uma nova organizacao sera criada com as configuracoes da org atual. Troque de organizacao para acessar.
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
