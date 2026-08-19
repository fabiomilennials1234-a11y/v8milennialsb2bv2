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

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** O texto como vai chegar, com as variáveis destacadas. */
/**
 * O texto como o CLIENTE vai ler.
 *
 * ⚠️ Substitui `{{1}}` pelo exemplo quando ele existe, e é esse o ponto: um
 * preview que mostra o símbolo não responde a pergunta que o usuário faz diante
 * dele — "o que isso vira?". Com o exemplo, ele lê a mensagem pronta, e o trecho
 * variável fica destacado para não sumir a ideia de que aquilo muda a cada envio.
 */
/**
 * O que dizer depois de submeter, a partir do que o FORNECEDOR devolveu.
 *
 * Função pura e exportada porque isto é uma decisão, não um enfeite: medido em
 * produção (19/08), um template voltou `REJECTED` no mesmo instante da criação e
 * a tela disse "a Meta responde em algumas horas". O usuário esperaria por um
 * veredito que já havia chegado, e a recusa só apareceria se ele voltasse à lista
 * e clicasse Atualizar.
 */
export function mensagemDaCriacao(status: string | null | undefined): {
  title: string;
  description: string;
  variant?: "destructive";
} {
  switch ((status ?? "").trim().toUpperCase()) {
    case "REJECTED":
      return {
        title: "A Meta recusou este template",
        description:
          "A recusa veio na hora. Revise o texto — promessa comercial, erro de escrita e " +
          "categoria trocada são os motivos mais comuns — e crie de novo com outro nome.",
        variant: "destructive",
      };
    case "APPROVED":
      return {
        title: "Template aprovado",
        description: "Já pode ser enviado, inclusive fora da janela de 24 horas.",
      };
    default:
      // PENDING, vazio ou palavra que não conhecemos. O default é o caminho
      // comum, e tratar desconhecido como "em análise" é o erro barato: o
      // usuário confere na lista. O caro seria afirmar aprovação.
      return {
        title: "Template enviado para análise",
        description:
          "A Meta revisa e responde em algumas horas. Acompanhe pelo botão Atualizar na lista.",
      };
  }
}

