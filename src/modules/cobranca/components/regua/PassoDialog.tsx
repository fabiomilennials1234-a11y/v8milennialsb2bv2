/**
 * Criar/editar um lembrete antes de promessa ou parcela (D-N). A régua de
 * atraso mora nas colunas do fluxo (ColunaDialog); passo é só lembrete.
 */
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { notifyError } from "@/shared/errors";

import { recusaDaCobranca } from "../../lib/erros";
import { type PassoDaRegua, marcaDoPasso } from "../../lib/regua";
import { useSalvarPasso } from "../../hooks/useRegua";
import { Campo } from "../dialogos";
import { EditorDeMensagem, LIMITE_DA_MENSAGEM } from "./EditorDeMensagem";

export function PassoDialog({
  aberto,
  onFechar,
  passo,
  comoPagar,
  empresa,
}: {
  aberto: boolean;
  onFechar: () => void;
  passo: PassoDaRegua | null;
  comoPagar: string | null;
  empresa?: string;
}) {
  const salvar = useSalvarPasso();
  const [dias, setDias] = useState("1");
  const [mensagem, setMensagem] = useState("");
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    setDias(String(passo?.dias ?? 1));
    setMensagem(passo?.mensagem ?? "");
    setAtivo(passo?.ativo ?? true);
  }, [aberto, passo]);

  const nDias = Number(dias);
  const diasValidos = dias !== "" && Number.isInteger(nDias) && nDias >= 0 && nDias <= 7;
  const valido = diasValidos && !!mensagem.trim() && mensagem.length <= LIMITE_DA_MENSAGEM;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    salvar.mutate(
      { id: passo?.id ?? null, dias: nDias, mensagem: mensagem.trim(), ativo },
      {
        onSuccess: onFechar,
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível salvar o lembrete.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[760px]">
        <form onSubmit={enviar} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{passo ? "Editar lembrete" : "Novo lembrete"}</DialogTitle>
            <DialogDescription>
              Sai antes do vencimento de uma promessa ou parcela combinada. Enquanto há compromisso, as colunas de
              atraso não andam: só o lembrete sai.
            </DialogDescription>
          </DialogHeader>

          <EditorDeMensagem
            id="ps-msg"
            rotulo="Mensagem"
            valor={mensagem}
            onChange={setMensagem}
            lembrete
            comoPagar={comoPagar}
            empresa={empresa}
            semTexto="Escreva a mensagem para ver a prévia."
            acima={
              <Campo
                id="ps-dias"
                rotulo="Dias antes"
                erro={dias && !diasValidos ? "De 0 (no dia) a 7." : undefined}
                dica="0 = no dia; 1 = véspera."
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="ps-dias"
                    inputMode="numeric"
                    value={dias}
                    onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 1))}
                    className="w-24 tabular-nums"
                  />
                  <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-bold tabular-nums text-muted-foreground">
                    {diasValidos ? marcaDoPasso({ gatilho: "lembrete_compromisso", dias: nDias }) : "—"}
                  </span>
                </div>
              </Campo>
            }
          />

          <DialogFooter className="items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={ativo} onCheckedChange={setAtivo} aria-label="Lembrete ligado" />
              {ativo ? "Lembrete ligado" : "Lembrete desligado"}
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!valido || salvar.isPending}>
                {salvar.isPending && <Loader2 className="animate-spin" />}
                Salvar lembrete
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
