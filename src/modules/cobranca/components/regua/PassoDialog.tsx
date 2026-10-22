/**
 * Criar/editar um passo da régua: quando (D+N de atraso ou D-N de promessa),
 * o texto (com variáveis clicáveis e prévia ao vivo) e a mudança de etapa.
 *
 * A prévia usa o MESMO renderizador da edge (lib/regua.ts ↔
 * _shared/cobranca-regua-mensagem.ts): o que aparece aqui é o que o devedor lê.
 */
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { recusaDaCobranca } from "../../lib/erros";
import {
  type Gatilho,
  type PassoDaRegua,
  VARIAVEIS_DA_REGUA,
  marcaDoPasso,
  renderizarMensagem,
  variaveisDeExemplo,
  variaveisDesconhecidas,
} from "../../lib/regua";
import type { Etapa } from "../../lib/tipos";
import { useSalvarPasso } from "../../hooks/useRegua";
import { Campo } from "../dialogos";

const LIMITE = 1000;
const SEM_ETAPA = "__sem__";

export function PassoDialog({
  aberto,
  onFechar,
  passo,
  gatilhoInicial = "atraso",
  etapas,
  comoPagar,
  empresa,
}: {
  aberto: boolean;
  onFechar: () => void;
  passo: PassoDaRegua | null;
  gatilhoInicial?: Gatilho;
  etapas: Etapa[];
  comoPagar: string | null;
  empresa?: string;
}) {
  const salvar = useSalvarPasso();
  const texto = useRef<HTMLTextAreaElement>(null);
  const [gatilho, setGatilho] = useState<Gatilho>(gatilhoInicial);
  const [dias, setDias] = useState("1");
  const [mensagem, setMensagem] = useState("");
  const [mover, setMover] = useState<string>(SEM_ETAPA);
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    setGatilho(passo?.gatilho ?? gatilhoInicial);
    setDias(String(passo?.dias ?? (gatilhoInicial === "lembrete_compromisso" ? 1 : 1)));
    setMensagem(passo?.mensagem ?? "");
    setMover(passo?.moverParaEtapaId ?? SEM_ETAPA);
    setAtivo(passo?.ativo ?? true);
  }, [aberto, passo, gatilhoInicial]);

  const lembrete = gatilho === "lembrete_compromisso";
  const nDias = Number(dias);
  const diasValidos = Number.isInteger(nDias) && (lembrete ? nDias >= 0 && nDias <= 7 : nDias >= 1 && nDias <= 365);
  const desconhecidas = useMemo(() => variaveisDesconhecidas(mensagem), [mensagem]);
  const previa = useMemo(
    () => renderizarMensagem(mensagem, variaveisDeExemplo(comoPagar, empresa)),
    [mensagem, comoPagar, empresa],
  );
  const etapasAbertas = etapas.filter((e) => e.papel === "aberta");
  const fazAlgo = !!mensagem.trim() || (!lembrete && mover !== SEM_ETAPA);
  const valido = diasValidos && fazAlgo && mensagem.length <= LIMITE && (!lembrete || !!mensagem.trim());

  const inserir = (chave: string) => {
    const el = texto.current;
    const marca = `{${chave}}`;
    if (!el) return setMensagem((m) => m + marca);
    const ini = el.selectionStart ?? mensagem.length;
    const fim = el.selectionEnd ?? mensagem.length;
    const novo = mensagem.slice(0, ini) + marca + mensagem.slice(fim);
    setMensagem(novo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    salvar.mutate(
      {
        id: passo?.id ?? null,
        gatilho,
        dias: nDias,
        mensagem: mensagem.trim() || null,
        moverParaEtapaId: lembrete || mover === SEM_ETAPA ? null : mover,
        ativo,
      },
      {
        onSuccess: onFechar,
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível salvar o passo.",
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
            <DialogTitle>{passo ? "Editar passo" : "Novo passo da régua"}</DialogTitle>
            <DialogDescription>
              Quando o passo vale, o que a mensagem diz e para onde o caso vai. Mensagem automática só
              informa e convida a responder — a negociação é da equipe.
            </DialogDescription>
          </DialogHeader>

          {!passo && (
            <Tabs value={gatilho} onValueChange={(v) => setGatilho(v as Gatilho)}>
              <TabsList variant="segmented" aria-label="Tipo de passo">
                <TabsTrigger value="atraso">Depois do vencimento</TabsTrigger>
                <TabsTrigger value="lembrete_compromisso">Antes de promessa ou parcela</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  id="ps-dias"
                  rotulo={lembrete ? "Dias antes" : "Dias de atraso"}
                  erro={dias && !diasValidos ? (lembrete ? "De 0 (no dia) a 7." : "De 1 a 365.") : undefined}
                  dica={lembrete ? "0 = no dia; 1 = véspera." : "Conta do vencimento mais antigo em aberto."}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      id="ps-dias"
                      inputMode="numeric"
                      value={dias}
                      onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 3))}
                      className="w-24 tabular-nums"
                    />
                    <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-bold tabular-nums text-muted-foreground">
                      {diasValidos ? marcaDoPasso({ gatilho, dias: nDias }) : "—"}
                    </span>
                  </div>
                </Campo>
                {!lembrete && (
                  <Campo id="ps-mover" rotulo="Mover o caso para" dica="Só para a frente, nunca volta.">
                    <Select value={mover} onValueChange={setMover}>
                      <SelectTrigger id="ps-mover">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_ETAPA}>Não mudar a etapa</SelectItem>
                        {etapasAbertas.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                )}
              </div>

              <Campo
                id="ps-msg"
                rotulo={lembrete ? "Mensagem" : "Mensagem (opcional se o passo só muda a etapa)"}
                erro={mensagem.length > LIMITE ? `Passa de ${LIMITE} caracteres.` : undefined}
              >
                <Textarea
                  id="ps-msg"
                  ref={texto}
                  rows={7}
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  placeholder="Olá, {primeiro_nome}! O pagamento de {valor}…"
                />
              </Campo>
              <div className="flex flex-wrap gap-1.5" aria-label="Variáveis">
                {VARIAVEIS_DA_REGUA.filter((v) => lembrete || !v.soLembrete).map((v) => (
                  <button
                    key={v.chave}
                    type="button"
                    onClick={() => inserir(v.chave)}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    title={`Insere {${v.chave}}`}
                  >
                    {v.rotulo}
                  </button>
                ))}
              </div>
              {desconhecidas.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warning-strong">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {desconhecidas.map((d) => `{${d}}`).join(", ")} não existe e vai sumir do texto.
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Como chega no WhatsApp</p>
              <div className="min-h-[180px] flex-1 rounded-[18px] border border-border bg-sunken p-3">
                {previa ? (
                  <div className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-card px-3 py-2 text-[13px] leading-relaxed shadow-relevo">
                    {previa}
                  </div>
                ) : (
                  <p className="grid h-full place-items-center text-center text-xs text-muted-foreground">
                    {lembrete || mover === SEM_ETAPA ? "Escreva a mensagem para ver a prévia." : "Sem mensagem: o passo só muda a etapa."}
                  </p>
                )}
              </div>
              <p className={cn("text-right text-[11px] tabular-nums text-muted-foreground", mensagem.length > LIMITE && "text-destructive")}>
                {mensagem.length}/{LIMITE} · exemplo com dados fictícios
              </p>
            </div>
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={ativo} onCheckedChange={setAtivo} aria-label="Passo ligado" />
              {ativo ? "Passo ligado" : "Passo desligado"}
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!valido || salvar.isPending}>
                {salvar.isPending && <Loader2 className="animate-spin" />}
                Salvar passo
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
