/**
 * Ajustes da régua: o número da cobrança (isolado do comercial), quando pode
 * enviar, o ritmo do chip e o "como pagar" que entra nas mensagens.
 *
 * O número muda na hora (com confirmação: mexe no chat e no copilot dele). O
 * resto é um formulário com "Salvar" — mudar janela e teto às cegas, campo a
 * campo, faria a régua andar com metade da configuração.
 */
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { formatarTelefone } from "../../lib/documento";
import { recusaDaCobranca } from "../../lib/erros";
import { type ConfiguracaoDaRegua, DIAS_DA_SEMANA, type DiaIso, type Janela } from "../../lib/regua";
import type { Etapa } from "../../lib/tipos";
import { type NumeroDaOrg, useDefinirNumero, useSalvarRegua } from "../../hooks/useRegua";
import { Campo, ConfirmarDialog } from "../dialogos";

const SEM = "__sem__";
const falha = (fallback: string) => (err: unknown) =>
  notifyError(err, { fallback, message: recusaDaCobranca(err as { code?: string; message?: string }), context: { feature: "cobranca" } });

function Bloco({ titulo, descricao, children, icone }: { titulo: string; descricao?: string; children: ReactNode; icone?: ReactNode }) {
  return (
    <section className="rounded-panel border border-border bg-card p-4 shadow-relevo">
      <h2 className="flex items-center gap-1.5 text-sm font-extrabold tracking-[-0.01em]">
        {icone}
        {titulo}
      </h2>
      {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function NumeroDaCobranca({ numeros, podeEditar, ehAdmin }: { numeros: NumeroDaOrg[]; podeEditar: boolean; ehAdmin: boolean }) {
  const definir = useDefinirNumero();
  const atual = numeros.find((n) => n.reservadoPara === "collections") ?? null;
  const [escolha, setEscolha] = useState<string | null>(null);
  const alvo = escolha === null ? null : numeros.find((n) => n.id === escolha) ?? null;
  const pode = podeEditar && ehAdmin;

  return (
    <Bloco
      titulo="Número da cobrança"
      icone={<Smartphone className="size-3.5 text-muted-foreground" aria-hidden />}
      descricao="Exclusivo do setor: a resposta do devedor fica no chat, não vira lead e não aciona copilot; automação de venda não sai por ele."
    >
      <Select
        value={atual?.id ?? SEM}
        onValueChange={(v) => {
          const id = v === SEM ? "" : v;
          if ((atual?.id ?? "") !== id) setEscolha(id);
        }}
        disabled={!pode || definir.isPending}
      >
        <SelectTrigger aria-label="Número da cobrança">
          <SelectValue placeholder="Escolha um número" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM}>Nenhum (régua não envia)</SelectItem>
          {numeros.map((n) => {
            const motivo = n.provider !== "uazapi" && n.provider !== "evolution"
              ? "canal oficial — próxima entrega"
              : n.temCopilot ? "atende copilot" : n.temDono ? "tem dono comercial" : null;
            return (
              <SelectItem key={n.id} value={n.id} disabled={!!motivo && n.id !== atual?.id}>
                {n.nome}
                {n.telefone ? ` · ${formatarTelefone(n.telefone)}` : ""}
                {motivo ? ` (${motivo})` : !n.conectado ? " (desconectado)" : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {atual && (
        <p className={cn("mt-2 flex items-center gap-1.5 text-xs", atual.conectado ? "text-success-strong" : "text-destructive")}>
          <span aria-hidden className={cn("size-1.5 rounded-full", atual.conectado ? "bg-success" : "bg-destructive")} />
          {atual.conectado ? "Conectado" : "Desconectado — a régua não envia até reconectar"}
        </p>
      )}
      {podeEditar && !ehAdmin && (
        <p className="mt-2 text-xs text-muted-foreground">Só um administrador da organização troca o número.</p>
      )}

      <ConfirmarDialog
        aberto={escolha !== null}
        onFechar={() => setEscolha(null)}
        titulo={alvo ? `Usar ${alvo.nome} na cobrança?` : "Tirar o número da cobrança?"}
        descricao={
          alvo
            ? "A partir de agora, mensagens neste número não viram lead nem acionam copilot, e automações de venda deixam de sair por ele. Conversas antigas continuam onde estão."
            : "A régua desliga e a fila é cancelada. O número volta a ser um número comum da organização."
        }
        rotuloConfirmar={alvo ? "Usar na cobrança" : "Tirar da cobrança"}
        perigoso={!alvo}
        confirmando={definir.isPending}
        onConfirmar={() =>
          definir.mutate(alvo?.id ?? null, {
            onSuccess: () => {
              setEscolha(null);
              toast.success(alvo ? "Número da cobrança definido." : "Número retirado da cobrança.");
            },
            onError: falha("Não foi possível trocar o número."),
          })
        }
      />
    </Bloco>
  );
}

interface Formulario {
  janela: Janela;
  teto: string;
  intervaloMin: string;
  intervaloMax: string;
  pausaResposta: string;
  intervaloDias: string;
  comoPagar: string;
  etapaQuebra: string;
}

function doConfig(c: ConfiguracaoDaRegua): Formulario {
  return {
    janela: c.janela,
    teto: String(c.tetoDiario),
    intervaloMin: String(Math.round(c.intervaloMinSegundos / 60) || 1),
    intervaloMax: String(Math.round(c.intervaloMaxSegundos / 60) || 1),
    pausaResposta: String(c.pausaAposRespostaDias),
    intervaloDias: String(c.intervaloMinimoDias),
    comoPagar: c.comoPagar ?? "",
    etapaQuebra: c.etapaAposQuebraId ?? SEM,
  };
}

const inteiro = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);

export function AjustesDaRegua({ config, etapas, podeEditar }: { config: ConfiguracaoDaRegua; etapas: Etapa[]; podeEditar: boolean }) {
  const salvar = useSalvarRegua();
  const [f, setF] = useState<Formulario>(() => doConfig(config));
  useEffect(() => setF(doConfig(config)), [config]);
  const original = useMemo(() => JSON.stringify(doConfig(config)), [config]);
  const sujo = JSON.stringify(f) !== original;

  const erros = useMemo(() => {
    const e: Partial<Record<keyof Formulario | "janela", string>> = {};
    const teto = inteiro(f.teto);
    if (!(teto >= 1 && teto <= 300)) e.teto = "De 1 a 300.";
    const mn = inteiro(f.intervaloMin);
    const mx = inteiro(f.intervaloMax);
    if (!(mn >= 1 && mn <= 30) || !(mx >= 1 && mx <= 30) || mn > mx) e.intervaloMin = "De 1 a 30 minutos, mínimo até o máximo.";
    const pr = inteiro(f.pausaResposta);
    if (!(pr >= 0 && pr <= 30)) e.pausaResposta = "De 0 a 30 dias.";
    const id = inteiro(f.intervaloDias);
    if (!(id >= 1 && id <= 30)) e.intervaloDias = "De 1 a 30 dias.";
    if (f.comoPagar.length > 600) e.comoPagar = "Até 600 caracteres.";
    for (const faixa of Object.values(f.janela)) {
      if (faixa && !(faixa.inicio < faixa.fim)) e.janela = "Em cada dia, o início vem antes do fim.";
    }
    if (!Object.keys(f.janela).length) e.janela = "Escolha ao menos um dia.";
    return e;
  }, [f]);
  const valido = Object.keys(erros).length === 0;

  const mudarDia = (dia: DiaIso, ligado: boolean) =>
    setF((x) => {
      const janela = { ...x.janela };
      if (ligado) janela[dia] = janela[dia] ?? { inicio: "09:00", fim: dia === "6" || dia === "7" ? "12:00" : "18:00" };
      else delete janela[dia];
      return { ...x, janela };
    });
  const mudarHora = (dia: DiaIso, campo: "inicio" | "fim", valor: string) =>
    setF((x) => ({ ...x, janela: { ...x.janela, [dia]: { ...(x.janela[dia] ?? { inicio: "09:00", fim: "18:00" }), [campo]: valor } } }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    salvar.mutate(
      {
        janela: f.janela,
        tetoDiario: inteiro(f.teto),
        intervaloMinSegundos: inteiro(f.intervaloMin) * 60,
        intervaloMaxSegundos: inteiro(f.intervaloMax) * 60,
        pausaAposRespostaDias: inteiro(f.pausaResposta),
        intervaloMinimoDias: inteiro(f.intervaloDias),
        comoPagar: f.comoPagar.trim() || null,
        etapaAposQuebraId: f.etapaQuebra === SEM ? null : f.etapaQuebra,
      },
      { onSuccess: () => toast.success("Ajustes da régua salvos."), onError: falha("Não foi possível salvar os ajustes.") },
    );
  };

  const etapasAbertas = etapas.filter((e) => e.papel === "aberta");

  return (
    <form onSubmit={enviar} className="space-y-4">
      <fieldset disabled={!podeEditar} className="space-y-4">
        <Bloco titulo="Quando pode enviar" descricao="No fuso da organização. Fora daqui a mensagem espera a próxima janela.">
          <div className="space-y-1.5">
            {DIAS_DA_SEMANA.map(({ dia, longo }) => {
              const faixa = f.janela[dia];
              return (
                <div key={dia} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
                  <label className="flex items-center gap-2 text-[13px] font-semibold">
                    <Switch checked={!!faixa} onCheckedChange={(v) => mudarDia(dia, v)} aria-label={`Enviar ${longo}`} />
                    {longo.slice(0, 3)}
                  </label>
                  {faixa ? (
                    <div className="flex items-center gap-1.5">
                      <Input type="time" value={faixa.inicio} onChange={(e) => mudarHora(dia, "inicio", e.target.value)} className="h-8 w-[104px] tabular-nums" aria-label={`${longo}, início`} />
                      <span className="text-xs text-muted-foreground">até</span>
                      <Input type="time" value={faixa.fim} onChange={(e) => mudarHora(dia, "fim", e.target.value)} className="h-8 w-[104px] tabular-nums" aria-label={`${longo}, fim`} />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Não envia</span>
                  )}
                </div>
              );
            })}
          </div>
          {erros.janela && <p className="mt-2 text-xs text-destructive">{erros.janela}</p>}
        </Bloco>

        <Bloco
          titulo="Ritmo e limites"
          icone={<ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />}
          descricao="Chip novo bane com volume. Comece baixo e suba aos poucos."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="rg-teto" rotulo="Máximo por dia" erro={erros.teto}>
              <Input id="rg-teto" inputMode="numeric" value={f.teto} onChange={(e) => setF({ ...f, teto: e.target.value.replace(/\D/g, "") })} />
            </Campo>
            <Campo id="rg-int-min" rotulo="Entre um envio e outro (min)" erro={erros.intervaloMin} dica="Sorteado entre o mínimo e o máximo.">
              <div className="flex items-center gap-1.5">
                <Input id="rg-int-min" inputMode="numeric" value={f.intervaloMin} onChange={(e) => setF({ ...f, intervaloMin: e.target.value.replace(/\D/g, "") })} aria-label="Intervalo mínimo em minutos" />
                <span className="text-xs text-muted-foreground">a</span>
                <Input inputMode="numeric" value={f.intervaloMax} onChange={(e) => setF({ ...f, intervaloMax: e.target.value.replace(/\D/g, "") })} aria-label="Intervalo máximo em minutos" />
              </div>
            </Campo>
            <Campo id="rg-pausa" rotulo="Pausa após resposta (dias)" erro={erros.pausaResposta} dica="Ele está falando com gente; o robô espera.">
              <Input id="rg-pausa" inputMode="numeric" value={f.pausaResposta} onChange={(e) => setF({ ...f, pausaResposta: e.target.value.replace(/\D/g, "") })} />
            </Campo>
            <Campo id="rg-dist" rotulo="Intervalo por devedor (dias)" erro={erros.intervaloDias} dica="Mínimo entre duas mensagens automáticas.">
              <Input id="rg-dist" inputMode="numeric" value={f.intervaloDias} onChange={(e) => setF({ ...f, intervaloDias: e.target.value.replace(/\D/g, "") })} />
            </Campo>
            <Campo id="rg-quebra" rotulo="Compromisso quebrado volta para" className="sm:col-span-2">
              <Select value={f.etapaQuebra} onValueChange={(v) => setF({ ...f, etapaQuebra: v })}>
                <SelectTrigger id="rg-quebra">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Não mover</SelectItem>
                  {etapasAbertas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
        </Bloco>

        <Bloco titulo="Como pagar" descricao="Entra no lugar de {como_pagar}. Chave PIX, link de boleto, telefone do financeiro.">
          <Textarea
            rows={3}
            value={f.comoPagar}
            onChange={(e) => setF({ ...f, comoPagar: e.target.value })}
            placeholder="PIX (CNPJ): 00.000.000/0001-00 · Dúvidas: (48) 99999-0000"
            aria-label="Como pagar"
          />
          {erros.comoPagar && <p className="mt-1 text-xs text-destructive">{erros.comoPagar}</p>}
        </Bloco>
      </fieldset>

      {/* Só aparece com mudança pendente: parado, um botão fixo cobriria campos. */}
      {podeEditar && sujo && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <Button type="submit" disabled={!valido || salvar.isPending} className="shadow-relevo-alto">
            {salvar.isPending && <Loader2 className="animate-spin" />}
            Salvar ajustes
          </Button>
        </div>
      )}
    </form>
  );
}
