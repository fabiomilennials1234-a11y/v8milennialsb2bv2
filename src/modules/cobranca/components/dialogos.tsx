/**
 * Os diálogos de registro da cobrança: inadimplente (novo/editar), título,
 * promessa/acordo, pagamento, contato e confirmação com motivo.
 *
 * Todos seguem o mesmo contrato: validam na tela o que dá para validar (CPF,
 * valor, data), chamam UMA RPC e mostram a recusa que o banco escreveu.
 */
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTeamMembers } from "@/modules/identity";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { isoDia } from "../lib/atraso";
import { gerarParcelas } from "../lib/parcelas";
import { documentoValido, formatarDocumento, formatarTelefone, telefoneValido } from "../lib/documento";
import { recusaDaCobranca } from "../lib/erros";
import { ROTULO_CANAL, ROTULO_RESULTADO, reais } from "../lib/formato";
import type { CanalDeContato, Etapa, InadimplenteResumo, ResultadoDoContato, TipoDeCompromisso, TituloSaldo } from "../lib/tipos";
import {
  type DadosDoInadimplente,
  type TituloNovo,
  useIncluirTitulo,
  useRegistrarCompromisso,
  useRegistrarContato,
  useRegistrarPagamento,
  useSalvarInadimplente,
} from "../hooks/useCobrancaMutacoes";
import { CampoDeReais } from "./atomos";

