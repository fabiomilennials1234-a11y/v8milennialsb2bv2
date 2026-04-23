/**
 * MockupChatV3 — rota pública /_mockup/chat-v3
 *
 * Showcase visual da Onda 3.1:
 *   1. LeadDetailContent split — módulos info/pipe/tabs/notes/create
 *   2. Rate limit demo — token bucket client-side (20 tokens/min)
 *   3. Dark mode audit — tabela de tokens corrigidos
 *
 * Sem auth, sem Supabase, dados 100% mock.
 * Onda 3.1, C-mockup.
 */

import { useState, useCallback, useRef, Component, type ReactNode, type ErrorInfo } from "react";
import { Link } from "react-router-dom";
import { Moon, Sun, ExternalLink, CheckCircle2, XCircle, ChevronRight, GitBranch, Hash, Layers, Zap, Eye, Palette, Sparkles, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { createRateLimiter } from "@/lib/rate-limit";

// ─── Error Boundary local ────────────────────────────────────────────────────

interface EBProps { children: ReactNode; label: string }
interface EBState { hasError: boolean; message: string }

class SectionErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, message: error.message };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // silente — sem Sentry no mockup
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <span className="font-mono text-xs">Componente real requer contexto de produção.</span>
          <br />
          <span className="text-xs opacity-60">{this.state.message.slice(0, 80)}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Mock data ───────────────────────────────────────────────────────────────

const MOCK_LEAD = {
  id: "demo-lead-1",
  name: "Rodrigo Ferreira",
  company: "Distribuidora Souza",
  phone: "(11) 98765-4321",
  email: "rodrigo@souza.com.br",
  source: "meta_ads",
  qualification_score: 78,
  rating: 4,
  sdr_id: null,
  closer_id: null,
  responsible_id: null,
  organization_id: "demo-org",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  notes: "Lead quente — interessado no plano Profissional.",
};

// ─── Rate limit demo ─────────────────────────────────────────────────────────

interface BucketEntry {
  seq: number;
  allowed: boolean;
  tokensRemaining: number;
  retryAfterSec: number;
}

const BUCKET_CAPACITY = 20;

// ─── Dark mode audit data ─────────────────────────────────────────────────────

interface AuditEntry {
  component: string;
  path: string;
  before: string;
  after: string;
  category: "bg" | "text" | "border" | "chart";
}

const AUDIT_ENTRIES: AuditEntry[] = [
  { component: "PipeWhatsapp",        path: "src/pages/PipeWhatsapp.tsx",                        before: "bg-gray-900",           after: "bg-foreground/15",        category: "bg" },
  { component: "KanbanCard",          path: "src/components/pipe/KanbanCard.tsx",                 before: "text-gray-900",         after: "text-foreground",         category: "text" },
  { component: "ConfirmacaoCard",     path: "src/components/pipe/ConfirmacaoCard.tsx",            before: "text-gray-900",         after: "text-foreground",         category: "text" },
  { component: "LeadCard tiktok",     path: "src/components/leads/LeadCard.tsx",                  before: "#ff0050 hex",           after: "hsl(var(--muted))",       category: "bg" },
  { component: "PipelineAging chart", path: "src/components/analytics/PipelineAging.tsx",         before: "#22c55e hex",           after: "hsl(var(--success))",     category: "chart" },
  { component: "LeadScore badge",     path: "src/components/lead/info/LeadQualification.tsx",     before: "bg-green-500",          after: "bg-success/20 text-success", category: "bg" },
  { component: "LeadContactInfo",     path: "src/components/lead/info/LeadContactInfo.tsx",       before: "bg-white/10",           after: "bg-card",                 category: "bg" },
  { component: "TabPipe stages",      path: "src/components/lead/tabs/LeadTabPipe.tsx",           before: "border-gray-700",       after: "border-border",           category: "border" },
  { component: "ChatHeader bg",       path: "src/components/chat/view/ChatHeader.tsx",            before: "bg-zinc-950",           after: "bg-background",           category: "bg" },
  { component: "MessageBubble in",    path: "src/components/chat/view/MessageList.tsx",           before: "bg-zinc-800",           after: "bg-muted",                category: "bg" },
  { component: "MessageBubble out",   path: "src/components/chat/view/MessageList.tsx",           before: "#005c4b hex",           after: "hsl(var(--primary)/0.9)", category: "bg" },
  { component: "ContactList item",    path: "src/components/chat/layout/ContactList.tsx",         before: "hover:bg-gray-800",     after: "hover:bg-muted",          category: "bg" },
  { component: "StageBadge active",   path: "src/components/lead/pipe/LeadCurrentStage.tsx",      before: "bg-indigo-600",         after: "bg-primary",              category: "bg" },
  { component: "HistoryItem icon",    path: "src/components/lead/tabs/LeadTabHistory.tsx",        before: "text-blue-400 hex",     after: "text-primary",            category: "text" },
  { component: "SearchInput focus",   path: "src/components/chat/search/ChatSearchBar.tsx",       before: "ring-blue-500",         after: "ring-ring",               category: "border" },
];

