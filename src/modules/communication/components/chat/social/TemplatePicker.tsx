/**
 * O seletor de template do chat — a saída quando a janela de 24 horas fechou.
 *
 * ─── POR QUE ELE EXISTE ─────────────────────────────────────────────────────
 *
 * Passadas 24h da última mensagem do cliente, a Meta recusa texto livre. Até
 * aqui o composer avisava ("o envio pode ser recusado") e não oferecia
 * alternativa: o vendedor escrevia, mandava, e a mensagem sumia — a recusa vem
 * por callback, não na hora.
 *
 * ─── DUAS DECISÕES ──────────────────────────────────────────────────────────
 *
 * 1. SÓ APROVADO APARECE. Um template em análise não é opção, é espera; listá-lo
 *    como clicável entregaria uma recusa certa. Os outros estados vivem na tela
 *    de Ajustes, que é onde se acompanha.
 * 2. O BOTÃO ESTÁ SEMPRE DISPONÍVEL, não só com a janela fechada. Template é
 *    legítimo dentro da janela também, e um botão que aparece e some conforme o
 *    relógio ensina que a ferramenta é instável. O que muda com a janela é o
 *    DESTAQUE, não a existência.
 */
import { useMemo, useState } from "react";
import { AlertCircle, FileText, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import {
  useNotificameTemplates,
  type NotificameTemplate,
} from "@/modules/communication/hooks/useNotificameTemplates";
import { useSendWhatsAppTemplate } from "@/modules/communication/hooks/chat/useSendWhatsAppTemplate";
import {
  montarComponentesDeEnvio,
  previewDoTemplate,
  variaveisDoTemplate,
  variaveisFaltando,
} from "@/modules/communication/lib/template-send";

export interface TemplatePickerProps {
  /** A instância do canal oficial — é ela que tem os templates. */
  instanceId: string;
  /** Telefone do interlocutor. */
  contactExternalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplatePicker({
  instanceId,
  contactExternalId,
  open,
  onOpenChange,
}: TemplatePickerProps) {
  const { data: todos, isLoading, error } = useNotificameTemplates({
    instanceId,
    enabled: open,
  });
  const enviar = useSendWhatsAppTemplate(instanceId);

  const [escolhido, setEscolhido] = useState<NotificameTemplate | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});

  const aprovados = useMemo(
    () => (todos ?? []).filter((t) => t.status === "APPROVED"),
    [todos],
  );

  const vars = escolhido ? variaveisDoTemplate(escolhido) : null;
  const faltando = escolhido ? variaveisFaltando(escolhido, valores) : [];

  function fechar() {
    setEscolhido(null);
    setValores({});
    onOpenChange(false);
  }

  async function submeter() {
    if (!escolhido || faltando.length > 0) return;

    try {
      await enviar.mutateAsync({
        to: contactExternalId,
        templateName: escolhido.name,
        language: escolhido.language ?? "pt_BR",
        components: montarComponentesDeEnvio(escolhido, valores),
      });
      toast.success("Template enviado");
      fechar();
    } catch (e) {
      // O texto do servidor diz o motivo real — "canal não envia template",
      // "fora da janela", "template não encontrado" pedem reações diferentes.
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : fechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar template</DialogTitle>
          <DialogDescription>
            Mensagem aprovada pela Meta. É o que dá para enviar quando já passaram
            24 horas desde a última mensagem do cliente.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        )}

        {error && !isLoading && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-foreground">{(error as Error).message}</p>
          </div>
        )}

        {!isLoading && !error && aprovados.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            Nenhum template aprovado neste canal. Crie um em Ajustes → WhatsApp; a
            Meta precisa aprovar antes do primeiro envio.
          </p>
        )}

        {!isLoading && !error && aprovados.length > 0 && !escolhido && (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {aprovados.map((t) => (
              <button
                key={`${t.name}-${t.language ?? ""}`}
                type="button"
                onClick={() => {
                  setEscolhido(t);
                  setValores({});
                }}
                className="flex w-full flex-col gap-1 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium text-foreground">
                    {t.name}
                  </span>
                  {t.language && (
                    <span className="text-[11px] text-muted-foreground">{t.language}</span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {previewDoTemplate(t, {})}
                </p>
              </button>
            ))}
          </div>
        )}

        {escolhido && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">{escolhido.name}</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setEscolhido(null)}
              >
                Trocar
              </Button>
            </div>

            {vars && vars.todas.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                <Label className="text-xs">O que entra em cada variável</Label>
                {vars.todas.map((token) => (
                  <div key={token} className="flex items-center gap-2">
                    <code className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary">
                      {`{{${token}}}`}
                    </code>
                    <Input
                      value={valores[token] ?? ""}
                      onChange={(e) =>
                        setValores((atual) => ({ ...atual, [token]: e.target.value }))
                      }
                      placeholder={/^\d+$/.test(token) ? "Maria" : token}
                      className={cn("h-8 text-sm", faltando.includes(token) && "border-border")}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* O que o cliente vai ler. Mandar sem ver é o caminho curto para o
                cliente receber "Olá {{1}}". */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Como o cliente vê</p>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="whitespace-pre-wrap rounded-xl rounded-tr-sm bg-emerald-600/15 p-3 text-sm text-foreground/90">
                  {previewDoTemplate(escolhido, valores)}
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            onClick={submeter}
            disabled={!escolhido || faltando.length > 0 || enviar.isPending}
          >
            {enviar.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {faltando.length > 0
              ? `Faltam ${faltando.length} valor(es)`
              : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
