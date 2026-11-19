/**
 * Criar/editar uma coluna do Fluxo de Cobrança como automação: com quantos
 * dias de atraso o caso entra sozinho e a mensagem que sai quando ele entra
 * (pela régua, ou à mão com "Mover e enviar").
 *
 * Quatro tipos de coluna aberta, e o diálogo só mostra o que cada uma aceita:
 *  - de dias ("7 dias de atraso"): dias obrigatórios, entrada liga/desliga e a
 *    trilha (devedor com um título vencido ou com dois ou mais);
 *  - manual (criada pela organização, sem dias): nome obrigatório, só envia
 *    quando alguém move o card para cá e confirma;
 *  - que pausa a régua (Em negociação, Jurídico): dias opcionais (Jurídico
 *    entra com 60), mensagem opcional — só sai à mão, a menos que tenha dias;
 *  - de entrada (Vencido): a mensagem, para o movimento à mão, e a chave
 *    "enviar no dia do vencimento" (0 dias): o título que já vence hoje entra
 *    e recebe a mensagem sozinho.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { notifyError } from "@/shared/errors";

import { recusaDaCobranca } from "../../lib/erros";
import { type TipoDeColuna, marcaDoPasso, rotuloDoPasso, tipoDaColuna } from "../../lib/regua";
import type { Etapa, TrilhaDaColuna } from "../../lib/tipos";
import { useSalvarColuna } from "../../hooks/useRegua";
import { Campo } from "../dialogos";
import { EditorDeMensagem, LIMITE_DA_MENSAGEM } from "./EditorDeMensagem";

export function ColunaDialog({
  aberto,
  onFechar,
  coluna,
  comoPagar,
  empresa,
  manual = false,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** null = nova coluna (de dias de atraso, ou manual quando `manual`). */
  coluna: Etapa | null;
  comoPagar: string | null;
  empresa?: string;
  /** Só vale com `coluna` null: coluna nova sem dias, que só envia à mão. */
  manual?: boolean;
}) {
  const salvar = useSalvarColuna();
  const tipo: TipoDeColuna = coluna ? tipoDaColuna(coluna) : manual ? "pausa" : "dias";
  const colunaManualNova = !coluna && manual;
  const [nome, setNome] = useState("");
  const [dias, setDias] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ativa, setAtiva] = useState(true);
  const [trilha, setTrilha] = useState<TrilhaDaColuna>("unico");
  // Só da coluna de entrada: ligar = entra com 0 dias de atraso (no vencimento).
  const [noVencimento, setNoVencimento] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome(coluna?.nome ?? "");
    setDias(coluna?.entradaDias != null ? String(coluna.entradaDias) : "");
    setMensagem(coluna?.mensagem ?? "");
    setAtiva(coluna?.automacaoAtiva ?? true);
    setTrilha(coluna?.trilha ?? "unico");
    setNoVencimento(false);
  }, [aberto, coluna]);

  // Nome padrão acompanha os dias ("7 dias de atraso" → "8 dias de atraso"); nome próprio fica.
  const mudarDias = (novo: string) => {
    const rotulo = (d: string) => (d ? rotuloDoPasso({ gatilho: "atraso", dias: Number(d) }) : "");
    if (nome.trim() === "" || nome.trim() === rotulo(dias)) setNome(novo ? rotulo(novo) : "");
    setDias(novo);
  };

  const nDias = Number(dias);
  const diasObrigatorios = tipo === "dias";
  const diasValidos = dias === "" ? !diasObrigatorios : Number.isInteger(nDias) && nDias >= 0 && nDias <= 365;
  const temDias = dias !== "" && diasValidos;
  const nomeValido = nome.trim().length <= 60 && (!(coluna || colunaManualNova) || nome.trim().length > 0);
  const valido = diasValidos && nomeValido && mensagem.length <= LIMITE_DA_MENSAGEM;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    salvar.mutate(
      {
        id: coluna?.id ?? null,
        // Coluna nova sem nome ganha "N dias de atraso" no banco.
        nome: nome.trim() || undefined,
        entradaDias: colunaManualNova ? undefined : tipo === "entrada" ? (noVencimento ? 0 : undefined) : temDias ? nDias : null,
        mensagem: mensagem.trim() || null,
        automacaoAtiva: ativa,
        trilha: tipo === "dias" && temDias ? trilha : undefined,
        manual: colunaManualNova || undefined,
      },
      {
        onSuccess: onFechar,
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível salvar a coluna.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  const descricao =
    tipo === "dias"
      ? "O caso entra sozinho nesta coluna quando completa os dias de atraso — só para a frente, uma vez por dívida. A mensagem sai quando ele entra."
      : colunaManualNova
        ? "Só envia quando alguém move o card para cá e confirma. A régua não move nem manda nada sozinha enquanto o caso estiver aqui."
        : tipo === "pausa"
        ? "Enquanto o caso está aqui, a régua não o move nem manda mensagem sozinha. A mensagem desta coluna sai quando alguém move o card para cá e escolhe enviar."
        : "Toda dívida nova começa aqui. Com a chave abaixo ligada, o título que já vence hoje recebe a mensagem sozinho ao ser cadastrado; sem ela, a mensagem sai só quando alguém move o card para cá e escolhe enviar.";

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[760px]">
        <form onSubmit={enviar} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{coluna ? `Editar “${coluna.nome}”` : colunaManualNova ? "Nova coluna manual" : "Nova coluna de atraso"}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>

          <EditorDeMensagem
            id="col-msg"
            rotulo="Mensagem ao entrar (opcional)"
            valor={mensagem}
            onChange={setMensagem}
            comoPagar={comoPagar}
            empresa={empresa}
            semTexto="Sem mensagem: a coluna só recebe o card."
            diasDeAtraso={temDias ? nDias : undefined}
            acima={
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Campo
                  id="col-nome"
                  rotulo="Nome da coluna"
                  erro={nome.trim().length > 60 ? "Até 60 caracteres." : undefined}
                  dica={tipo === "dias" ? "Acompanha os dias, a menos que você escreva outro." : undefined}
                >
                  <Input
                    id="col-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder={colunaManualNova ? "Ex.: Fluxo cartorial" : "Ex.: 10 dias de atraso"}
                  />
                </Campo>
                {tipo !== "entrada" && !colunaManualNova && (
                  <Campo
                    id="col-dias"
                    rotulo={diasObrigatorios ? "Entra com" : "Entra com (opcional)"}
                    erro={dias && !diasValidos ? "De 0 a 365." : !dias && diasObrigatorios ? "Obrigatório." : undefined}
                    dica="dias de atraso (0 = no dia do vencimento)"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        id="col-dias"
                        inputMode="numeric"
                        value={dias}
                        onChange={(e) => mudarDias(e.target.value.replace(/\D/g, "").slice(0, 3))}
                        className="w-20 tabular-nums"
                      />
                      <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-bold tabular-nums text-muted-foreground">
                        {temDias ? marcaDoPasso({ gatilho: "atraso", dias: nDias }) : "—"}
                      </span>
                    </div>
                  </Campo>
                )}
                {tipo === "dias" && (
                  <Campo
                    id="col-trilha"
                    rotulo="Quando o inadimplente tem"
                    dica="Quem tem 2 ou mais títulos vencidos segue a régua dos múltiplos títulos."
                    className="sm:col-span-2"
                  >
                    <Select value={trilha} onValueChange={(v) => setTrilha(v as TrilhaDaColuna)}>
                      <SelectTrigger id="col-trilha">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unico">Um título vencido</SelectItem>
                        <SelectItem value="multiplos">2 ou mais títulos vencidos</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                )}
              </div>
            }
          />

          <DialogFooter className="items-center sm:justify-between">
            {temDias ? (
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={ativa} onCheckedChange={setAtiva} aria-label="Entrada automática" />
                {ativa ? "Entrada automática ligada" : "Entrada automática desligada"}
              </label>
            ) : tipo === "entrada" ? (
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={noVencimento}
                  onCheckedChange={setNoVencimento}
                  aria-label="Enviar a mensagem no dia do vencimento"
                />
                Enviar a mensagem no dia do vencimento
              </label>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!valido || salvar.isPending}>
                {salvar.isPending && <Loader2 className="animate-spin" />}
                {coluna ? "Salvar coluna" : "Criar coluna"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