// ─── Sub-components do módulo lead (stub visual) ──────────────────────────────

function ModuleCard({ label, path, description, children }: {
  label: string;
  path: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-primary/80 bg-primary/10 px-2 py-0.5 rounded">{label}</span>
      </div>
      <div className="text-[11px] font-mono text-muted-foreground/70 truncate">{path}</div>
      <div className="text-xs text-muted-foreground mb-1">{description}</div>
      <div className="rounded-lg border border-border bg-card p-3 min-h-[80px]">
        {children}
      </div>
    </div>
  );
}

// ─── Seção 1 — stub visual do split de LeadDetailContent ─────────────────────

function LeadContactInfoStub() {
  return (
    <div className="space-y-2">
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Nome</label>
        <div className="h-8 rounded border border-border bg-input px-2 flex items-center text-sm">{MOCK_LEAD.name}</div>
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Empresa</label>
        <div className="h-8 rounded border border-border bg-input px-2 flex items-center text-sm">{MOCK_LEAD.company}</div>
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Email</label>
        <div className="h-8 rounded border border-border bg-input px-2 flex items-center text-sm text-muted-foreground">{MOCK_LEAD.email}</div>
      </div>
    </div>
  );
}

function LeadResponsiblesStub() {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Responsáveis</label>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-xs gap-1">SDR: —</Badge>
        <Badge variant="secondary" className="text-xs gap-1">Closer: —</Badge>
        <Badge variant="secondary" className="text-xs gap-1">Responsável: —</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-1">Nenhum responsável atribuído</p>
    </div>
  );
}

function LeadQualificationStub() {
  const score = MOCK_LEAD.qualification_score;
  const rating = MOCK_LEAD.rating;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Score de qualificação</label>
        <Badge className="text-xs bg-success/20 text-success border-0">{score}</Badge>
      </div>
      <Progress value={score} className="h-1.5" />
      <div className="flex items-center gap-1 mt-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={cn("w-3 h-3 rounded-full", i < rating ? "bg-[hsl(47_100%_50%)]" : "bg-muted")} />
        ))}
        <span className="text-xs text-muted-foreground ml-1">Rating {rating}/5</span>
      </div>
    </div>
  );
}

function LeadCurrentStageStub() {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">Stage atual</label>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <span className="text-sm font-medium">abordado</span>
        <Badge variant="outline" className="text-xs ml-auto">pipe_whatsapp</Badge>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>novo_lead</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-medium">abordado</span>
        <ChevronRight className="w-3 h-3" />
        <span>respondeu</span>
        <ChevronRight className="w-3 h-3" />
        <span>agendado</span>
      </div>
    </div>
  );
}

