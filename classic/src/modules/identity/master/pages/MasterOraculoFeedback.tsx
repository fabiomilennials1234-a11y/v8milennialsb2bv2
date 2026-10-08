import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageSquareText, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface FeedbackCaseSummary {
  id: string;
  organization_name: string;
  target_type: "response" | "conversation";
  rating: "positive" | "negative";
  reason: string | null;
  comment: string | null;
  conversation_title: string | null;
  traced_responses: number;
  updated_at: string;
}

interface FeedbackCase extends FeedbackCaseSummary {
  question: string | null;
  answer: string | null;
  tools_used: string[] | null;
  trace: Array<{ turn_id: string; trace: Array<{ name: string; result: unknown }> }>;
}

const REASON: Record<string, string> = {
  wrong_number: "Número errado",
  misunderstood: "Não entendeu",
  too_obvious: "Óbvio demais",
  not_actionable: "Sem ação clara",
  invented: "Inventou algo",
};

export default function MasterOraculoFeedback() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("caso");
  const list = useQuery({
    queryKey: ["master-oraculo-feedback"],
    queryFn: async (): Promise<FeedbackCaseSummary[]> => {
      const { data, error } = await supabase.functions.invoke<{ casos: FeedbackCaseSummary[] }>(
        "oraculo-feedback",
        { body: { acao: "listar", limite: 100 } },
      );
      if (error) throw error;
      return data?.casos ?? [];
    },
  });
  const detail = useQuery({
    queryKey: ["master-oraculo-feedback", selectedId],
    enabled: !!selectedId,
    queryFn: async (): Promise<FeedbackCase> => {
      const { data, error } = await supabase.functions.invoke<{ caso: FeedbackCase }>(
        "oraculo-feedback",
        { body: { acao: "detalhe", feedback_id: selectedId } },
      );
      if (error || !data?.caso) throw error ?? new Error("caso_nao_encontrado");
      return data.caso;
    },
  });

  const cases = list.data ?? [];
  const negative = cases.filter((item) => item.rating === "negative").length;
  const invented = cases.filter((item) => item.reason === "invented").length;

  return (
    <div className="space-y-6 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operação de IA</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Qualidade do Oráculo</h1>
        <p className="mt-1 text-sm text-muted-foreground">Feedback reproduzível, com o rastro exato das consultas.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={MessageSquareText} label="Avaliações" value={cases.length} />
        <Metric icon={AlertTriangle} label="Negativas" value={negative} tone="warning" />
        <Metric icon={Sparkles} label="Possível invenção" value={invented} tone="danger" />
      </div>

      {list.isError && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          Não consegui carregar os casos. <Button variant="link" onClick={() => void list.refetch()}>Tentar novamente</Button>
        </div>
      )}

      <div className="grid min-h-[560px] overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[360px_1fr]">
        <ScrollArea className="border-b border-border lg:border-b-0 lg:border-r">
          <div className="space-y-1 p-2">
            {list.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando avaliações…</p>}
            {!list.isLoading && cases.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma avaliação registrada.</p>
            )}
            {cases.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setParams({ caso: item.id })}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                  selectedId === item.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{item.organization_name}</span>
                  <Badge variant={item.rating === "negative" ? "destructive" : "secondary"} className="ml-auto">
                    {item.rating === "negative" ? REASON[item.reason ?? ""] ?? "Negativa" : "Positiva"}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {item.conversation_title || "Conversa sem título"}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {item.target_type === "response" ? "Resposta" : "Conversa"} · {item.traced_responses} rastro(s)
                </p>
              </button>
            ))}
          </div>
        </ScrollArea>

        <ScrollArea>
          {!selectedId && (
            <div className="grid min-h-[560px] place-items-center p-8 text-center text-sm text-muted-foreground">
              Selecione uma avaliação para reabrir o caso.
            </div>
          )}
          {selectedId && detail.isLoading && <p className="p-6 text-sm text-muted-foreground">Abrindo caso…</p>}
          {detail.isError && (
            <div role="alert" className="p-6 text-sm text-destructive">Não consegui reabrir este caso.</div>
          )}
          {detail.data && <CaseDetail value={detail.data} />}
        </ScrollArea>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className={cn("size-4 text-primary", tone === "warning" && "text-amber-500", tone === "danger" && "text-destructive")} />
      <p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function CaseDetail({ value }: { value: FeedbackCase }) {
  return (
    <article className="space-y-6 p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{value.organization_name}</h2>
          <Badge variant={value.rating === "negative" ? "destructive" : "secondary"}>
            {value.rating === "negative" ? REASON[value.reason ?? ""] ?? "Negativa" : "Positiva"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{value.conversation_title || "Conversa sem título"}</p>
      </div>

      {value.comment && <Block title="Comentário"><p className="whitespace-pre-wrap text-sm">{value.comment}</p></Block>}
      {value.question && <Block title="Pergunta"><p className="whitespace-pre-wrap text-sm">{value.question}</p></Block>}
      {value.answer && <Block title="Resposta"><p className="whitespace-pre-wrap text-sm">{value.answer}</p></Block>}

      <Block title="Rastro das ferramentas">
        {value.trace.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ferramenta foi chamada.</p>
        ) : value.trace.map((turn) => (
          <div key={turn.turn_id} className="space-y-2">
            {turn.trace.map((tool, index) => (
              <details key={`${turn.turn_id}:${index}`} className="rounded-xl border border-border bg-background">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{tool.name}</summary>
                <pre className="max-h-80 overflow-auto border-t border-border p-3 text-xs text-muted-foreground">
                  {JSON.stringify(tool.result, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        ))}
      </Block>
    </article>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
