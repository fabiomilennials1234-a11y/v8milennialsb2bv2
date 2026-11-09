/**
 * Modal do Ganho/Perda no chat: para onde o card vai antes de o negócio fechar.
 *
 * A etapa de destino é opcional ("Manter na etapa atual"). O modal abre já com a
 * etapa que o NOME indica (Vendido no ganho, Perdido na perda), e nunca chuta
 * quando o funil não tem uma candidata clara.
 */
import { useEffect, useState } from "react";
import { Loader2, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { sugerirEtapaDeFechamento, type DesfechoDoChat } from "@/modules/communication/lib/fechar-negocio-chat";

export interface EtapaDoModal {
  key: string;
  stageId?: string;
  label: string;
}

const MANTER = "__manter__";

export function FecharNegocioDialog({
  open,
  desfecho,
  funil,
  etapas,
  etapaAtualKey,
  salvando,
  onCancelar,
  onConfirmar,
}: {
  open: boolean;
  desfecho: DesfechoDoChat;
  funil: string;
  etapas: readonly EtapaDoModal[];
  etapaAtualKey: string | null;
  salvando: boolean;
  onCancelar: () => void;
  onConfirmar: (destino: EtapaDoModal | null) => void;
}) {
  const [escolha, setEscolha] = useState<string>(MANTER);

  // Cada abertura recomeça da sugestão pelo nome, e não da escolha anterior.
  useEffect(() => {
    if (!open) return;
    const sugerida = sugerirEtapaDeFechamento(
      desfecho,
      etapas.filter((e) => e.key !== etapaAtualKey),
    );
    setEscolha(sugerida ?? MANTER);
  }, [open, desfecho, etapas, etapaAtualKey]);

  const ganho = desfecho === "won";
  const Icone = ganho ? Trophy : XCircle;
  const atual = etapas.find((e) => e.key === etapaAtualKey) ?? null;

  return (
    <Dialog open={open} onOpenChange={(aberto) => !aberto && !salvando && onCancelar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icone className={ganho ? "h-5 w-5 text-success" : "h-5 w-5 text-destructive"} aria-hidden />
            {ganho ? "Dar ganho no negócio" : "Dar perda no negócio"}
          </DialogTitle>
          <DialogDescription>
            Para qual etapa de <b>{funil}</b> o negócio vai antes de{" "}
            {ganho ? "ser marcado como ganho" : "ser marcado como perdido"}?
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={escolha}
          onValueChange={setEscolha}
          className="max-h-[50dvh] gap-1 overflow-y-auto pr-1"
          aria-label="Etapa de destino"
        >
          <Opcao valor={MANTER} id="etapa-manter" rotulo={`Manter na etapa atual${atual ? ` (${atual.label})` : ""}`} />
          {etapas
            .filter((e) => e.key !== etapaAtualKey)
            .map((e) => (
              <Opcao key={e.key} valor={e.key} id={`etapa-${e.key}`} rotulo={e.label} />
            ))}
        </RadioGroup>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={ganho ? "default" : "destructive"}
            disabled={salvando}
            onClick={() => onConfirmar(escolha === MANTER ? null : (etapas.find((e) => e.key === escolha) ?? null))}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {ganho ? "Confirmar ganho" : "Confirmar perda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Opcao({ valor, id, rotulo }: { valor: string; id: string; rotulo: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-muted">
      <RadioGroupItem value={valor} id={id} />
      <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-[13px] font-medium">
        {rotulo}
      </Label>
    </div>
  );
}
