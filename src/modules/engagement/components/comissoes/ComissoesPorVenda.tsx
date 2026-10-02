import { forwardRef } from "react";
import { format } from "date-fns";
import { CheckCircle2, Clock3, ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/bento";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/ui/user-avatar";

import { formatBRL } from "./comissoes-format";

export type FiltroStatus = "todas" | "pendentes" | "pagas";

/** O que `useCommissions` já devolve por linha — nada além disso. */
export interface LinhaComissao {
  id: string;
  amount: number;
  paid: boolean | null;
  rate_percent: number | null;
  type: string;
  created_at: string;
  team_member_id: string;
  team_member?: { id: string; name: string } | null;
  pipe_proposta?: {
    sale_value?: number | null;
    product_type?: string | null;
    lead?: { name?: string | null; company?: string | null } | null;
  } | null;
}

const TIPO: Record<string, string> = { mrr: "Recorrência", projeto: "Projeto", physical: "Unitário" };

interface Props {
  linhas: LinhaComissao[];
  isLoading: boolean;
  periodo: string;
  status: FiltroStatus;
  onStatus: (s: FiltroStatus) => void;
  /** null = todas as pessoas. */
  vendedor: string | null;
  onVendedor: (id: string | null) => void;
  /** Só aparece para quem vê o time inteiro. */
  vendedores?: { id: string; name: string }[];
  avatarDe: (id: string) => string | undefined;
}

/**
 * A tabela "Comissões por venda": as linhas que `useCommissions` já traz
 * (antes só eram somadas nos KPIs). Sem ação de aprovar/marcar paga — isso
 * espera decisão do CTO.
 */
export const ComissoesPorVenda = forwardRef<HTMLDivElement, Props>(function ComissoesPorVenda(
  { linhas, isLoading, periodo, status, onStatus, vendedor, onVendedor, vendedores, avatarDe },
  ref,
) {
  const daPessoa = vendedor ? linhas.filter((l) => l.team_member_id === vendedor) : linhas;
  const contagem = {
    todas: daPessoa.length,
    pendentes: daPessoa.filter((l) => !l.paid).length,
    pagas: daPessoa.filter((l) => !!l.paid).length,
  };
  const visiveis = daPessoa.filter((l) => (status === "todas" ? true : status === "pagas" ? !!l.paid : !l.paid));
  const totalValor = visiveis.reduce((s, l) => s + Number(l.pipe_proposta?.sale_value || 0), 0);
  const totalComissao = visiveis.reduce((s, l) => s + Number(l.amount || 0), 0);

  return (
    <Card ref={ref} className="scroll-mt-4 overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 pb-3">
        <div className="min-w-[12rem] flex-1">
          <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
            <IconChip icon={ReceiptText} />
            Comissões por venda
          </CardTitle>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {periodo} · {linhas.length} {linhas.length === 1 ? "comissão registrada" : "comissões registradas"}
          </p>
        </div>
        <Tabs value={status} onValueChange={(v) => onStatus(v as FiltroStatus)}>
          <TabsList variant="segmented" aria-label="Status da comissão">
            <TabsTrigger value="todas">Todas ({contagem.todas})</TabsTrigger>
            <TabsTrigger value="pendentes">Pendentes ({contagem.pendentes})</TabsTrigger>
            <TabsTrigger value="pagas">Pagas ({contagem.pagas})</TabsTrigger>
          </TabsList>
        </Tabs>
        {vendedores && vendedores.length > 1 && (
          <Select value={vendedor ?? "all"} onValueChange={(v) => onVendedor(v === "all" ? null : v)}>
            <SelectTrigger className="h-9 w-[200px]" aria-label="Vendedor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as pessoas</SelectItem>
              {vendedores.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : visiveis.length === 0 ? (
          <p className="px-6 pb-8 pt-2 text-center text-[13px] text-muted-foreground">
            {linhas.length === 0 ? "Nenhuma comissão registrada neste mês." : "Nenhuma comissão com este filtro."}
          </p>
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Venda</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => {
                const lead = l.pipe_proposta?.lead;
                const titulo = lead?.company || lead?.name || "Venda sem negócio vinculado";
                const sub = lead?.company && lead?.name ? lead.name : null;
                const tipo = l.pipe_proposta?.product_type ?? l.type;
                const nome = l.team_member?.name ?? "—";
                return (
                  <TableRow key={l.id}>
                    <TableCell className="py-3 pl-6">
                      <div className="flex min-w-0 items-center gap-3">
                        <UserAvatar
                          name={titulo}
                          size="sm"
                          className="rounded-[10px]"
                          fallbackClassName="rounded-[10px] bg-muted text-foreground/70"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold">{titulo}</p>
                          {sub && <p className="truncate text-[11.5px] text-muted-foreground">{sub}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px]">
                        <UserAvatar name={nome} avatarUrl={avatarDe(l.team_member_id)} size="xs" />
                        {nome.split(" ")[0]}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-[13px] text-muted-foreground tabular-nums">
                      {format(new Date(l.created_at), "dd/MM")}
                    </TableCell>
                    <TableCell className="py-3 text-[13px]">{TIPO[tipo] ?? tipo}</TableCell>
                    <TableCell className="py-3 text-right text-[13px] tabular-nums">
                      {l.pipe_proposta?.sale_value != null ? formatBRL(Number(l.pipe_proposta.sale_value)) : "—"}
                    </TableCell>
                    <TableCell className="py-3 text-right text-[13px] tabular-nums text-muted-foreground">
                      {l.rate_percent != null ? `${Number(l.rate_percent).toLocaleString("pt-BR")}%` : "—"}
                    </TableCell>
                    <TableCell className="py-3 text-right text-[13px] font-bold tabular-nums">
                      {formatBRL(Number(l.amount || 0))}
                    </TableCell>
                    <TableCell className="py-3 pr-6">
                      {l.paid ? (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Paga
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="gap-1">
                          <Clock3 className="h-3 w-3" />
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter className="bg-transparent">
              <TableRow className="hover:bg-transparent">
                <TableCell className="py-3 pl-6 text-[13px] font-bold" colSpan={4}>
                  Total · {visiveis.length} {visiveis.length === 1 ? "comissão" : "comissões"}
                </TableCell>
                <TableCell className="py-3 text-right text-[13px] font-bold tabular-nums">{formatBRL(totalValor)}</TableCell>
                <TableCell />
                <TableCell className="py-3 text-right text-[13px] font-extrabold tabular-nums">
                  {formatBRL(totalComissao)}
                </TableCell>
                <TableCell className="pr-6" />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
});
