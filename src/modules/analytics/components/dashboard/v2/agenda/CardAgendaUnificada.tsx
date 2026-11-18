import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Check, MessageCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatPhoneBR } from "@/shared/format/phone";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { CreateMeetingDialog, useUpdateMeeting } from "@/modules/engagement";
import { OPCOES_VISAO_AGENDA, useEscopoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import { useConcluirAgendaContato, useMarcarAgendaContato } from "@/modules/analytics/hooks/useAgendaContatos";
import { useAgendaUnificada, type ClienteDaAgenda } from "@/modules/analytics/hooks/useAgendaUnificada";
import { dataComSemana, distanciaRelativa } from "@/modules/analytics/lib/agenda-contatos";
import {
  OPCOES_PERIODO,
  TOM_ATRASADO,
  TOM_TIPO,
  contarAtrasados,
  contarPorTipo,
  filtrarPorTipo,
  type FiltroTipo,
  type ItemAgenda,
  type Periodo,
  type TipoItem,
} from "@/modules/analytics/lib/agenda-unificada";
import { ComandoCard } from "../ComandoCard";
import { AgendaDataPill } from "./AgendaDataPill";

const TIPOS: TipoItem[] = ["reuniao", "mensagem", "contato"];
const PLURAL: Record<TipoItem, string> = { reuniao: "Reuniões", mensagem: "Mensagens", contato: "Contatos" };
const VAZIO_POR_PERIODO: Record<Periodo, string> = {
  hoje: "Nada agendado para hoje",
  semana: "Nada agendado nesta semana",
  mes: "Nada agendado neste mês",
};

interface CardAgendaUnificadaProps {
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  tipo: FiltroTipo;
  onTipo: (t: FiltroTipo) => void;
}

/**
 * Agenda do Comando como máscara de TODOS os agendamentos (flag
 * `agenda_unificada`): reunião em amarelo, mensagem agendada em azul e o
 * próximo contato em neutro, no período Hoje / Semana / Mês. Só o próximo
 * contato tem o X — reunião e mensagem se gerenciam onde sempre se gerenciaram.
 */
export function CardAgendaUnificada({ periodo, onPeriodo, tipo, onTipo }: CardAgendaUnificadaProps) {
  const navigate = useNavigate();
  const escopo = useEscopoAgenda();
  const agenda = useAgendaUnificada(periodo);
  const marcar = useMarcarAgendaContato();
  const concluir = useConcluirAgendaContato();
  const atualizarReuniao = useUpdateMeeting();
  const [novaAberta, setNovaAberta] = useState(false);

  const contagem = useMemo(() => contarPorTipo(agenda.itens), [agenda.itens]);
  const visiveis = useMemo(() => filtrarPorTipo(agenda.itens, tipo), [agenda.itens, tipo]);
  const atrasados = useMemo(() => contarAtrasados(agenda.itens), [agenda.itens]);
  const ocupadaId =
    (concluir.isPending && concluir.variables?.id && `contato:${concluir.variables.id}`) ||
    (atualizarReuniao.isPending && atualizarReuniao.variables?.id && `meeting:${atualizarReuniao.variables.id}`) ||
    (marcar.isPending && agenda.itens.find((i) => i.contato?.lead_id === marcar.variables?.leadId)?.chave) ||
    null;

  const opcoesTipo = [
    { value: "todos", label: `Todos ${contagem.todos}` },
    ...TIPOS.map((t) => ({ value: t, label: `${PLURAL[t]} ${contagem[t]}` })),
  ];

  return (
    <>
      <ComandoCard
        icon={CalendarClock}
        title="Agenda"
        count={agenda.itens.length}
        tone={atrasados > 0 ? "urgent" : "default"}
        scopeHint={escopo.vendoEquipe ? "Equipe" : undefined}
        headerActions={
          <>
            <SegmentedControl
              label="Período da agenda"
              options={OPCOES_PERIODO.map((o) => ({ ...o }))}
              value={periodo}
              onValueChange={(v) => onPeriodo(v as Periodo)}
            />
            {escopo.podeAlternar && (
              <SegmentedControl
                label="Ver agendas"
                options={[...OPCOES_VISAO_AGENDA]}
                value={escopo.visao}
                onValueChange={(v) => escopo.setVisao(v === "meu" ? "meu" : "todos")}
              />
            )}
            <Button size="sm" onClick={() => setNovaAberta(true)}>
              <Plus aria-hidden className="mr-1 h-4 w-4" /> Nova agenda
            </Button>
          </>
        }
        isLoading={agenda.isLoading}
        isError={agenda.isError}
        onRetry={agenda.refetch}
        isEmpty={false}
        notice={
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <SegmentedControl
              label="Filtrar por tipo"
              options={opcoesTipo}
              value={tipo}
              onValueChange={(v) => onTipo(v as FiltroTipo)}
            />
            <Legenda />
            {(agenda.indisponiveis.eventos || agenda.indisponiveis.contatos || agenda.indisponiveis.atrasados) && (
              <p role="status" className="w-full text-[11.5px] text-warning-strong">
                {agenda.indisponiveis.contatos
                  ? "Os próximos contatos não carregaram para este usuário. Reuniões e mensagens estão completas."
                  : agenda.indisponiveis.eventos
                    ? "Reuniões e mensagens não carregaram. Os próximos contatos estão completos."
                    : "Os atrasados de dias anteriores não carregaram. O que está marcado para hoje está completo."}
              </p>
            )}
          </div>
        }
      >
        {visiveis.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <p className="text-[12px] font-semibold">{VAZIO_POR_PERIODO[periodo]}</p>
            <p className="max-w-[300px] text-[11px] text-muted-foreground/70">
              Reuniões, mensagens agendadas e próximos contatos aparecem aqui.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  <th scope="col" className={cn(TH, "pl-5")}>Tipo</th>
                  <th scope="col" className={TH}>Cód.</th>
                  <th scope="col" className={TH}>Cliente</th>
                  <th scope="col" className={TH}>Telefone</th>
                  <th scope="col" className={TH}>Quando</th>
                  <th scope="col" className={TH}>Cidade</th>
                  <th scope="col" className={TH}>Representante</th>
                  <th scope="col" className={cn(TH, "text-center")}>Contato</th>
                  <th scope="col" className="border-b border-border/60 py-2 pl-1 pr-4"><span className="sr-only">Fechar agenda</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((i) => (
                  <Linha
                    key={i.chave}
                    item={i}
                    cliente={i.leadId ? agenda.clientes.get(i.leadId) : undefined}
                    hoje={agenda.hoje}
                    mostrarDono={escopo.vendoEquipe}
                    ocupada={ocupadaId === i.chave}
                    onAbrirLead={() => i.leadId && navigate(`/leads?lead=${i.leadId}`)}
                    onRemarcar={(dia) => i.contato && marcar.mutate({ leadId: i.contato.lead_id, dia, ownerId: i.contato.owner_id })}
                    onConcluir={() => i.contato && concluir.mutate({ id: i.contato.id, lead_name: i.contato.lead_name })}
                    onDesfecho={(status) => atualizarReuniao.mutate({ id: i.origemId, status })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ComandoCard>
      <CreateMeetingDialog
        open={novaAberta}
        onOpenChange={setNovaAberta}
        tipos={["reuniao", "contato"]}
        onMarcarContato={({ leadId, dia, observacao }) => marcar.mutateAsync({ leadId, dia, observacao })}
      />
    </>
  );
}

function Legenda() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground" aria-label="Legenda de cores">
      {(["mensagem", "reuniao", "contato"] as const).map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-2 w-2 rounded-full", TOM_TIPO[t].dot)} />
          {TOM_TIPO[t].rotulo}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-2 rounded-full bg-gradient-to-b from-destructive to-warning" />
        Atrasada
      </li>
    </ul>
  );
}

const TH = "border-b border-border/60 px-2.5 py-2 font-bold";
const VAZIO = <span className="text-muted-foreground/50">—</span>;

function Linha({
  item: i,
  cliente,
  hoje,
  mostrarDono,
  ocupada,
  onAbrirLead,
  onRemarcar,
  onConcluir,
  onDesfecho,
}: {
  item: ItemAgenda;
  cliente?: ClienteDaAgenda;
  hoje: string;
  mostrarDono: boolean;
  ocupada: boolean;
  onAbrirLead: () => void;
  onRemarcar: (dia: string) => void;
  onConcluir: () => void;
  /** Reunião atrasada: registra o desfecho (`completed` | `no_show`). */
  onDesfecho: (status: "completed" | "no_show") => void;
}) {
  const celula = "border-b border-border/50 px-2.5 py-2.5 align-middle";
  const tom = TOM_TIPO[i.tipo];
  const c = i.contato;
  // Reunião/mensagem atrasada: vermelho + a cor do tipo. O contato atrasado já
  // se diz vermelho pela data (AgendaDataPill) e segue neutro no chip.
  const atrasoDeEvento = i.atrasada && i.tipo !== "contato" ? TOM_ATRASADO[i.tipo] : null;
  const reuniaoAberta = i.tipo === "reuniao" && i.atrasada;
  const codigo = c?.lead_erp_code ?? cliente?.erpCode ?? null;
  const telefone = c?.lead_phone ?? cliente?.phone ?? null;
  const cidade = c?.lead_cidade ?? cliente?.cidade ?? null;
  const uf = c?.lead_uf ?? cliente?.uf ?? null;
  const representante = c?.erp_representante ?? cliente?.representante ?? null;
  const nome = i.leadName || (i.tipo === "mensagem" ? "Sem cliente vinculado" : "Sem nome");

  return (
    <tr className={cn("group transition-colors hover:bg-muted/30", (ocupada || i.encerrada) && "opacity-60")}>
      <td className={cn(celula, "relative pl-5")}>
        {atrasoDeEvento ? (
          <span aria-hidden className="absolute inset-y-2 left-0 flex w-[3px] flex-col overflow-hidden rounded-r-full">
            <span className={cn("flex-1", atrasoDeEvento.filete[0])} />
            <span className={cn("flex-1", atrasoDeEvento.filete[1])} />
          </span>
        ) : (
          <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", tom.filete)} />
        )}
        <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold", atrasoDeEvento ? atrasoDeEvento.chip : tom.chip)}>
          {tom.rotulo}
          {atrasoDeEvento && <span className="font-bold">· atrasada</span>}
        </span>
      </td>
      <td className={cn(celula, "text-[12px] font-semibold tabular-nums text-muted-foreground")}>{codigo || VAZIO}</td>
      <td className={cn(celula, "max-w-[260px]")}>
        {i.leadId ? (
          <button
            type="button"
            onClick={onAbrirLead}
            className={cn("block max-w-full truncate text-left text-[13px] font-bold hover:underline focus-visible:underline focus-visible:outline-none", i.encerrada && "line-through")}
          >
            {nome}
          </button>
        ) : (
          <span className="block truncate text-[13px] font-bold text-muted-foreground">{nome}</span>
        )}
        {i.detalhe && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block truncate text-[11px] text-muted-foreground">{i.detalhe}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[320px]">{i.detalhe}</TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className={cn(celula, "whitespace-nowrap text-[12px] tabular-nums")}>{telefone ? formatPhoneBR(telefone) : VAZIO}</td>
      <td className={celula}>
        {c ? (
          <AgendaDataPill dia={c.data_agenda} situacao={c.situacao} hoje={hoje} onRemarcar={onRemarcar} disabled={ocupada} neutro />
        ) : (
          <span className="whitespace-nowrap text-[12px]">
            <span className={cn("font-semibold tabular-nums", atrasoDeEvento && "text-destructive-strong")}>{dataComSemana(i.dia)}</span>
            {i.hora && <span className="text-muted-foreground"> · {i.hora}</span>}
            {atrasoDeEvento && <span className="text-destructive-strong"> · {distanciaRelativa(i.dia, hoje)}</span>}
          </span>
        )}
      </td>
      <td className={cn(celula, "max-w-[140px] truncate text-[12px]")}>
        {cidade || uf ? (
          <>
            {cidade && <span className="capitalize">{cidade.toLowerCase()}</span>}
            {cidade && uf && " · "}
            {uf && <span className="text-muted-foreground">{uf.toUpperCase()}</span>}
          </>
        ) : VAZIO}
      </td>
      <td className={cn(celula, "max-w-[150px] text-[12px]")}>
        <span className="block truncate capitalize">{representante ? representante.toLowerCase() : VAZIO}</span>
        {mostrarDono && <span className="block truncate text-[11px] text-muted-foreground">Agenda: {i.ownerName || "—"}</span>}
      </td>
      <td className={cn(celula, "text-center")}>
        {telefone && i.leadId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <AbrirConversaButton
                  leadId={i.leadId}
                  phone={telefone}
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-full bg-primary-soft text-primary-soft-foreground hover:bg-primary hover:text-primary-foreground"
                  aria-label={`Entrar em contato com ${i.leadName || "o cliente"}`}
                >
                  <MessageCircle aria-hidden className="h-4 w-4" />
                </AbrirConversaButton>
              </span>
            </TooltipTrigger>
            <TooltipContent>Entrar em contato</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">Sem telefone</span>
        )}
      </td>
      <td className="border-b border-border/50 py-2.5 pl-1 pr-4 text-right align-middle">
        {reuniaoAberta && (
          <span className="inline-flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onDesfecho("completed")}
                  disabled={ocupada}
                  aria-label={`Compareceu: reunião com ${i.leadName || "cliente"}`}
                  className="grid h-8 w-8 place-items-center rounded-full bg-success/15 text-emerald-800 ring-1 ring-inset ring-success/40 transition-colors hover:bg-success/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:text-emerald-200"
                >
                  <Check aria-hidden className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Compareceu</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onDesfecho("no_show")}
                  disabled={ocupada}
                  aria-label={`Não compareceu: reunião com ${i.leadName || "cliente"}`}
                  className="grid h-8 w-8 place-items-center rounded-full bg-destructive/15 text-red-800 ring-1 ring-inset ring-destructive/40 transition-colors hover:bg-destructive/30 dark:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Não compareceu</TooltipContent>
            </Tooltip>
          </span>
        )}
        {c && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onConcluir}
                disabled={ocupada}
                aria-label={`Fechar agenda de ${c.lead_name || "cliente"}`}
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Fechar agenda</TooltipContent>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}
