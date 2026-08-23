import { useMemo } from "react";
import { AlertTriangle, CalendarClock, CircleDollarSign } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { useTitulos } from "@/modules/integrations";
import { resumirInadimplencia, type TituloNaTela } from "@/modules/carteira/lib/inadimplencia";

/**
 * Títulos a receber do cliente (SCRUM-229, bloco 4.1).
 *
 * O ERP sincroniza contas a receber desde a integração do Toth, e até aqui
 * NENHUMA superfície da Carteira mostrava. Medido em produção em 2026-08-21:
 * 214 títulos, 21 atrasados, R$ 667 mil em aberto — dado chegando ao banco e
 * morrendo lá.
 *
 * A régua de atraso é a DATA, não o `status` do ERP: aquele é o que ele disse
 * na última sincronização, e entre uma e outra o calendário anda. A conta mora
 * em `lib/inadimplencia.ts`, com teste.
 */

interface ClienteTitulosProps {
  clientId: string | null | undefined;
}

function formatarData(iso: string | null): string {
  if (!iso) return "sem data";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

function Atraso({ titulo }: { titulo: TituloNaTela }) {
  if (titulo.diasDeAtraso === null) {
    // Sem vencimento: rótulo próprio. Dizer "vence hoje" sobre campo vazio
    // seria inventar data.
    return <span className="text-muted-foreground">—</span>;
  }
  if (titulo.diasDeAtraso > 0) {
    return (
      <span className="font-medium text-destructive tabular-nums">
        {titulo.diasDeAtraso}d
      </span>
    );
  }
  if (titulo.diasDeAtraso === 0) {
    return <span className="font-medium text-amber-400">hoje</span>;
  }
  return (
    <span className="text-muted-foreground tabular-nums">
      em {Math.abs(titulo.diasDeAtraso)}d
    </span>
  );
}

export function ClienteTitulos({ clientId }: ClienteTitulosProps) {
  const { data: titulos = [], isLoading } = useTitulos(clientId);
  const resumo = useMemo(() => resumirInadimplencia(titulos), [titulos]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted/40" />
        ))}
      </div>
    );
  }

  // Duas ausências diferentes, e a distinção importa: "o ERP não mandou nada"
  // não é "este cliente está em dia". Confundir as duas faz o vendedor
  // acreditar numa quitação que ninguém verificou.
  if (titulos.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        Nenhum título sincronizado do ERP para este cliente.
      </p>
    );
  }

  if (resumo.fila.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        Todos os títulos deste cliente estão quitados.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Os três números que decidem se o vendedor liga hoje. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CircleDollarSign className="h-3 w-3" />
            Em aberto
          </div>
          <p className="mt-0.5 text-[15px] font-bold tabular-nums tracking-[-0.02em]">
            {formatBRL(resumo.emAberto)}
          </p>
        </div>

        <div
          className={cn(
            "rounded-lg border px-3 py-2",
            resumo.atrasado > 0
              ? "border-destructive/30 bg-destructive/[0.06]"
              : "border-border/60 bg-muted/20",
          )}
        >
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3" />
            Atrasado
          </div>
          <p
            className={cn(
              "mt-0.5 text-[15px] font-bold tabular-nums tracking-[-0.02em]",
              resumo.atrasado > 0 && "text-destructive",
            )}
          >
            {formatBRL(resumo.atrasado)}
          </p>
          {resumo.quantidadeAtrasada > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {resumo.quantidadeAtrasada}{" "}
              {resumo.quantidadeAtrasada === 1 ? "título" : "títulos"}
              {resumo.maiorAtraso !== null && ` · até ${resumo.maiorAtraso}d`}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            Próximo
          </div>
          <p className="mt-0.5 text-[15px] font-bold tabular-nums tracking-[-0.02em]">
            {resumo.proximoVencimento ? formatarData(resumo.proximoVencimento) : "—"}
          </p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 text-[11px]">Vencimento</TableHead>
            <TableHead className="h-8 text-[11px]">Situação</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Atraso</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resumo.fila.map((titulo) => (
            <TableRow key={titulo.id} className="border-border/50">
              <TableCell className="py-1.5 text-[12px] tabular-nums">
                {formatarData(titulo.vencimento)}
              </TableCell>
              <TableCell className="py-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-medium",
                    titulo.atrasado
                      ? "border-destructive/25 bg-destructive/10 text-destructive"
                      : "border-border/60 bg-muted/30 text-muted-foreground",
                  )}
                >
                  {titulo.atrasado ? "Atrasado" : "A vencer"}
                </Badge>
              </TableCell>
              <TableCell className="py-1.5 text-right text-[12px]">
                <Atraso titulo={titulo} />
              </TableCell>
              <TableCell className="py-1.5 text-right text-[12px] font-medium tabular-nums">
                {formatBRL(Number(titulo.valor) || 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
