/**
 * Configurações › Geral › "Nova interface" — lado CLÁSSICO (classic.patch),
 * no mesmo desenho das caixas "Modo escuro" e "Animações" desta tela. O da V5
 * está em src/modules/platform/ui-version/InterfaceDaOrgSetting.tsx.
 *
 * Vale para a org inteira: pede confirmação e só admin (ou master) muda.
 */
import { useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useIdentity } from "@/modules/identity";
import { getErrorMessage } from "@/shared/errors";
import { trocarUi } from "@torque/ui-version";
import { ESTA_UI, trocaDeUiLigada } from "./esta-ui";
import { useOrgInterface } from "./useOrgInterface";

export function InterfaceDaOrgSetting() {
  const { isAdmin } = useIdentity();
  const { uiV5Enabled, disponivel, definir, isSaving } = useOrgInterface();
  const [pedido, setPedido] = useState<boolean | null>(null);

  const ligada = uiV5Enabled === true;
  const travado = !isAdmin || !disponivel || uiV5Enabled === null || isSaving;

  const ajuda = !disponivel
    ? "Disponível depois da atualização do banco."
    : !isAdmin
      ? "Vale para toda a organização. Só administradores mudam."
      : "Vale para toda a organização. Desligada, todos usam a interface clássica.";

  async function confirmar() {
    if (pedido === null) return;
    const ligar = pedido;
    setPedido(null);
    try {
      await definir(ligar);
    } catch (error) {
      toast.error("Não foi possível trocar a interface", { description: getErrorMessage(error) });
      return;
    }
    const destino = ligar ? "v5" : "classic";
    if (trocaDeUiLigada() && destino !== ESTA_UI) {
      void trocarUi(destino);
      return;
    }
    toast.success(ligar ? "Interface nova ligada" : "Interface clássica ligada", {
      description: "O time passa a usar esta interface na próxima vez que abrir o Torque.",
    });
  }

  return (
    <>
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="space-y-0.5">
          <Label>Nova interface</Label>
          <p className="text-sm text-muted-foreground">{ajuda}</p>
        </div>
        <Switch checked={ligada} onCheckedChange={(v) => setPedido(v)} disabled={travado} aria-label="Nova interface" />
      </div>

      <AlertDialog open={pedido !== null} onOpenChange={(aberto) => !aberto && setPedido(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pedido ? "Ligar a interface nova para toda a organização?" : "Voltar a organização para a interface clássica?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pedido
                ? "Todo o time passa para a interface nova na próxima vez que abrir o Torque. Para você, a troca é agora. Dá para voltar a qualquer momento por aqui."
                : "Todo o time volta para a interface clássica na próxima vez que abrir o Torque. Para você, a troca é agora. Dá para religar a qualquer momento por aqui."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmar()}>
              {pedido ? "Ligar interface nova" : "Voltar para a clássica"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
