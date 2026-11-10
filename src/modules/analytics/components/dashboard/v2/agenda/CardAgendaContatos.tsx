import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, MessageCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatPhoneBR } from "@/shared/format/phone";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { OPCOES_VISAO_AGENDA, useEscopoAgenda, type VisaoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import {
  useAgendaContatos,
  useConcluirAgendaContato,
  useMarcarAgendaContato,
} from "@/modules/analytics/hooks/useAgendaContatos";
import {
  TOM_SITUACAO,
  dataComSemana,
  filtrarAgendas,
  type AgendaContato,
  type FiltroAgenda,
} from "@/modules/analytics/lib/agenda-contatos";
import { ComandoCard } from "../ComandoCard";
import { AgendaDataPill } from "./AgendaDataPill";
import { NovaAgendaDialog } from "./NovaAgendaDialog";

interface CardAgendaContatosProps {
  hoje: string;
  filtro: FiltroAgenda;
  onFiltro: (f: FiltroAgenda) => void;
}

/**
 * Agenda de contatos — a planilha da Café dentro do Comando, no lugar das
 * Tarefas. Uma linha por cliente com próximo contato marcado: Cliente,
 * Empresa, Data da agenda (azul/amarelo/vermelho), dados do cliente, Entrar em
 * contato e o X. A linha só sai pelo X; atrasada fica, em vermelho.
 */
export function CardAgendaContatos({ hoje, filtro, onFiltro }: CardAgendaContatosProps) {
  const navigate = useNavigate();
  const escopo = useEscopoAgenda();
  const { data, isLoading, isError, refetch } = useAgendaContatos();
  const marcar = useMarcarAgendaContato();
  const concluir = useConcluirAgendaContato();
  const [novaAberta, setNovaAberta] = useState(false);

  const ocupadaId =
    (concluir.isPending && concluir.variables?.id) ||
    (marcar.isPending && (data ?? []).find((a) => a.lead_id === marcar.variables?.leadId)?.id) ||
    null;

  return (
    <>
      <AgendaContatosView
        itens={data ?? []}
        hoje={hoje}
        isAdmin={escopo.vendoEquipe}
        visao={escopo.podeAlternar ? escopo.visao : undefined}
        onVisao={escopo.setVisao}
        filtro={filtro}
        onFiltro={onFiltro}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        ocupadaId={ocupadaId}
        onNova={() => setNovaAberta(true)}
        onAbrirLead={(a) => navigate(`/leads?lead=${a.lead_id}`)}
        onRemarcar={(a, dia) => marcar.mutate({ leadId: a.lead_id, dia, ownerId: a.owner_id })}
        onConcluir={(a) => concluir.mutate({ id: a.id, lead_name: a.lead_name })}
      />
      <NovaAgendaDialog open={novaAberta} onOpenChange={setNovaAberta} hoje={hoje} />
    </>
  );
}

export interface AgendaContatosViewProps {
  itens: AgendaContato[];
  hoje: string;
  /** A lista é da equipe: rótulo "Equipe" e o dono de cada agenda. */
  isAdmin: boolean;
  /** Toggle Meu/Todos — só passa para admin; sem isto o controle não aparece. */
  visao?: VisaoAgenda;
  onVisao?: (v: VisaoAgenda) => void;
  filtro: FiltroAgenda;
  onFiltro: (f: FiltroAgenda) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Linha com gravação em andamento (fica esmaecida e travada). */
  ocupadaId?: string | null;
  onNova: () => void;
  onAbrirLead: (a: AgendaContato) => void;
  onRemarcar: (a: AgendaContato, dia: string) => void;
  onConcluir: (a: AgendaContato) => void;
}

/** A parte visual, sem busca de dado — o que o Storybook e os testes montam. */
export function AgendaContatosView({
  itens: todas,
  hoje,
  isAdmin,
  visao,
  onVisao,
  filtro,
  onFiltro,
  isLoading = false,
  isError = false,
  onRetry,
  ocupadaId = null,
  onNova,
  onAbrirLead,
  onRemarcar,
  onConcluir,
}: AgendaContatosViewProps) {
  const contagem = useMemo(() => {
    const c = { atrasada: 0, hoje: 0, futura: 0 };
    for (const a of todas) c[a.situacao] += 1;
    return c;
  }, [todas]);
  const visiveis = useMemo(() => filtrarAgendas(todas, filtro), [todas, filtro]);

  const filtroDoControle = filtro.startsWith("dia:") ? "todas" : filtro;
  const opcoes = [
    { value: "todas", label: `Todas ${todas.length}` },
    { value: "atrasada", label: `Atrasadas ${contagem.atrasada}` },
    { value: "hoje", label: `Hoje ${contagem.hoje}` },
    { value: "futura", label: `Futuras ${contagem.futura}` },
  ];

  const vazio =
    filtro === "todas"
      ? { titulo: "Nenhuma agenda marcada", dica: "Marque o próximo contato com um cliente em Nova agenda." }
      : filtro === "atrasada"
        ? { titulo: "Nada atrasado", dica: "Todo próximo contato está em dia." }
        : filtro === "hoje"
          ? { titulo: "Nada para hoje", dica: "Nenhum cliente com contato marcado para hoje." }
          : filtro === "futura"
            ? { titulo: "Nada à frente", dica: "Nenhuma agenda depois de hoje." }
            : { titulo: "Nada neste dia", dica: `Nenhuma agenda em ${dataComSemana(filtro.slice(4))}.` };

  return (
    <ComandoCard
      icon={CalendarClock}
      title="Agenda"
      count={todas.length}
      tone={contagem.atrasada > 0 ? "urgent" : "default"}
      scopeHint={isAdmin ? "Equipe" : undefined}
      headerActions={
        <>
          {visao && onVisao && (
            <SegmentedControl
              label="Ver agendas"
              options={[...OPCOES_VISAO_AGENDA]}
              value={visao}
              onValueChange={(v) => onVisao(v === "meu" ? "meu" : "todos")}
            />
          )}
          <Button size="sm" onClick={onNova}>
            <Plus aria-hidden className="mr-1 h-4 w-4" /> Nova agenda
          </Button>
        </>
      }
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      isEmpty={false}
      notice={
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <SegmentedControl
            label="Filtrar agendas"
            options={opcoes}
            value={filtroDoControle}
            onValueChange={(v) => onFiltro(v as FiltroAgenda)}
          />
          {filtro.startsWith("dia:") && (
            <button
              type="button"
              onClick={() => onFiltro("todas")}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              {dataComSemana(filtro.slice(4))}
              <X aria-hidden className="h-3.5 w-3.5" />
              <span className="sr-only">Limpar filtro de dia</span>
            </button>
          )}
        </div>
      }
    >
      {visiveis.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <p className="text-[12px] font-semibold">{vazio.titulo}</p>
          <p className="max-w-[280px] text-[11px] text-muted-foreground/70">{vazio.dica}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                <th scope="col" className={cn(TH, "pl-5")}>Cód.</th>
                <th scope="col" className={TH}>Cliente</th>
                <th scope="col" className={TH}>Nome fantasia</th>
                <th scope="col" className={TH}>Telefones</th>
                <th scope="col" className={TH}>Data da agenda</th>
                <th scope="col" className={TH}>Cidade</th>
                <th scope="col" className={TH}>Representante</th>
                <th scope="col" className={cn(TH, "text-center")}>Contato</th>
                <th scope="col" className="border-b border-border/60 py-2 pl-1 pr-4"><span className="sr-only">Fechar agenda</span></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((a) => (
                <LinhaAgenda
                  key={a.id}
                  agenda={a}
                  hoje={hoje}
                  mostrarDono={isAdmin}
                  ocupada={ocupadaId === a.id}
                  onAbrirLead={() => onAbrirLead(a)}
                  onRemarcar={(dia) => onRemarcar(a, dia)}
                  onConcluir={() => onConcluir(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ComandoCard>
  );
}

const TH = "border-b border-border/60 px-2.5 py-2 font-bold";
const VAZIO = <span className="text-muted-foreground/50">—</span>;

function LinhaAgenda({
  agenda: a,
  hoje,
  mostrarDono,
  ocupada,
  onAbrirLead,
  onRemarcar,
  onConcluir,
}: {
  agenda: AgendaContato;
  hoje: string;
  mostrarDono: boolean;
  ocupada: boolean;
  onAbrirLead: () => void;
  onRemarcar: (dia: string) => void;
  onConcluir: () => void;
}) {
  const celula = "border-b border-border/50 px-2.5 py-2.5 align-middle";
  const fones = (a.lead_phones?.length ? a.lead_phones : a.lead_phone ? [a.lead_phone] : []).map((f) => formatPhoneBR(f));
  const fantasia = a.lead_company && a.lead_company.trim() !== (a.lead_name ?? "").trim() ? a.lead_company : null;

  return (
    <tr className={cn("group transition-colors hover:bg-muted/30", ocupada && "opacity-60")}>
      <td className={cn(celula, "relative pl-5 text-[12px] font-semibold tabular-nums text-muted-foreground")}>
        {/* Filete na cor da situação: a lista se lê de longe, sem ler a data. */}
        <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", TOM_SITUACAO[a.situacao].dot)} />
        {a.lead_erp_code || VAZIO}
      </td>
      <td className={cn(celula, "max-w-[210px]")}>
        <button type="button" onClick={onAbrirLead} className="block max-w-full truncate text-left text-[13px] font-bold hover:underline focus-visible:underline focus-visible:outline-none">
          {a.lead_name || "Sem nome"}
        </button>
        {a.observacao && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block truncate text-[11px] text-muted-foreground">{a.observacao}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[320px]">{a.observacao}</TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className={cn(celula, "max-w-[160px] truncate text-[12.5px]")}>{fantasia || VAZIO}</td>
      <td className={cn(celula, "text-[12px] tabular-nums")}>
        {fones.length === 0 ? VAZIO : (
          <>
            <span className="block whitespace-nowrap">{fones[0]}</span>
            {fones.length > 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
                    {fones[1]}{fones.length > 2 ? ` +${fones.length - 2}` : ""}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{fones.join(", ")}</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </td>
      <td className={celula}>
        <AgendaDataPill dia={a.data_agenda} situacao={a.situacao} hoje={hoje} onRemarcar={onRemarcar} disabled={ocupada} />
      </td>
      <td className={cn(celula, "max-w-[140px] truncate text-[12px]")}>
        {a.lead_cidade || a.lead_uf ? (
          <>
            {a.lead_cidade && <span className="capitalize">{a.lead_cidade.toLowerCase()}</span>}
            {a.lead_cidade && a.lead_uf && " · "}
            {a.lead_uf && <span className="text-muted-foreground">{a.lead_uf.toUpperCase()}</span>}
          </>
        ) : VAZIO}
      </td>
      <td className={cn(celula, "max-w-[150px] text-[12px]")}>
        <span className="block truncate capitalize">{a.erp_representante ? a.erp_representante.toLowerCase() : VAZIO}</span>
        {/* Representante é do ERP; a agenda é de quem marcou. Na visão da
            equipe o admin precisa ver os dois. */}
        {mostrarDono && <span className="block truncate text-[11px] text-muted-foreground">Agenda: {a.owner_name || "—"}</span>}
      </td>
      <td className={cn(celula, "text-center")}>
        {a.lead_phone ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <AbrirConversaButton
                  leadId={a.lead_id}
                  phone={a.lead_phone}
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-full bg-primary-soft text-primary-soft-foreground hover:bg-primary hover:text-primary-foreground"
                  aria-label={`Entrar em contato com ${a.lead_name || "o cliente"}`}
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onConcluir}
              disabled={ocupada}
              aria-label={`Fechar agenda de ${a.lead_name || "cliente"}`}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Fechar agenda</TooltipContent>
        </Tooltip>
      </td>
    </tr>
  );
}
