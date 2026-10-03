/**
 * Aba "Configuração" do /master/automation-health.
 *
 * Mostra os workflows ATIVOS com nó que não consegue rodar. O gate no editor
 * previne os novos; esta aba existe para os que já estão no ar quebrados e para
 * os que apodreceram sozinhos — nenhum dos dois é alcançado por gate de ativação.
 *
 * Segue o padrão da aba Atraso: explica cada coisa enquanto mostra.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info, Wrench, CheckCircle2 } from "lucide-react";
import { useWorkflowConfigScan } from "@/modules/workflows";

const KIND = {
  podre: {
    label: "Apodreceu",
    classe: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  vazio: {
    label: "Nunca preenchido",
    classe: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
} as const;

export default function WorkflowConfigTab() {
  const { data: problemas, isLoading, error } = useWorkflowConfigScan();

  const podres = problemas?.filter((p) => p.kind === "podre").length ?? 0;
  const vazios = problemas?.filter((p) => p.kind === "vazio").length ?? 0;
  const orgs = new Set(problemas?.map((p) => p.organizationName)).size;

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" /> Como ler esta aba
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Cada linha é um <strong className="text-foreground">nó de automação que não consegue
            rodar</strong>. Quando a automação chega nele, ela morre — e o cliente não vê erro
            nenhum: para ele, a automação simplesmente não aconteceu.
          </p>
          <p>
            <Badge variant="outline" className={KIND.vazio.classe}>Nunca preenchido</Badge>{" "}
            — o campo obrigatório ficou em branco desde que o workflow foi criado. Desde hoje o
            editor <strong className="text-foreground">impede ativar</strong> um workflow assim, então
            esta lista só tende a encolher.
          </p>
          <p>
            <Badge variant="outline" className={KIND.podre.classe}>Apodreceu</Badge>{" "}
            — o campo <em>estava</em> certo e o mundo mudou embaixo dele: a etapa foi renomeada ou
            apagada depois. O workflow era válido quando foi salvo, então{" "}
            <strong className="text-foreground">nenhum gate de ativação pega este caso</strong> — só
            uma varredura como esta.
          </p>
          <p className="text-xs">
            Só workflows <strong className="text-foreground">ativos</strong> entram aqui. Rascunho
            desligado com nó pela metade é legítimo e não aparece.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" /> Nós que precisam de conserto
            {problemas && problemas.length > 0 && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {problemas.length} em {orgs} {orgs === 1 ? "cliente" : "clientes"}
                {podres > 0 && ` · ${podres} apodreceu`}
                {vazios > 0 && ` · ${vazios} nunca preenchido`}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-sm text-muted-foreground">Varrendo os workflows ativos…</p>
          ) : error ? (
            <p className="py-6 text-sm text-red-400">
              Não consegui varrer: {(error as Error).message}
            </p>
          ) : !problemas?.length ? (
            <p className="flex items-center gap-2 py-6 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Nenhum workflow ativo com nó incompleto. Nada a consertar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Automação</TableHead>
                  <TableHead>Nó</TableHead>
                  <TableHead>O que falta</TableHead>
                  <TableHead className="text-right">Tipo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {problemas.map((p) => (
                  <TableRow key={`${p.workflowId}:${p.nodeId}:${p.missing}`}>
                    <TableCell className="font-medium">{p.organizationName}</TableCell>
                    <TableCell className="text-muted-foreground">{p.workflowName}</TableCell>
                    <TableCell>{p.nodeLabel}</TableCell>
                    <TableCell className="text-amber-500 dark:text-amber-400">{p.missing}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={KIND[p.kind].classe}>
                        {KIND[p.kind].label}
                      </Badge>
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
