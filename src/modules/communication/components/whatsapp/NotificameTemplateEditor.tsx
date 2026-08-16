/**
 * Editor de template — escrever e submeter à Meta.
 *
 * A tela existe para tornar VISÍVEL o que a Meta recusa em silêncio. A recusa
 * dela é assíncrona e genérica: o template entra em análise, volta recusado
 * horas depois, e o motivo raramente diz qual regra quebrou. Por isso aqui:
 *
 *   - o preview mostra o texto como ele vai chegar, com as variáveis marcadas;
 *   - os problemas apontados pelo servidor aparecem TODOS de uma vez, e cada um
 *     ancorado no campo que o causou — não um por vez, não um resumo genérico;
 *   - o sucesso diz "em análise", não "pronto". Ler "criado" e tentar enviar em
 *     seguida é o erro que a própria tela induziria se dissesse outra coisa.
 */
import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Send } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  useCreateNotificameTemplate,
  NotificameTemplatesError,
  type TemplateProblem,
} from "../../hooks/useNotificameTemplates";

const LANGUAGES = [
  { value: "pt_BR", label: "Português (Brasil)" },
  { value: "en_US", label: "Inglês (EUA)" },
  { value: "es", label: "Espanhol" },
];

const CATEGORIES = [
  { value: "UTILITY", label: "Utilidade", hint: "Confirmações, avisos, atualizações de pedido" },
  { value: "MARKETING", label: "Marketing", hint: "Promoções e novidades" },
  { value: "AUTHENTICATION", label: "Autenticação", hint: "Códigos de verificação" },
];

const VARIABLE_RE = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;

/** O texto como vai chegar, com as variáveis destacadas. */
function PreviewText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { value: string; isVar: boolean }[] = [];
    let last = 0;
    for (const m of text.matchAll(VARIABLE_RE)) {
      const start = m.index ?? 0;
      if (start > last) out.push({ value: text.slice(last, start), isVar: false });
      out.push({ value: m[0], isVar: true });
      last = start + m[0].length;
    }
    if (last < text.length) out.push({ value: text.slice(last), isVar: false });
    return out;
  }, [text]);

  return (
    <>
      {parts.map((p, i) =>
        p.isVar ? (
          <span key={i} className="rounded bg-primary/15 px-1 text-primary">
            {p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

export function NotificameTemplateEditor({
  instanceId,
  open,
  onOpenChange,
}: {
  instanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const createTemplate = useCreateNotificameTemplate(instanceId);

  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [problems, setProblems] = useState<TemplateProblem[]>([]);

  const problemsOf = (field: string) => problems.filter((p) => p.field === field);
  const hasProblem = (field: string) => problemsOf(field).length > 0;

  function reset() {
    setName("");
    setHeader("");
    setBody("");
    setFooter("");
    setProblems([]);
  }

  async function handleSubmit() {
    setProblems([]);

    const components: { type: string; format?: string; text?: string }[] = [];
    if (header.trim()) components.push({ type: "HEADER", format: "TEXT", text: header.trim() });
    components.push({ type: "BODY", text: body });
    if (footer.trim()) components.push({ type: "FOOTER", text: footer.trim() });

    try {
      await createTemplate.mutateAsync({ name: name.trim(), language, category, components });
      toast({
        title: "Template enviado para análise",
        // "Em análise" e não "criado": a Meta ainda vai revisar, e só depois ele
        // pode ser enviado. Dizer "criado" faria o usuário tentar usar agora.
        description: "A Meta revisa e responde em algumas horas. Só depois ele pode ser enviado.",
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof NotificameTemplatesError && e.problems.length > 0) {
        setProblems(e.problems);
        return;
      }
      toast({
        title: "Não foi possível criar o template",
        description: e instanceof Error ? e.message : "Tente novamente",
        variant: "destructive",
      });
    }
  }

  const semCampo = problems.filter((p) => !p.field);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo template</DialogTitle>
          <DialogDescription>
            Templates são as mensagens que você pode enviar depois de 24 horas sem resposta do
            cliente. A Meta precisa aprovar antes do primeiro envio.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          {/* ── Formulário ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Nome interno</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="boas_vindas"
                className={cn(hasProblem("name") && "border-destructive")}
              />
              <p className="text-[11px] text-muted-foreground">
                Só minúsculas, números e _ . O cliente não vê este nome.
              </p>
              {problemsOf("name").map((p) => (
                <p key={p.code} className="text-[11px] text-destructive">
                  {p.message}
                </p>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Idioma</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className={cn(hasProblem("language") && "border-destructive")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as typeof category)}
                >
                  <SelectTrigger className={cn(hasProblem("category") && "border-destructive")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {CATEGORIES.find((c) => c.value === category)?.hint}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-header">Cabeçalho (opcional)</Label>
              <Input
                id="tpl-header"
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                placeholder="Seu pedido chegou"
                maxLength={60}
                className={cn(hasProblem("header") && "border-destructive")}
              />
              {problemsOf("header").map((p) => (
                <p key={p.code} className="text-[11px] text-destructive">
                  {p.message}
                </p>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Mensagem</Label>
              <Textarea
                id="tpl-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder={"Olá {{1}}, seu pedido {{2}} foi enviado."}
                className={cn(hasProblem("body") && "border-destructive")}
              />
              <p className="text-[11px] text-muted-foreground">
                Use <code className="text-primary">{"{{1}}"}</code>,{" "}
                <code className="text-primary">{"{{2}}"}</code> para os trechos que mudam a cada
                envio — em sequência, sem pular número.
              </p>
              {problemsOf("body").map((p) => (
                <p key={p.code} className="text-[11px] text-destructive">
                  {p.message}
                </p>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-footer">Rodapé (opcional)</Label>
              <Input
                id="tpl-footer"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Equipe Comercial"
                maxLength={60}
                className={cn(hasProblem("footer") && "border-destructive")}
              />
              <p className="text-[11px] text-muted-foreground">
                O rodapé não aceita variáveis.
              </p>
              {problemsOf("footer").map((p) => (
                <p key={p.code} className="text-[11px] text-destructive">
                  {p.message}
                </p>
              ))}
            </div>

            {semCampo.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="space-y-1">
                  {semCampo.map((p) => (
                    <p key={p.code} className="text-xs text-foreground">
                      {p.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Preview ────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Como o cliente vê</p>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="ml-auto max-w-full rounded-xl rounded-tr-sm bg-emerald-600/15 p-3 text-sm">
                {header.trim() && (
                  <p className="mb-1 font-semibold text-foreground">
                    <PreviewText text={header} />
                  </p>
                )}
                <p className="whitespace-pre-wrap text-foreground/90">
                  {body.trim() ? (
                    <PreviewText text={body} />
                  ) : (
                    <span className="text-muted-foreground">A mensagem aparece aqui…</span>
                  )}
                </p>
                {footer.trim() && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    <PreviewText text={footer} />
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={createTemplate.isPending}>
            {createTemplate.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Enviar para análise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