export function Campo({
  id,
  rotulo,
  erro,
  dica,
  children,
  className,
}: {
  id: string;
  rotulo: string;
  erro?: string;
  dica?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {erro ? (
        <p id={`${id}-erro`} className="text-xs text-destructive">
          {erro}
        </p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}

function BotaoSalvar({ salvando, children, disabled }: { salvando: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" disabled={salvando || disabled}>
      {salvando && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Inadimplente
// ───────────────────────────────────────────────────────────────────────────

interface LinhaDeTitulo {
  numero: string;
  valor: number | null;
  vencimento: string;
}

export function InadimplenteDialog({
  aberto,
  onFechar,
  editando,
  observacoesAtuais,
  onSalvo,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** Ausente = novo. */
  editando?: InadimplenteResumo | null;
  observacoesAtuais?: string | null;
  onSalvo?: (id: string) => void;
}) {
  const salvar = useSalvarInadimplente();
  const { data: membros = [] } = useTeamMembers();
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [contato, setContato] = useState("");
  const [cidade, setCidade] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [responsavel, setResponsavel] = useState<string>("");
  const [titulos, setTitulos] = useState<LinhaDeTitulo[]>([{ numero: "", valor: null, vencimento: "" }]);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome(editando?.nome ?? "");
    setDocumento(editando?.documento ? formatarDocumento(editando.documento) : "");
    setTelefone(editando?.telefone ? formatarTelefone(editando.telefone) : "");
    setEmail(editando?.email ?? "");
    setContato(editando?.contatoNome ?? "");
    setCidade(editando?.cidade ?? "");
    setObservacoes(observacoesAtuais ?? "");
    setResponsavel("");
    setTitulos([{ numero: "", valor: null, vencimento: "" }]);
    setTentou(false);
  }, [aberto, editando, observacoesAtuais]);

  const erros = useMemo(() => {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = "Informe o nome ou a razão social.";
    if (!documentoValido(documento)) e.documento = "CPF ou CNPJ com dígito verificador errado.";
    if (!telefoneValido(telefone)) e.telefone = "Telefone com DDD, só números.";
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = "E-mail inválido.";
    if (!editando) {
      titulos.forEach((t, i) => {
        const vazio = !t.numero.trim() && t.valor == null && !t.vencimento;
        if (vazio) return;
        if (t.valor == null || t.valor <= 0) e[`titulo-${i}`] = "Valor maior que zero.";
        else if (!t.vencimento) e[`titulo-${i}`] = "Informe o vencimento.";
      });
    }
    return e;
  }, [nome, documento, telefone, email, titulos, editando]);

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    setTentou(true);
    if (Object.keys(erros).length > 0) return;
    const dados: DadosDoInadimplente = {
      nome,
      documento,
      telefone,
      email,
      contatoNome: contato,
      cidade,
      observacoes,
      responsavelId: responsavel || null,
      titulos: editando
        ? undefined
        : titulos
            .filter((t) => t.valor != null && t.valor > 0 && t.vencimento)
            .map<TituloNovo>((t) => ({ numero: t.numero, valor: t.valor as number, vencimento: t.vencimento })),
    };
    salvar.mutate(
      { id: editando?.id ?? null, dados },
      {
        onSuccess: (id) => {
          toast.success(editando ? "Inadimplente atualizado." : "Inadimplente cadastrado.");
          onSalvo?.(id);
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível salvar o inadimplente.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  const mostra = (k: string) => (tentou ? erros[k] : undefined);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar inadimplente" : "Novo inadimplente"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "Dados de contato do devedor. Títulos e valores ficam na ficha."
              : "Cadastro manual. Com pelo menos um título, o caso já entra no Fluxo de Cobrança."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
            <Campo id="cob-nome" rotulo="Nome ou razão social" erro={mostra("nome")}>
              <Input id="cob-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus aria-invalid={!!mostra("nome")} />
            </Campo>
            <Campo id="cob-doc" rotulo="CPF ou CNPJ" erro={mostra("documento")} dica="Evita cadastrar o mesmo devedor duas vezes.">
              <Input
                id="cob-doc"
                inputMode="numeric"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                onBlur={() => setDocumento((d) => formatarDocumento(d))}
                aria-invalid={!!mostra("documento")}
              />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="cob-tel" rotulo="Telefone (WhatsApp)" erro={mostra("telefone")}>
              <Input id="cob-tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} aria-invalid={!!mostra("telefone")} />
            </Campo>
            <Campo id="cob-email" rotulo="E-mail" erro={mostra("email")}>
              <Input id="cob-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!mostra("email")} />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="cob-contato" rotulo="Pessoa de contato">
              <Input id="cob-contato" value={contato} onChange={(e) => setContato(e.target.value)} />
            </Campo>
            <Campo id="cob-cidade" rotulo="Cidade">
              <Input id="cob-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </Campo>
          </div>

          {!editando && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Títulos em aberto</legend>
                {titulos.map((t, i) => (
                  <div key={i} className="space-y-1">
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                      <Input
                        aria-label={`Número do título ${i + 1}`}
                        placeholder="Nº (opcional)"
                        value={t.numero}
                        onChange={(e) => setTitulos((ts) => ts.map((x, j) => (j === i ? { ...x, numero: e.target.value } : x)))}
                      />
                      <CampoDeReais
                        aria-label={`Valor do título ${i + 1}`}
                        valor={t.valor}
                        onValor={(v) => setTitulos((ts) => ts.map((x, j) => (j === i ? { ...x, valor: v } : x)))}
                      />
                      <Input
                        type="date"
                        aria-label={`Vencimento do título ${i + 1}`}
                        value={t.vencimento}
                        onChange={(e) => setTitulos((ts) => ts.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover título ${i + 1}`}
                        disabled={titulos.length === 1}
                        onClick={() => setTitulos((ts) => ts.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {mostra(`titulo-${i}`) && <p className="text-xs text-destructive">{mostra(`titulo-${i}`)}</p>}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTitulos((ts) => [...ts, { numero: "", valor: null, vencimento: "" }])}
                >
                  <Plus />
                  Outro título
                </Button>
              </fieldset>
              <Campo id="cob-resp" rotulo="Responsável pelo caso" dica="Opcional. Dá para atribuir depois, em lote.">
                <Select value={responsavel || "__nenhum"} onValueChange={(v) => setResponsavel(v === "__nenhum" ? "" : v)}>
                  <SelectTrigger id="cob-resp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nenhum">Sem responsável</SelectItem>
                    {membros
                      .filter((m) => m.is_active !== false && m.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Campo>
            </>
          )}

          <Campo id="cob-obs" rotulo="Observações">
            <Textarea id="cob-obs" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={4000} />
          </Campo>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <BotaoSalvar salvando={salvar.isPending}>{editando ? "Salvar" : "Cadastrar"}</BotaoSalvar>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Título avulso
// ───────────────────────────────────────────────────────────────────────────

export function TituloDialog({
  aberto,
  onFechar,
  inadimplenteId,
}: {
  aberto: boolean;
  onFechar: () => void;
  inadimplenteId: string;
}) {
  const incluir = useIncluirTitulo();
  const [numero, setNumero] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState<number | null>(null);
  const [vencimento, setVencimento] = useState("");
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    if (aberto) {
      setNumero("");
      setDescricao("");
      setValor(null);
      setVencimento("");
      setTentou(false);
    }
  }, [aberto]);

  const erroValor = valor == null || valor <= 0 ? "Informe um valor maior que zero." : undefined;
  const erroVenc = !vencimento ? "Informe o vencimento." : undefined;

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    setTentou(true);
    if (erroValor || erroVenc) return;
    incluir.mutate(
      { inadimplenteId, titulo: { numero, descricao, valor: valor as number, vencimento } },
      {
        onSuccess: () => {
          toast.success("Título incluído.");
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível incluir o título.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Incluir título</DialogTitle>
          <DialogDescription>Valor informado à mão. Títulos do ERP entram pela sincronização.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="tit-valor" rotulo="Valor em aberto" erro={tentou ? erroValor : undefined}>
              <CampoDeReais id="tit-valor" valor={valor} onValor={setValor} />
            </Campo>
            <Campo id="tit-venc" rotulo="Vencimento" erro={tentou ? erroVenc : undefined}>
              <Input id="tit-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
            <Campo id="tit-num" rotulo="Número">
              <Input id="tit-num" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="NF 4821" />
            </Campo>
            <Campo id="tit-desc" rotulo="Descrição">
              <Input id="tit-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </Campo>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <BotaoSalvar salvando={incluir.isPending}>Incluir</BotaoSalvar>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Promessa / acordo
// ───────────────────────────────────────────────────────────────────────────

export function CompromissoDialog({
  aberto,
  onFechar,
  tipoInicial,
  caso,
  etapas,
}: {
  aberto: boolean;
  onFechar: () => void;
  tipoInicial: TipoDeCompromisso;
  caso: InadimplenteResumo;
  etapas: Etapa[];
}) {
  const registrar = useRegistrarCompromisso();
  const [tipo, setTipo] = useState<TipoDeCompromisso>(tipoInicial);
  const [total, setTotal] = useState<number | null>(null);
  const [n, setN] = useState(3);
  const [primeira, setPrimeira] = useState("");
  const [parcelas, setParcelas] = useState<{ vencimento: string; valor: number }[]>([]);
  const [obs, setObs] = useState("");
  const [mover, setMover] = useState(true);
  const etapaDeCompromisso = etapas.find((e) => e.papel === "aberta" && /promessa|acordo/i.test(e.nome)) ?? null;

  useEffect(() => {
    if (!aberto) return;
    setTipo(tipoInicial);
    setTotal(caso.saldoAberto || null);
    setN(3);
    setPrimeira("");
    setObs("");
    setMover(true);
  }, [aberto, tipoInicial, caso.saldoAberto]);

  useEffect(() => {
    setParcelas(gerarParcelas(total ?? 0, tipo === "promessa" ? 1 : n, primeira));
  }, [total, n, primeira, tipo]);

  const soma = parcelas.reduce((s, p) => s + p.valor, 0);
  const valido = parcelas.length > 0 && parcelas.every((p) => p.valor > 0 && p.vencimento);

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (!valido || !caso.casoId) return;
    registrar.mutate(
      {
        casoId: caso.casoId,
        tipo,
        parcelas,
        observacao: obs,
        moverPara: mover && etapaDeCompromisso && etapaDeCompromisso.id !== caso.etapaId ? etapaDeCompromisso.id : null,
      },
      {
        onSuccess: () => {
          toast.success(tipo === "promessa" ? "Promessa registrada." : "Acordo registrado.");
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível registrar o compromisso.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tipo === "promessa" ? "Registrar promessa" : "Registrar acordo"}</DialogTitle>
          <DialogDescription>
            O que {caso.nome} combinou com a equipe. O Torque registra e lembra das datas; a negociação é de vocês.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="inline-flex rounded-full bg-muted p-1">
            {(["promessa", "acordo"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                aria-pressed={tipo === t}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors",
                  tipo === t && "bg-card text-foreground shadow-relevo",
                )}
              >
                {t === "promessa" ? "Promessa · uma data" : "Acordo · parcelas"}
              </button>
            ))}
          </div>
          <div className={cn("grid gap-4", tipo === "acordo" ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            <Campo id="cmp-total" rotulo={tipo === "promessa" ? "Valor prometido" : "Total do acordo"}>
              <CampoDeReais id="cmp-total" valor={total} onValor={setTotal} />
            </Campo>
            {tipo === "acordo" && (
              <Campo id="cmp-n" rotulo="Parcelas">
                <Input
                  id="cmp-n"
                  type="number"
                  min={2}
                  max={120}
                  value={n}
                  onChange={(e) => setN(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                />
              </Campo>
            )}
            <Campo id="cmp-data" rotulo={tipo === "promessa" ? "Data" : "1ª parcela"}>
              <Input id="cmp-data" type="date" value={primeira} onChange={(e) => setPrimeira(e.target.value)} />
            </Campo>
          </div>

          {tipo === "acordo" && parcelas.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-2xl border border-border bg-sunken p-2">
              {parcelas.map((p, i) => (
                <div key={i} className="grid grid-cols-[40px_1fr_1fr] items-center gap-2 px-1 py-1 text-sm">
                  <span className="text-xs font-bold text-muted-foreground">{i + 1}ª</span>
                  <Input
                    type="date"
                    aria-label={`Vencimento da parcela ${i + 1}`}
                    value={p.vencimento}
                    onChange={(e) => setParcelas((ps) => ps.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))}
                    className="h-8"
                  />
                  <CampoDeReais
                    aria-label={`Valor da parcela ${i + 1}`}
                    valor={p.valor}
                    onValor={(v) => setParcelas((ps) => ps.map((x, j) => (j === i ? { ...x, valor: v ?? 0 } : x)))}
                    className="[&_input]:h-8"
                  />
                </div>
              ))}
              <p className="px-1 pt-1 text-right text-xs text-muted-foreground">
                Soma das parcelas: <span className="font-bold tabular-nums text-foreground">{reais(soma)}</span>
                {caso.saldoAberto > 0 && Math.abs(soma - caso.saldoAberto) > 0.009 && (
                  <> · saldo em aberto {reais(caso.saldoAberto)}</>
                )}
              </p>
            </div>
          )}

          <Campo id="cmp-obs" rotulo="Como foi combinado">
            <Textarea id="cmp-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={2000} placeholder="Ex.: falou com a Joana por telefone, paga por PIX." />
          </Campo>

          {etapaDeCompromisso && etapaDeCompromisso.id !== caso.etapaId && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={mover} onCheckedChange={(v) => setMover(v === true)} />
              Mover o caso para “{etapaDeCompromisso.nome}”
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <BotaoSalvar salvando={registrar.isPending} disabled={!valido}>
              Registrar
            </BotaoSalvar>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Pagamento
// ───────────────────────────────────────────────────────────────────────────

export function PagamentoDialog({
  aberto,
  onFechar,
  caso,
  titulos,
}: {
  aberto: boolean;
  onFechar: () => void;
  caso: InadimplenteResumo;
  /** Para escolher um título específico; sem a lista, abate do mais antigo. */
  titulos?: TituloSaldo[];
}) {
  const registrar = useRegistrarPagamento();
  const baixaveis = (titulos ?? []).filter((t) => t.saldo > 0 && t.origem !== "erp");
  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState(isoDia(new Date()));
  const [titulo, setTitulo] = useState("__fifo");

  useEffect(() => {
    if (!aberto) return;
    setValor(caso.saldoAberto || null);
    setData(isoDia(new Date()));
    setTitulo("__fifo");
  }, [aberto, caso.saldoAberto]);

  const limite = titulo === "__fifo" ? caso.saldoAberto : (baixaveis.find((t) => t.id === titulo)?.saldo ?? 0);
  const erro =
    valor == null || valor <= 0
      ? "Informe o valor recebido."
      : valor - limite > 0.009
        ? `Passa do saldo em aberto (${reais(limite)}).`
        : undefined;

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (erro || !caso.casoId) return;
    registrar.mutate(
      { casoId: caso.casoId, valor: valor as number, pagoEm: data, tituloId: titulo === "__fifo" ? undefined : titulo },
      {
        onSuccess: (r) => {
          toast.success(r.quitado ? "Saldo quitado. O caso foi para Recuperado." : `Pagamento registrado. Saldo: ${reais(r.saldoRestante)}.`);
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível registrar o pagamento.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            Para dívida que não veio do ERP. Abate do título mais antigo para o mais novo; saldo zero leva o caso para Recuperado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="pg-valor" rotulo="Valor recebido" erro={erro && valor != null ? erro : undefined}>
              <CampoDeReais id="pg-valor" valor={valor} onValor={setValor} />
            </Campo>
            <Campo id="pg-data" rotulo="Data do pagamento">
              <Input id="pg-data" type="date" max={isoDia(new Date())} value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
          </div>
          {baixaveis.length > 1 && (
            <Campo id="pg-titulo" rotulo="Abater de">
              <Select value={titulo} onValueChange={setTitulo}>
                <SelectTrigger id="pg-titulo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__fifo">Do mais antigo para o mais novo</SelectItem>
                  {baixaveis.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {(t.numero ?? "Título") + ` · ${t.vencimento.split("-").reverse().join("/")} · ${reais(t.saldo)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <BotaoSalvar salvando={registrar.isPending} disabled={!!erro}>
              Registrar
            </BotaoSalvar>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Contato
// ───────────────────────────────────────────────────────────────────────────

export function ContatoDialog({ aberto, onFechar, caso }: { aberto: boolean; onFechar: () => void; caso: InadimplenteResumo }) {
  const registrar = useRegistrarContato();
  const [canal, setCanal] = useState<CanalDeContato>("telefone");
  const [resultado, setResultado] = useState<ResultadoDoContato>("falou");
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (aberto) {
      setCanal("telefone");
      setResultado("falou");
      setNota("");
    }
  }, [aberto]);

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (!caso.casoId) return;
    registrar.mutate(
      { casoId: caso.casoId, canal, resultado, nota },
      {
        onSuccess: () => {
          toast.success("Contato registrado.");
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível registrar o contato.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          <DialogDescription>Ligação, mensagem ou visita a {caso.nome}. Entra no histórico do caso.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="ct-canal" rotulo="Canal">
              <Select value={canal} onValueChange={(v) => setCanal(v as CanalDeContato)}>
                <SelectTrigger id="ct-canal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROTULO_CANAL) as CanalDeContato[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {ROTULO_CANAL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo id="ct-res" rotulo="Resultado">
              <Select value={resultado} onValueChange={(v) => setResultado(v as ResultadoDoContato)}>
                <SelectTrigger id="ct-res">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROTULO_RESULTADO) as ResultadoDoContato[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROTULO_RESULTADO[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
          <Campo id="ct-nota" rotulo="O que ficou combinado">
            <Textarea id="ct-nota" rows={3} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={2000} />
          </Campo>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <BotaoSalvar salvando={registrar.isPending}>Registrar</BotaoSalvar>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Confirmação com motivo (arquivar, cancelar título, desfechos)
// ───────────────────────────────────────────────────────────────────────────

export function ConfirmarDialog({
  aberto,
  onFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  pedirMotivo,
  perigoso,
  confirmando,
  onConfirmar,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  descricao: string;
  rotuloConfirmar: string;
  pedirMotivo?: boolean;
  perigoso?: boolean;
  confirmando: boolean;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    if (aberto) setMotivo("");
  }, [aberto]);
  const bloqueado = pedirMotivo && !motivo.trim();
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {pedirMotivo && (
          <Campo id="cf-motivo" rotulo="Motivo">
            <Textarea id="cf-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus maxLength={500} />
          </Campo>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            type="button"
            variant={perigoso ? "destructive" : "default"}
            disabled={confirmando || bloqueado}
            onClick={() => onConfirmar(motivo.trim())}
          >
            {confirmando && <Loader2 className="animate-spin" />}
            {rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
