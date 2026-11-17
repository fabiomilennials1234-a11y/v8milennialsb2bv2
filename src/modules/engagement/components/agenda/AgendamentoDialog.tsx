import { useEffect, useMemo, useState } from "react";
import { addMinutes, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ClienteAgendaInfo } from "@/shared/components/ClienteAgendaInfo";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { useTeamMembers } from "@/modules/identity";
import { isPipelineVisible, sortPipelinesForNavigation, usePipelines } from "@/modules/pipelines/funis-da-agenda";
import { useBuscaClientes, type ClienteBuscado } from "@/modules/engagement/hooks/useBuscaClientes";
import { useCreateMeeting } from "@/modules/engagement/hooks/useMeetings";
import type { AgendamentoExtras, TipoAgendamento } from "@/modules/engagement/lib/agendamento-tipos";

export type { TipoAgendamento };

const ROTULO = "text-[12px] font-semibold";
const CHIP_ATIVO = "border-primary/60 bg-primary-soft text-primary-soft-foreground";
const CHIP_INATIVO = "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground";
const SEM_FUNIL = "__sem_funil__";
const DURACOES = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hora" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2 horas" },
];

const p2 = (n: number) => String(n).padStart(2, "0");
const paraDia = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const diaLocal = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, (m ?? 1) - 1, d ?? 1);
};