function PreviewText({
  text,
  exemplos = {},
}: {
  text: string;
  exemplos?: Record<string, string>;
}) {
  const parts = useMemo(() => {
    const out: { value: string; isVar: boolean }[] = [];
    let last = 0;
    for (const m of text.matchAll(VARIABLE_RE)) {
      const start = m.index ?? 0;
      if (start > last) out.push({ value: text.slice(last, start), isVar: false });
      const token = (m[1] ?? "").trim();
      const exemplo = (exemplos[token] ?? "").trim();
      out.push({ value: exemplo || m[0], isVar: true });
      last = start + m[0].length;
    }
    if (last < text.length) out.push({ value: text.slice(last), isVar: false });
    return out;
  }, [text, exemplos]);

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
  /**
   * Um exemplo por variável, chaveado pelo token (`"1"`, `"nome"`).
   *
   * A Meta EXIGE isso e recusa sem — horas depois, com motivo genérico. Aqui ele
   * tem um segundo papel, que é o que resolve a pergunta "para que serve o
   * {{1}}?": o exemplo entra no preview, e o usuário vê a mensagem PRONTA em vez
   * de um símbolo.
   */
  const [exemplos, setExemplos] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<TemplateProblem[]>([]);

  /** Os tokens de `{{…}}` de um texto, na ordem em que aparecem, sem repetir. */
  const variaveisDe = (texto: string): string[] => {
    const vistos: string[] = [];
    for (const m of texto.matchAll(VARIABLE_RE)) {
      const token = (m[1] ?? "").trim();
      if (token && !vistos.includes(token)) vistos.push(token);
    }
    return vistos;
  };

  const varsBody = useMemo(() => variaveisDe(body), [body]);
  const varsHeader = useMemo(() => variaveisDe(header), [header]);
  const todasVars = useMemo(
    () => [...varsHeader, ...varsBody.filter((v) => !varsHeader.includes(v))],
    [varsHeader, varsBody],
  );

  const problemsOf = (field: string) => problems.filter((p) => p.field === field);
  const hasProblem = (field: string) => problemsOf(field).length > 0;

  function reset() {
    setName("");
    setHeader("");
    setBody("");
    setFooter("");
    setExemplos({});
    setProblems([]);
  }

  async function handleSubmit() {
    setProblems([]);

    // O `example` viaja no formato DA META, não no nosso: `header_text` é lista
    // simples, `body_text` é lista DENTRO de lista (uma linha de exemplos).
    // Trocar os dois é recusa certa, e o validador do servidor confere.
    const exemploDe = (tokens: string[]) => tokens.map((t) => (exemplos[t] ?? "").trim());

    const components: {
      type: string;
      format?: string;
      text?: string;
      example?: unknown;
    }[] = [];

    if (header.trim()) {
      components.push({
        type: "HEADER",
        format: "TEXT",
        text: header.trim(),
        ...(varsHeader.length
          ? { example: { header_text: exemploDe(varsHeader) } }
          : {}),
      });
    }

    components.push({
      type: "BODY",
      text: body,
      ...(varsBody.length ? { example: { body_text: [exemploDe(varsBody)] } } : {}),
    });

    if (footer.trim()) components.push({ type: "FOOTER", text: footer.trim() });

    try {
      const criado = await createTemplate.mutateAsync({
        name: name.trim(),
        language,
        category,
        components,
      });

      // O status vem na resposta da criação e pode já ser REJECTED — a decisão
      // de o que dizer mora em `mensagemDaCriacao`, com teste.
      toast(mensagemDaCriacao(criado?.template?.status));

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
              <p className="text-[11px] text-muted-foreground">
                Uma linha em negrito acima da mensagem, como um assunto. Até 60
                caracteres.
              </p>
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
                Escreva <code className="text-primary">{"{{1}}"}</code> onde o texto muda a cada
                envio — o nome do cliente, o número do pedido. Numere em sequência,
                sem pular. Cada um vira um campo de exemplo aqui embaixo.
              </p>
              {problemsOf("body").map((p) => (
                <p key={p.code} className="text-[11px] text-destructive">
                  {p.message}
                </p>
              ))}
            </div>

            {/*
              OS EXEMPLOS.
              Só aparece quando há variável — um formulário que mostra campos
              vazios "por precaução" ensina que eles são opcionais, e estes não
              são: a Meta RECUSA o template sem eles, horas depois, com motivo
              genérico. Antes desta fatia o campo nem era enviado.
            */}
            {todasVars.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <Label className="text-xs">O que entra em cada variável</Label>
                  <p className="text-[11px] text-muted-foreground">
                    A Meta exige um exemplo de cada uma para aprovar. Ele não é
                    enviado ao cliente — serve para a análise, e para você ver a
                    mensagem pronta aqui ao lado.
                  </p>
                </div>

                <div className="space-y-2">
                  {todasVars.map((token) => (
                    <div key={token} className="flex items-center gap-2">
                      <code className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary">
                        {`{{${token}}}`}
                      </code>
                      <Input
                        value={exemplos[token] ?? ""}
                        onChange={(e) =>
                          setExemplos((atual) => ({ ...atual, [token]: e.target.value }))
                        }
                        placeholder={/^\d+$/.test(token) ? "Maria" : token}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                Linha pequena e apagada no fim da mensagem, tipo assinatura. Não
                aceita variáveis.
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
                    <PreviewText text={header} exemplos={exemplos} />
                  </p>
                )}
                <p className="whitespace-pre-wrap text-foreground/90">
                  {body.trim() ? (
                    <PreviewText text={body} exemplos={exemplos} />
                  ) : (
                    <span className="text-muted-foreground">A mensagem aparece aqui…</span>
                  )}
                </p>
                {footer.trim() && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    <PreviewText text={footer} exemplos={exemplos} />
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
