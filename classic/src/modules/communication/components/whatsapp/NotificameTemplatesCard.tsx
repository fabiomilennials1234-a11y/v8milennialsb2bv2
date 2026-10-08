/**
 * Os templates aprovados de um canal oficial, na tela de canais.
 *
 * Existe porque a camada que lê templates estava pronta — 622 linhas, 22 testes
 * — e era inalcançável pelo produto: nenhuma edge function a expunha, nenhum
 * hook a chamava. Esta é a última milha.
 *
 * O que a tela mostra e por quê:
 *   - STATUS, sempre. Template PENDING não envia, REJECTED não envia, e o
 *     vendedor precisa saber disso ANTES de montar a campanha em cima dele;
 *   - FORMATO DA VARIÁVEL (posicional vs nomeada), que normalmente se esconde
 *     como detalhe técnico. Aqui é load-bearing: mandar um pelo outro faz a Meta
 *     recusar com mensagem genérica e a mensagem não chega ao cliente;
 *   - O CORPO, para o humano reconhecer o template pelo texto e não pelo nome
 *     técnico que alguém escolheu meses atrás.
 */
import { useState } from "react";
import { AlertCircle, FileText, Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  useNotificameTemplates,
  type NotificameTemplate,
  type NotificameTemplateStatus,
} from "../../hooks/useNotificameTemplates";
import { NotificameTemplateEditor } from "./NotificameTemplateEditor";

/** Só APPROVED é enviável. O resto é informação, não opção. */
const STATUS_LABEL: Record<NotificameTemplateStatus, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Recusado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
};

const STATUS_TONE: Record<NotificameTemplateStatus, string> = {
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  PENDING: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  REJECTED: "border-destructive/30 bg-destructive/10 text-destructive",
  PAUSED: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  DISABLED: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

function bodyText(template: NotificameTemplate): string | null {
  const body = template.components.find((c) => (c.type ?? "").toUpperCase() === "BODY");
  return body?.text?.trim() || null;
}

/** Quantas variáveis o corpo espera — `{{1}}` ou `{{nome}}`, a mesma contagem. */
function variableCount(template: NotificameTemplate): number {
  const text = template.components.map((c) => c.text ?? "").join(" ");
  const matches = text.match(/\{\{\s*[\w\d_]+\s*\}\}/g);
  return matches ? new Set(matches.map((m) => m.replace(/\s/g, ""))).size : 0;
}

function TemplateRow({ template }: { template: NotificameTemplate }) {
  const status = template.status;
  const body = bodyText(template);
  const vars = variableCount(template);

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-3 transition-colors hover:border-border">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm text-foreground">{template.name}</span>

        {status && (
          <Badge variant="outline" className={cn("text-[11px]", STATUS_TONE[status])}>
            {STATUS_LABEL[status]}
          </Badge>
        )}

        {template.category && (
          <Badge variant="outline" className="text-[11px] text-muted-foreground">
            {CATEGORY_LABEL[template.category] ?? template.category}
          </Badge>
        )}

        {template.language && (
          <span className="text-[11px] text-muted-foreground">{template.language}</span>
        )}
      </div>

      {body && (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      )}

      {vars > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {vars} {vars === 1 ? "variável" : "variáveis"}
          {template.parameterFormat === "NAMED"
            ? " — por nome, ex. {{nome}}"
            : template.parameterFormat === "POSITIONAL"
              ? " — por posição, ex. {{1}}"
              : null}
        </p>
      )}
    </div>
  );
}

export function NotificameTemplatesCard({ instanceId }: { instanceId: string }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const { data: templates, isLoading, error, refetch, isFetching } = useNotificameTemplates({
    instanceId,
  });

  const code = (error as { code?: string } | null)?.code;

  // Canal que não usa template não é erro do usuário — é o card não ter o que
  // dizer. Somem juntos: card e ruído.
  if (code === "templates_not_supported" || code === "channel_not_notificame") return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground">Templates</h4>
          {templates && templates.length > 0 && (
            <span className="text-xs text-muted-foreground">{templates.length}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("mr-1.5 h-3 w-3", isFetching && "animate-spin")} />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditorOpen(true)}
            className="h-7 px-2 text-xs"
          >
            <Plus className="mr-1.5 h-3 w-3" />
            Novo
          </Button>
        </div>
      </div>

      <NotificameTemplateEditor
        instanceId={instanceId}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      )}

      {error && !isLoading && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            {/* A mensagem vem do servidor com o motivo real — "sem permissão",
                "canal não conectado", "o fornecedor não respondeu" pedem reações
                diferentes, e um texto genérico as achataria numa só. */}
            <p className="text-xs text-foreground">{(error as Error).message}</p>
            {code === "subaccount_not_ready" && (
              <p className="text-[11px] text-muted-foreground">
                Conecte o canal oficial antes de consultar os templates.
              </p>
            )}
          </div>
        </div>
      )}

      {!isLoading && !error && templates?.length === 0 && (
        <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          Nenhum template neste canal ainda. Crie um aqui e a Meta analisa — só
          depois de aprovado ele pode ser enviado fora da janela de 24 horas.
        </p>
      )}

      {!isLoading && !error && templates && templates.length > 0 && (
        <div className="space-y-2">
          {templates.map((t) => (
            <TemplateRow key={`${t.name}-${t.language ?? ""}`} template={t} />
          ))}
        </div>
      )}
    </div>
  );
}