/** Próxima hora cheia — o horário que o vendedor mais aceita sem mexer. */
function proximaHoraCheia(base: Date): Date {
  const d = new Date(base);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export interface AgendamentoDialogProps extends AgendamentoExtras {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tipo em que o diálogo abre (padrão: o primeiro de `tipos`). */
  tipoInicial?: TipoAgendamento;
  /** Slot clicado na grade da Agenda. */
  initialStart?: Date;
  /** Quem abre pelo card do lead já sabe o cliente. */
  initialLeadId?: string | null;
  initialLeadName?: string | null;
  /** Funil de onde o diálogo foi aberto. */
  initialPipelineId?: string | null;
}

/**
 * Agendar com um cliente — o "Nova agenda" do Comando, agora também para
 * REUNIÃO (pedido da Café, que preferiu este formulário ao de "Nova atividade").
 *
 * Mesma sequência nos dois tipos: cliente, dia, observação. A reunião soma a
 * hora, a duração, o funil e os participantes — os campos que as reuniões da
 * Café realmente usam (funil em 93%, participante em quase todas); local, link
 * e "dia todo" ficaram de fora por não terem uso.
 *
 * Reunião não trava dia passado (lançar o que já aconteceu é uso legítimo);
 * próximo contato continua só para frente.
 */
export function AgendamentoDialog({
  open,
  onOpenChange,
  tipos = ["reuniao"],
  tipoInicial,
  onMarcarContato,
  initialStart,
  initialLeadId,
  initialLeadName,
  initialPipelineId,
}: AgendamentoDialogProps) {
  const tiposValidos = tipos.filter((t) => t !== "contato" || !!onMarcarContato);
  const [tipo, setTipo] = useState<TipoAgendamento>(tipoInicial ?? tiposValidos[0] ?? "reuniao");
  const [busca, setBusca] = useState("");
  const termo = useDebounce(busca, 250);
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null);
  const [dia, setDia] = useState<string>(() => paraDia(initialStart ?? new Date()));
  const [hora, setHora] = useState("09:00");
  const [duracao, setDuracao] = useState("60");
  const [funil, setFunil] = useState<string>(SEM_FUNIL);
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [observacao, setObservacao] = useState("");
  const [salvandoContato, setSalvandoContato] = useState(false);

  const resultados = useBuscaClientes(termo);
  const criarReuniao = useCreateMeeting();
  const { data: membros = [] } = useTeamMembers();
  const { data: funisRaw } = usePipelines();
  const funis = useMemo(
    () => sortPipelinesForNavigation(funisRaw ?? []).filter((p) => !!p.id && p.is_active !== false && isPipelineVisible(p)),
    [funisRaw],
  );

  const hoje = paraDia(new Date());
  const ehReuniao = tipo === "reuniao";

  useEffect(() => {
    if (!open) return;
    const inicio = initialStart ?? proximaHoraCheia(new Date());
    setTipo(tipoInicial ?? tiposValidos[0] ?? "reuniao");
    setBusca("");
    setCliente(
      initialLeadId
        ? { id: initialLeadId, name: initialLeadName ?? null, company: null, erp_code: null, uf: null, cidade: null, representante: null, telefones: [] }
        : null,
    );
    setDia(paraDia(inicio));
    setHora(`${p2(inicio.getHours())}:${p2(inicio.getMinutes())}`);
    setDuracao("60");
    setFunil(initialPipelineId || SEM_FUNIL);
    setParticipantes([]);
    setObservacao("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tipos` é literal novo a cada render do chamador
  }, [open, initialStart, initialLeadId, initialLeadName, initialPipelineId, tipoInicial]);

  const inicioIso = useMemo(() => {
    const d = new Date(`${dia}T${hora || "00:00"}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [dia, hora]);

  const pendente = criarReuniao.isPending || salvandoContato;
  const podeSalvar = !!cliente && !pendente && (!ehReuniao || !!inicioIso);

  const salvar = async () => {
    if (!cliente || !podeSalvar) return;
    if (ehReuniao && inicioIso) {
      const fim = addMinutes(inicioIso, Number(duracao));
      try {
        await criarReuniao.mutateAsync({
          title: `Reunião - ${cliente.name?.trim() || "cliente"}`,
          description: observacao.trim() || null,
          start_at: inicioIso.toISOString(),
          end_at: fim.toISOString(),
          all_day: false,
          event_type: "meeting",
          lead_id: cliente.id,
          pipeline_id: funil === SEM_FUNIL ? null : funil,
          participant_ids: participantes.length > 0 ? participantes : undefined,
        });
        onOpenChange(false);
      } catch {
        /* a mutation avisa */
      }
      return;
    }
    if (!onMarcarContato) return;
    setSalvandoContato(true);
    try {
      await onMarcarContato({ leadId: cliente.id, dia, observacao: observacao.trim() || null });
      onOpenChange(false);
    } catch {
      /* a mutation avisa */
    } finally {
      setSalvandoContato(false);
    }
  };

  const diaPorExtenso = format(diaLocal(dia), "EEE, dd 'de' MMM", { locale: ptBR });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{ehReuniao ? "Nova reunião" : "Nova agenda"}</DialogTitle>
          <DialogDescription>
            {ehReuniao ? "Escolha o cliente, o dia e a hora da reunião." : "Escolha o cliente e o dia do próximo contato."}
          </DialogDescription>
        </DialogHeader>

        {tiposValidos.length > 1 && (
          <SegmentedControl
            label="Tipo de agendamento"
            options={[
              { value: "reuniao", label: "Reunião" },
              { value: "contato", label: "Próximo contato" },
            ].filter((o) => tiposValidos.includes(o.value as TipoAgendamento))}
            value={tipo}
            onValueChange={(v) => setTipo(v as TipoAgendamento)}
          />
        )}

        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="agendamento-busca" className={ROTULO}>Cliente</label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="agendamento-busca"
                autoFocus={!cliente}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, empresa ou código do ERP"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            {cliente && (
              <p className="flex items-center gap-1.5 rounded-lg bg-primary-soft/60 px-3 py-1.5 text-[12px] text-primary-soft-foreground">
                <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-semibold">{cliente.name || "Sem nome"}</span>
              </p>
            )}
            <ul role="listbox" aria-label="Clientes encontrados" className="max-h-[220px] min-h-[96px] overflow-y-auto rounded-xl border border-border">
              {termo.trim().length < 2 ? (
                <li className="px-3 py-5 text-center text-[12px] text-muted-foreground">Digite ao menos 2 letras.</li>
              ) : resultados.isLoading ? (
                <li className="flex items-center justify-center gap-2 px-3 py-5 text-[12px] text-muted-foreground">
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Procurando…
                </li>
              ) : resultados.isError ? (
                <li className="px-3 py-5 text-center text-[12px] text-destructive-strong">Não deu para buscar. Tente de novo.</li>
              ) : (resultados.data ?? []).length === 0 ? (
                <li className="px-3 py-5 text-center text-[12px] text-muted-foreground">Nenhum cliente com “{termo.trim()}”.</li>
              ) : (
                (resultados.data ?? []).map((c) => {
                  const escolhido = cliente?.id === c.id;
                  return (
                    <li key={c.id} role="option" aria-selected={escolhido}>
                      <HoverCard openDelay={200} closeDelay={80}>
                        <HoverCardTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setCliente(c)}
                            className={cn(
                              "flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                              escolhido && "bg-primary-soft/60 hover:bg-primary-soft/60",
                            )}
                          >
                            <span
                              className={cn(
                                "shrink-0 rounded-md px-2 py-1 text-[13px] font-semibold tabular-nums",
                                c.erp_code ? "bg-muted text-foreground" : "text-[11.5px] font-normal text-muted-foreground",
                              )}
                            >
                              {c.erp_code ?? "s/ cód."}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold">{c.name || "Sem nome"}</span>
                              <span className="block truncate text-[11.5px] text-muted-foreground">{c.company || "Sem empresa"}</span>
                            </span>
                            {escolhido && <Check aria-hidden className="h-4 w-4 shrink-0 text-primary-soft-foreground" />}
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent side="right" align="start" className="w-80">
                          <ClienteAgendaInfo cliente={c} />
                        </HoverCardContent>
                      </HoverCard>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <span className={ROTULO}>{ehReuniao ? "Dia da reunião" : "Data da agenda"}</span>
            <div className="rounded-xl border border-border">
              <Calendar
                mode="single"
                locale={ptBR}
                selected={diaLocal(dia)}
                defaultMonth={diaLocal(dia)}
                disabled={ehReuniao ? undefined : (d) => paraDia(d) < hoje}
                onSelect={(d) => d && setDia(paraDia(d))}
              />
            </div>
          </div>
        </div>

        {ehReuniao && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="agendamento-hora" className={ROTULO}>Hora</label>
                <Input id="agendamento-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={ROTULO}>Duração</span>
                <Select value={duracao} onValueChange={setDuracao}>
                  <SelectTrigger aria-label="Duração"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURACOES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={ROTULO}>Funil <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <Select value={funil} onValueChange={setFunil}>
                <SelectTrigger aria-label="Funil"><SelectValue placeholder="Nenhum funil" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_FUNIL}>Nenhum funil</SelectItem>
                  {funis.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {membros.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className={ROTULO}>Participantes <span className="font-normal text-muted-foreground">(opcional)</span></span>
                <div className="flex flex-wrap gap-1.5">
                  {membros.map((m) => {
                    const ativo = participantes.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={ativo}
                        onClick={() => setParticipantes((p) => (ativo ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                        className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all", ativo ? CHIP_ATIVO : CHIP_INATIVO)}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="agendamento-obs" className={ROTULO}>
            Observação <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <Textarea
            id="agendamento-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={ehReuniao ? "Ex.: apresentar a linha de cápsulas" : "Ex.: ligar para fechar o pedido de dezembro"}
          />
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-[11.5px] text-muted-foreground">
            {!cliente ? (
              "Escolha um cliente na lista."
            ) : ehReuniao ? (
              <>Reunião com <b className="text-foreground">{cliente.name || "o cliente"}</b> em <b className="text-foreground">{diaPorExtenso}</b>{inicioIso ? <> às <b className="text-foreground">{hora}</b></> : null}.</>
            ) : (
              <>Próximo contato com <b className="text-foreground">{cliente.name}</b> em <b className="text-foreground">{diaPorExtenso}</b>. Se já houver agenda dele com você, a data é trocada.</>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => void salvar()} disabled={!podeSalvar}>
              {pendente && <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />}
              {ehReuniao ? "Marcar reunião" : "Salvar agenda"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