// LeadFieldGridStub — grid unificada padrão + personalizados (C27/C28/C29 showcase)
function LeadFieldGridStub() {
  const MOCK_STANDARD = [
    { id: "s1", label: "Nome",      Icon: null,      value: MOCK_LEAD.name,    custom: false },
    { id: "s2", label: "Empresa",   Icon: null,      value: MOCK_LEAD.company, custom: false },
    { id: "s3", label: "Email",     Icon: null,      value: MOCK_LEAD.email,   custom: false },
    { id: "s4", label: "Telefone",  Icon: null,      value: MOCK_LEAD.phone,   custom: false },
    { id: "s5", label: "Segmento",  Icon: null,      value: "Distribuidora",   custom: false },
    { id: "s6", label: "Interesse", Icon: null,      value: "Plano Pro",       custom: false },
  ] as const;

  const MOCK_CUSTOM = [
    { id: "c1", label: "Orçamento",   value: "R$ 150.000",           custom: true },
    { id: "c2", label: "Website",     value: "https://souza.com.br", custom: true, url: true },
    { id: "c3", label: "Funcionários",value: "42",                   custom: true },
  ] as const;

  const ALL = [...MOCK_STANDARD, ...MOCK_CUSTOM];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {ALL.map((f) => (
          <div key={f.id} className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {f.custom && (
                <Sparkles className="w-2.5 h-2.5 shrink-0 text-muted-foreground/60" aria-label="Campo personalizado" />
              )}
              {f.label}
            </label>
            <div
              className="h-8 w-full rounded-md border border-transparent px-2 flex items-center text-sm
                hover:border-border hover:bg-muted/40 transition-colors cursor-pointer"
            >
              {"url" in f && f.url ? (
                <span className="text-primary underline underline-offset-2 flex items-center gap-1">
                  {f.value}
                  <ExternalLink className="w-3 h-3" />
                </span>
              ) : (
                <span className={f.custom ? "tabular-nums" : ""}>{f.value}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Adicionar campo — stub do AddCustomFieldPopover */}
      <button
        type="button"
        className="w-full flex items-center gap-1.5 text-xs text-muted-foreground
          hover:text-foreground hover:bg-muted/40 h-8 px-2 rounded-md transition-colors mt-1"
        disabled
        aria-disabled="true"
        title="No mockup — real component uses AddCustomFieldPopover"
      >
        <Plus className="w-3.5 h-3.5 shrink-0" />
        Adicionar campo
      </button>

      {/* Observações — LeadNotes já integrado no LeadTabInfo.tsx:118 */}
      <div className="pt-3 mt-3 border-t border-border/40 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Observações</label>
        <div
          className="min-h-[60px] w-full rounded-md border border-border/60 bg-background/40 px-2.5 py-2 text-sm leading-relaxed text-muted-foreground"
        >
          Lead veio via Meta Ads. Já demonstrou interesse no Plano Pro. Agendado call dia 22/04 às 14h.
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use LeadFieldGridStub — kept for reference */
function LeadCustomFieldsStub() {
  return <LeadFieldGridStub />;
}

// ─── Seção 2 — Rate limit demo ────────────────────────────────────────────────

function RateLimitSection() {
  const [log, setLog] = useState<BucketEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [tokens, setTokens] = useState(BUCKET_CAPACITY);
  const limiterRef = useRef(
    createRateLimiter({
      key: "mockup-v3-demo",
      capacity: BUCKET_CAPACITY,
      refillIntervalMs: 60_000,
      // inMemory — não toca localStorage da app real
      storage: (() => {
        const m = new Map<string, string>();
        return {
          getItem: (k: string) => m.get(k) ?? null,
          setItem: (k: string, v: string) => { m.set(k, v); },
          removeItem: (k: string) => { m.delete(k); },
        };
      })(),
    })
  );

  const runDemo = useCallback(async () => {
    setRunning(true);
    setLog([]);
    // Reset bucket pra começar do zero na demo
    limiterRef.current.reset();
    setTokens(BUCKET_CAPACITY);

    const entries: BucketEntry[] = [];
    for (let i = 1; i <= 25; i++) {
      const result = limiterRef.current.tryConsume(1);
      const entry: BucketEntry = {
        seq: i,
        allowed: result.allowed,
        tokensRemaining: result.tokensRemaining,
        retryAfterSec: result.retryAfterMs > 0 ? Math.ceil(result.retryAfterMs / 1000) : 0,
      };
      entries.push(entry);
      setLog([...entries]);
      setTokens(result.tokensRemaining);
      // Pequeno delay visual pra animar
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
    }
    setRunning(false);
  }, []);

  const bucketPct = Math.max(0, Math.min(100, (tokens / BUCKET_CAPACITY) * 100));
  const passed = log.filter((e) => e.allowed).length;
  const blocked = log.filter((e) => !e.allowed).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Controles */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            onClick={runDemo}
            disabled={running}
            size="sm"
            className="gap-2"
          >
            <Zap className="w-3.5 h-3.5" />
            {running ? "Simulando..." : "Simular 25 buscas"}
          </Button>
          {log.length > 0 && !running && (
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {passed} passaram
              </span>
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="w-3.5 h-3.5" />
                {blocked} bloqueadas
              </span>
            </div>
          )}
        </div>

        {/* Bucket visual */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Token bucket</span>
            <span className="tabular-nums font-mono">{Math.round(tokens)} / {BUCKET_CAPACITY}</span>
          </div>
          <Progress
            value={bucketPct}
            className={cn(
              "h-3 transition-all",
              bucketPct < 30 ? "[&>div]:bg-destructive" : bucketPct < 60 ? "[&>div]:bg-[hsl(47_100%_50%)]" : "[&>div]:bg-success"
            )}
          />
          <p className="text-[11px] text-muted-foreground/60">
            Capacidade: {BUCKET_CAPACITY} tokens · Refill: 1 min · Chave: <code className="font-mono">mockup-v3-demo</code>
          </p>
        </div>
      </div>

      {/* Log visual */}
      <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center justify-between">
          <span className="text-xs font-medium">Log de chamadas</span>
          {log.length > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{log.length}/25</span>
          )}
        </div>
        <div className="overflow-y-auto max-h-52 p-2 space-y-0.5">
          {log.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">
              Clique em "Simular 25 buscas" para ver o log
            </p>
          )}
          {log.map((entry) => (
            <div
              key={entry.seq}
              className={cn(
                "flex items-center gap-2 px-2 py-1 rounded text-xs font-mono",
                entry.allowed ? "text-success" : "text-destructive"
              )}
            >
              {entry.allowed ? (
                <CheckCircle2 className="w-3 h-3 shrink-0" />
              ) : (
                <XCircle className="w-3 h-3 shrink-0" />
              )}
              <span className="tabular-nums w-5 text-right opacity-50">#{entry.seq}</span>
              <span className={entry.allowed ? "text-success" : "text-destructive"}>
                {entry.allowed ? "allowed" : "blocked"}
              </span>
              {!entry.allowed && (
                <span className="text-muted-foreground ml-auto">
                  Aguarde {entry.retryAfterSec}s
                </span>
              )}
              {entry.allowed && (
                <span className="text-muted-foreground/50 ml-auto tabular-nums">
                  {Math.round(entry.tokensRemaining)} left
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Seção 3 — Dark mode audit ────────────────────────────────────────────────

const CATEGORY_LABEL: Record<AuditEntry["category"], string> = {
  bg: "background",
  text: "text",
  border: "border",
  chart: "chart",
};

const CATEGORY_COLOR: Record<AuditEntry["category"], string> = {
  bg: "text-blue-400",
  text: "text-purple-400",
  border: "text-orange-400",
  chart: "text-emerald-400",
};

function DarkAuditSection() {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground w-40">Componente</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Tipo</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Antes</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Depois</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Path</th>
          </tr>
        </thead>
        <tbody>
          {AUDIT_ENTRIES.map((entry, idx) => (
            <tr
              key={idx}
              className={cn(
                "border-b border-border/50 transition-colors hover:bg-muted/20",
                idx % 2 === 0 ? "bg-transparent" : "bg-muted/10"
              )}
            >
              <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{entry.component}</td>
              <td className="px-3 py-2 hidden md:table-cell">
                <span className={cn("font-mono text-[10px]", CATEGORY_COLOR[entry.category])}>
                  {CATEGORY_LABEL[entry.category]}
                </span>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-[11px] text-destructive/80 bg-destructive/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                  {entry.before}
                </code>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-[11px] text-success bg-success/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                  {entry.after}
                </code>
              </td>
              <td className="px-3 py-2 hidden lg:table-cell">
                <span className="font-mono text-[10px] text-muted-foreground/60 truncate max-w-[240px] inline-block">
                  {entry.path}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────────

export default function MockupChatV3() {
  const [isDark, setIsDark] = useState(true);

  // Aplica classe dark no elemento root para o mockup funcionar
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const root = node.ownerDocument?.documentElement;
    if (!root) return;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [isDark]);

  return (
    <div ref={rootRef} className="min-h-screen bg-background text-foreground transition-colors">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-primary shrink-0" />
              <h1 className="font-semibold text-sm sm:text-base truncate">
                MockupChatV3 — Onda 3.1 Showcase
              </h1>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] gap-1 font-mono">
                <GitBranch className="w-2.5 h-2.5" />
                feat/chat-ux-ui-redesign
              </Badge>
              <Badge variant="secondary" className="text-[10px] gap-1 font-mono">
                <Hash className="w-2.5 h-2.5" />
                81 commits
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDark((d) => !d)}
              aria-label={isDark ? "Mudar para light mode" : "Mudar para dark mode"}
              className="h-8 w-8 p-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="sm" asChild className="h-8 text-xs gap-1">
              <Link to="/_mockup/chat-v2">
                Ver v2
                <ExternalLink className="w-3 h-3" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-12">

        {/* Seção 1 — LeadDetailContent modular */}
        <section aria-labelledby="section-lead-split">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-bold shrink-0">1</div>
            <div>
              <h2 id="section-lead-split" className="text-base font-semibold">LeadDetailContent — split modular</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Componente monolítico dividido em <code className="font-mono text-primary text-[11px]">src/components/lead/</code> com sub-módulos independentes.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Col 1 — stub do LeadDetailContent */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5 text-primary" />
                  LeadDetailContent (shell)
                </CardTitle>
                <CardDescription className="text-[11px] font-mono">
                  src/components/lead/LeadDetailContent.tsx
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Mock do lead header */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                    {MOCK_LEAD.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{MOCK_LEAD.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{MOCK_LEAD.company}</p>
                  </div>
                  <Badge className="ml-auto text-[10px] bg-success/20 text-success border-0 shrink-0">
                    {MOCK_LEAD.qualification_score}
                  </Badge>
                </div>

                {/* Tabs mock */}
                <div className="flex gap-1 border-b border-border pb-1">
                  {["Info", "Pipeline", "Histórico", "Campanhas"].map((t, i) => (
                    <button
                      key={t}
                      className={cn(
                        "px-2 py-1 text-xs rounded-t transition-colors",
                        i === 0 ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Tab content mock — grid unificada (C27) */}
                <SectionErrorBoundary label="LeadResponsibles">
                  <LeadResponsiblesStub />
                </SectionErrorBoundary>

                <SectionErrorBoundary label="LeadQualification">
                  <LeadQualificationStub />
                </SectionErrorBoundary>

                <div className="border-t border-border/40 pt-3 mt-1">
                  <p className="text-[10px] font-mono text-muted-foreground/60 mb-2">LeadFieldGrid — padrão + personalizados</p>
                  <LeadFieldGridStub />
                </div>
              </CardContent>
            </Card>

            {/* Col 2 — sub-componentes individuais */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  Sub-componentes extraídos
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Cada módulo tem props próprias, testável isoladamente.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <ModuleCard
                  label="LeadContactInfo"
                  path="src/components/lead/info/LeadContactInfo.tsx"
                  description="Campos editáveis: nome, empresa, email. Props: formData + onChange."
                >
                  <LeadContactInfoStub />
                </ModuleCard>

                <ModuleCard
                  label="LeadResponsibles"
                  path="src/components/lead/info/LeadResponsibles.tsx"
                  description="SDR, Closer, Responsável (read-only). Props: responsible?, sdr?, closer?."
                >
                  <LeadResponsiblesStub />
                </ModuleCard>

                <ModuleCard
                  label="LeadQualification"
                  path="src/components/lead/info/LeadQualification.tsx"
                  description="Rating editável + score read-only. Props: formData, onChange, qualificationScore?."
                >
                  <LeadQualificationStub />
                </ModuleCard>

                <ModuleCard
                  label="LeadCurrentStage"
                  path="src/components/lead/pipe/LeadCurrentStage.tsx"
                  description="Stage ativa no pipeline. Props: leadId, pipelineEntries."
                >
                  <LeadCurrentStageStub />
                </ModuleCard>

                <ModuleCard
                  label="LeadFieldGrid"
                  path="src/components/lead/info/LeadFieldGrid.tsx"
                  description="Grid unificada: campos padrão + personalizados. Badge Sparkles sutil nos campos custom. Inline edit por tipo."
                >
                  <LeadFieldGridStub />
                </ModuleCard>

                <ModuleCard
                  label="AddCustomFieldPopover"
                  path="src/components/lead/info/AddCustomFieldPopover.tsx"
                  description="Cria campo personalizado inline: nome, tipo, opções (se select), obrigatório. useCreateCustomField."
                >
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">Botão trigger no fim do LeadFieldGrid:</p>
                    <button
                      type="button"
                      disabled
                      className="w-full flex items-center gap-1.5 text-xs text-muted-foreground
                        bg-muted/20 border border-dashed border-border h-8 px-2 rounded-md cursor-default"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      Adicionar campo
                    </button>
                    <p className="text-[10px] text-muted-foreground/50">
                      Abre Popover com mini form. Submit → useCreateCustomField → toast → grid atualiza.
                    </p>
                  </div>
                </ModuleCard>
              </CardContent>
            </Card>

            {/* Col 3 — hooks usados */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-primary" />
                  Hooks do módulo
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Responsabilidades separadas por domínio.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {([
                  { name: "useLeadByPhone", path: "hooks/useWhatsAppLeadIntegration.ts", desc: "Lead pelo número do WhatsApp" },
                  { name: "useLeadAllPipelines", path: "hooks/useLeadAllPipelines.ts", desc: "Todas as entradas em pipelines do lead" },
                  { name: "useLeadForm", path: "hooks/lead/useLeadForm.ts", desc: "Estado controlado do formulário de edição" },
                  { name: "useLeadCampaignsAttach", path: "hooks/lead/useLeadCampaignsAttach.ts", desc: "Vincula/desvincula campanhas" },
                  { name: "useLeadPipeHandlers", path: "hooks/lead/useLeadPipeHandlers.ts", desc: "Mover lead entre stages" },
                  { name: "useLeadCreateHandler", path: "hooks/lead/useLeadCreateHandler.ts", desc: "Criar novo lead com pushName" },
                  { name: "useLeadTimelineCompact", path: "hooks/useLeadTimeline.ts", desc: "Histórico compacto (5 eventos)" },
                ] as const).map((hook) => (
                  <div key={hook.name} className="group rounded-lg border border-border/60 bg-muted/20 p-2.5 hover:border-primary/30 transition-colors">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5 group-hover:border-primary/50 transition-colors">
                        {hook.name}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{hook.desc}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/50 mt-0.5 truncate">src/{hook.path}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

          </div>
        </section>

        <Separator />

        {/* Seção 2 — Rate limit demo */}
        <section aria-labelledby="section-rate-limit">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-bold shrink-0">2</div>
            <div>
              <h2 id="section-rate-limit" className="text-base font-semibold">Rate limit — token bucket client-side</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                <code className="font-mono text-primary text-[11px]">createRateLimiter</code> de <code className="font-mono text-[11px]">src/lib/rate-limit.ts</code>.
                20 tokens/min. Primeiras 20 passam, excedentes recebem "Aguarde Ns".
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="pt-6">
              <RateLimitSection />
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Seção 3 — Dark mode audit */}
        <section aria-labelledby="section-dark-audit">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-bold shrink-0">3</div>
            <div>
              <h2 id="section-dark-audit" className="text-base font-semibold">Dark mode audit — tokens corrigidos</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {AUDIT_ENTRIES.length} tokens hard-coded migrados para variáveis HSL do design system.
              </p>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Palette className="w-3.5 h-3.5 text-primary" />
                Componentes corrigidos
              </CardTitle>
              <CardDescription>
                Cada linha: valor hard-coded removido → token CSS HSL aplicado.
                Antes = literal Tailwind/hex. Depois = variável do tema.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DarkAuditSection />
            </CardContent>
          </Card>
        </section>

        {/* Footer */}
        <footer className="border-t border-border pt-6 pb-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground/60">
          <div className="flex items-center gap-3 flex-wrap">
            <span>Onda 3.1 · branch <code className="font-mono">feat/chat-ux-ui-redesign</code></span>
            <Badge
              variant="outline"
              className="font-mono text-[10px] border-primary/40 text-primary/70 gap-1 select-all"
              title="Adicione ao seu .env para ativar o ChatShell 3-col em /chat"
            >
              VITE_CHAT_ONDA_2B=true
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/_mockup/chat" className="hover:text-foreground transition-colors">v1</Link>
            <Link to="/_mockup/chat-v2" className="hover:text-foreground transition-colors">v2</Link>
            <span className="text-primary font-medium">v3</span>
          </div>
        </footer>

      </main>
    </div>
  );
}
