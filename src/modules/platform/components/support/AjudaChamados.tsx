import { useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, Clock3, Headset, Inbox, MessageSquareReply, Timer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, InkRow, InkSplit, KpiRow, KpiTile } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSupportTickets, type SupportTicket } from "@/modules/platform/hooks/useSupportTickets";
import { STATUS_LABELS, TIPO_LABELS } from "@/modules/platform/lib/support-ticket-draft";

const FECHADO = new Set(["resolvido", "fechado"]);

/** "2 h 15 min" a partir de milissegundos. */
function duracao(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * Aba "Meus chamados": os chamados que a RLS deixa ver (o autor vê os seus, o
 * admin vê os da org) — a mesma lista do painel de suporte, agora numa página.
 * A conversa continua no painel (`onAbrir` abre o thread lá).
 */
export function AjudaChamados({ onAbrir, onNovo }: { onAbrir: (id: string) => void; onNovo: () => void }) {
  const { data: tickets = [], isLoading } = useSupportTickets();
  const [selId, setSelId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "abertos" | "resolvidos">("todos");

  const abertos = tickets.filter((t) => !FECHADO.has(t.status));
  const agora = new Date();
  const resolvidosNoMes = tickets.filter((t) => {
    if (!t.resolved_at) return false;
    const d = new Date(t.resolved_at);
    return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
  }).length;
  const respondidos = tickets.filter((t) => t.first_response_at);
  const mediaResposta = respondidos.length
    ? respondidos.reduce((s, t) => s + (new Date(t.first_response_at!).getTime() - new Date(t.created_at).getTime()), 0) /
      respondidos.length
    : null;
  const sel = abertos.find((t) => t.id === selId) ?? abertos[0];
  const lista = tickets.filter((t) =>
    filtro === "todos" ? true : filtro === "abertos" ? !FECHADO.has(t.status) : FECHADO.has(t.status),
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-72 rounded-panel" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <KpiRow cols={4}>
        <KpiTile label="Abertos" value={tickets.filter((t) => t.status === "aberto" || t.status === "aguardando_cliente").length} icon={Inbox} tone="gold" note="aguardando a equipe ou você" />
        <KpiTile label="Em andamento" value={tickets.filter((t) => t.status === "em_andamento").length} icon={Clock3} tone="info" note="a equipe está nele" />
        <KpiTile label="Resolvidos no mês" value={resolvidosNoMes} icon={CheckCircle2} tone="good" note={format(agora, "MMMM 'de' yyyy", { locale: ptBR })} />
        <KpiTile
          label="Primeira resposta"
          value={mediaResposta != null ? duracao(mediaResposta) : "—"}
          icon={Timer}
          tone="neutral"
          note={respondidos.length ? `média de ${respondidos.length} ${respondidos.length === 1 ? "chamado" : "chamados"}` : "nenhuma resposta ainda"}
        />
      </KpiRow>

      {abertos.length > 0 && sel ? (
        <InkSplit
          title="Em aberto"
          count={`${abertos.length} ${abertos.length === 1 ? "chamado" : "chamados"}`}
          list={abertos.map((t) => {
            const selected = t.id === sel.id;
            return (
              <InkRow key={t.id} selected={selected} onClick={() => setSelId(t.id)}>
                <span
                  className={cn("grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px]", selected ? "bg-primary-foreground/10" : "bg-white/10")}
                  aria-hidden
                >
                  <Headset className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{t.title}</span>
                  <span className={cn("block truncate text-[11.5px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                    {STATUS_LABELS[t.status]} · há {formatDistanceToNowStrict(new Date(t.created_at), { locale: ptBR })}
                  </span>
                </span>
              </InkRow>
            );
          })}
          detail={<FocoChamado ticket={sel} onAbrir={onAbrir} />}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Inbox className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">Nenhum chamado em aberto</p>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Quando algo quebrar ou você tiver uma dúvida, abra um chamado e o suporte responde no painel de ajuda.
            </p>
            <Button variant="ink" className="mt-2" onClick={onNovo}>
              Abrir chamado
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 pb-3">
          <CardTitle className="min-w-[10rem] flex-1 text-[15px] tracking-[-0.02em]">Todos os chamados</CardTitle>
          <Tabs value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
            <TabsList variant="segmented" aria-label="Filtrar chamados">
              <TabsTrigger value="todos">Todos ({tickets.length})</TabsTrigger>
              <TabsTrigger value="abertos">Em aberto ({abertos.length})</TabsTrigger>
              <TabsTrigger value="resolvidos">Resolvidos ({tickets.length - abertos.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          {lista.length === 0 ? (
            <p className="px-6 pb-8 pt-2 text-center text-[13px] text-muted-foreground">Nenhum chamado aqui.</p>
          ) : (
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">Chamado</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Aberto em</TableHead>
                  <TableHead className="pr-6">Primeira resposta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => onAbrir(t.id)}>
                    <TableCell className="py-3 pl-6 text-[13px] font-semibold">{t.title}</TableCell>
                    <TableCell className="py-3 text-[13px] text-muted-foreground">{TIPO_LABELS[t.tipo]}</TableCell>
                    <TableCell className="py-3">
                      <Badge variant={FECHADO.has(t.status) ? "success" : t.status === "aguardando_cliente" ? "warning" : "soft"}>
                        {STATUS_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-[13px] tabular-nums text-muted-foreground">
                      {format(new Date(t.created_at), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="py-3 pr-6 text-[13px] tabular-nums text-muted-foreground">
                      {t.first_response_at
                        ? duracao(new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime())
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FocoChamado({ ticket, onAbrir }: { ticket: SupportTicket; onAbrir: (id: string) => void }) {
  return (
    <FocusCard className="gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ink">{STATUS_LABELS[ticket.status]}</Badge>
        {ticket.impacto === "parado" && <Badge variant="ink">Operação parada</Badge>}
        <span className="ml-auto text-[12px] font-semibold text-primary-foreground/70 tabular-nums">
          #{ticket.id.slice(0, 6)}
        </span>
      </div>
      <div>
        <p className="text-[1.35rem] font-extrabold leading-tight tracking-[-0.035em]">{ticket.title}</p>
        <p className="mt-1 text-[13px] text-primary-foreground/70">
          aberto em {format(new Date(ticket.created_at), "dd/MM 'às' HH:mm")} · {TIPO_LABELS[ticket.tipo]}
        </p>
      </div>
      {ticket.description && (
        <p className="line-clamp-3 rounded-2xl bg-[hsl(40_60%_8%/.1)] px-3 py-2.5 text-[13px] font-semibold leading-relaxed">
          {ticket.description}
        </p>
      )}
      <div className="mt-auto pt-1">
        <Button
          variant="outline"
          onClick={() => onAbrir(ticket.id)}
          className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
        >
          <MessageSquareReply />
          Abrir conversa
        </Button>
      </div>
    </FocusCard>
  );
}
