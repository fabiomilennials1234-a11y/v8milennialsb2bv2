/**
 * ⚠️ PROTÓTIPO DESCARTÁVEL — não é código de produção.
 *
 * Responde ao ticket #1607 (mapa #1605): como o seletor de Conversa do Lead se
 * parece e se comporta. Três conceitos radicalmente diferentes, alternáveis por
 * `?v=1|2|3`, sobre DADOS REAIS da org do usuário logado.
 *
 * Rota: /seletor-conversa-preview?lead=<uuid>&v=2
 *
 * O que este protótipo NÃO é: a consulta agregada aqui é client-side de
 * propósito — a forma final (RPC vs query, custo, índice) é o ticket #1610.
 * Aqui ela existe só para as linhas terem número de verdade.
 *
 * Decisões do mapa que este protótipo encarna:
 *   1  multi-caixa → sempre pergunta
 *   5  caixa desconectada / sem permissão aparece, com o motivo
 *   6  "desabilitada" = não pode escrever; continua clicável e abre em leitura
 *   7  sem histórico → grupo "iniciar conversa por"
 *   +  multicanal desde já (WhatsApp + Instagram), decisão do CTO em 16/08
 *
 * Quando o conceito for escolhido: dobrar a decisão no componente real e
 * apagar este arquivo junto da rota em App.tsx.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { useCurrentTeamMember } from "@/modules/identity";
import { useInboxBoxes } from "@/modules/communication/hooks/chat/useInboxBoxes";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MessageCircle,
  Instagram,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  PlugZap,
} from "lucide-react";

// ─── Dados (throwaway) ───────────────────────────────────────────────────────

interface BoxConversation {
  boxId: string;
  boxName: string;
  channel: "whatsapp" | "instagram";
  /** `connected` etc. — vem da caixa. */
  status: string;
  lastAt: string | null;
  lastText: string | null;
  lastDirection: "incoming" | "outgoing" | null;
  unread: number;
  /** Motivo pelo qual não dá pra escrever. `null` = pode escrever. */
  readOnlyReason: string | null;
}

/** Agrega, por caixa, a conversa que o lead tem. Client-side — ver #1610. */
function useLeadConversationsByBox(leadPhone: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { boxes } = useInboxBoxes();
  const target = normalizePhone(leadPhone);

  return useQuery<BoxConversation[]>({
    queryKey: ["proto-lead-conversations", organizationId, target, boxes.length],
    queryFn: async () => {
      if (!organizationId || !target) return [];

      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("instance_id, content, timestamp, direction")
        .eq("organization_id", organizationId)
        .eq("normalized_phone", target)
        .order("timestamp", { ascending: false })
        .limit(500);
      if (error) throw error;

      const byInstance = new Map<string, { last: (typeof data)[number]; unread: number }>();
      for (const row of data ?? []) {
        if (!row.instance_id) continue;
        const cur = byInstance.get(row.instance_id);
        if (!cur) byInstance.set(row.instance_id, { last: row, unread: 0 });
        if (row.direction === "incoming") {
          byInstance.get(row.instance_id)!.unread += 1;
        }
      }

      return boxes.map<BoxConversation>((box) => {
        const hit = box.kind === "whatsapp" ? byInstance.get(box.id) : undefined;
        const disconnected = box.status !== "connected";
        return {
          boxId: box.id,
          boxName: box.name,
          channel: box.kind,
          status: box.status,
          lastAt: hit?.last.timestamp ?? null,
          lastText: hit?.last.content ?? null,
          lastDirection:
            hit?.last.direction === "incoming"
              ? "incoming"
              : hit?.last.direction === "outgoing"
                ? "outgoing"
                : null,
          unread: hit?.unread ?? 0,
          readOnlyReason: disconnected ? "Número desconectado" : null,
        };
      });
    },
    enabled: !!organizationId && !!target,
  });
}

// ─── Apresentação compartilhada ──────────────────────────────────────────────

function relativo(iso: string | null): string {
  if (!iso) return "";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
}

function ChannelGlyph({ channel, className }: { channel: "whatsapp" | "instagram"; className?: string }) {
  const Icon = channel === "whatsapp" ? MessageCircle : Instagram;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />;
}

function split(rows: BoxConversation[]) {
  return {
    comConversa: rows
      .filter((r) => r.lastAt)
      .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")),
    semConversa: rows.filter((r) => !r.lastAt),
  };
}

// ─── V1 — Lista densa. A CAIXA domina. ───────────────────────────────────────

function VarianteLista({ rows }: { rows: BoxConversation[] }) {
  const { comConversa, semConversa } = split(rows);
  const Linha = (r: BoxConversation) => (
    <button
      key={r.boxId}
      className={cn(
        "group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-left",
        "transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
      )}
    >
      <span className="relative">
        <ChannelGlyph channel={r.channel} className="text-muted-foreground" />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-card",
            r.readOnlyReason ? "bg-muted-foreground/50" : "bg-emerald-500",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{r.boxName}</span>
          {r.readOnlyReason && (
            <span className="shrink-0 text-[11px] text-muted-foreground">só leitura</span>
          )}
        </span>
        {r.lastAt && (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {r.lastDirection === "incoming" ? (
              <ArrowDownLeft className="size-3 shrink-0 text-emerald-500" />
            ) : (
              <ArrowUpRight className="size-3 shrink-0" />
            )}
            <span className="truncate">{r.lastText ?? "mídia"}</span>
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 tabular-nums">
        {r.unread > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground">
            {r.unread}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">{relativo(r.lastAt)}</span>
      </span>
    </button>
  );

  return (
    <div className="w-[380px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      {comConversa.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Conversa em andamento
          </p>
          {comConversa.map(Linha)}
        </>
      )}
      {semConversa.length > 0 && (
        <>
          <p className="border-t border-border px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Iniciar conversa por
          </p>
          {semConversa.slice(0, 4).map(Linha)}
        </>
      )}
    </div>
  );
}

// ─── V2 — Cards. A CONVERSA domina. ──────────────────────────────────────────

function VarianteCards({ rows }: { rows: BoxConversation[] }) {
  const { comConversa, semConversa } = split(rows);
  return (
    <div className="w-[420px] space-y-2 rounded-2xl border border-border bg-card p-2 shadow-2xl">
      {comConversa.map((r) => (
        <button
          key={r.boxId}
          className={cn(
            "group w-full rounded-xl border border-border/60 bg-background/40 p-3 text-left",
            "transition-all hover:border-primary/40 hover:bg-background",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <ChannelGlyph channel={r.channel} className="text-primary" />
              <span className="truncate text-sm font-semibold">{r.boxName}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{relativo(r.lastAt)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-snug text-muted-foreground">
            {r.lastDirection === "outgoing" && (
              <span className="mr-1 text-foreground/50">Você:</span>
            )}
            {r.lastText ?? "mídia"}
          </p>
          {(r.unread > 0 || r.readOnlyReason) && (
            <div className="mt-2 flex items-center gap-2">
              {r.unread > 0 && (
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                  {r.unread} não lida{r.unread > 1 ? "s" : ""}
                </span>
              )}
              {r.readOnlyReason && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Lock className="size-3" /> {r.readOnlyReason} · abre em leitura
                </span>
              )}
            </div>
          )}
        </button>
      ))}
      {semConversa.length > 0 && (
        <div className="rounded-xl border border-dashed border-border/70 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Primeiro contato por
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {semConversa.slice(0, 6).map((r) => (
              <button
                key={r.boxId}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs",
                  "transition-colors hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                <ChannelGlyph channel={r.channel} className="size-3 text-muted-foreground" />
                {r.boxName}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── V3 — Comando. A BUSCA domina. Aguenta 139 caixas. ───────────────────────

function VarianteComando({ rows }: { rows: BoxConversation[] }) {
  const [q, setQ] = useState("");
  const filtradas = useMemo(() => {
    const { comConversa, semConversa } = split(rows);
    const match = (r: BoxConversation) =>
      r.boxName.toLowerCase().includes(q.toLowerCase());
    return [...comConversa.filter(match), ...semConversa.filter(match)];
  }, [rows, q]);

  return (
    <div className="w-[460px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Falar com Fábio por…"
          className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {filtradas.map((r) => (
          <button
            key={r.boxId}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
              "transition-colors hover:bg-muted/60",
            )}
          >
            <ChannelGlyph channel={r.channel} className="text-muted-foreground" />
            <span className="truncate font-medium">{r.boxName}</span>
            {r.lastAt ? (
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {r.unread > 0 && (
                  <span className="rounded bg-primary/15 px-1 font-semibold text-primary">
                    {r.unread}
                  </span>
                )}
                {relativo(r.lastAt)}
              </span>
            ) : (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">
                sem conversa
              </span>
            )}
            {r.readOnlyReason && <PlugZap className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        ))}
        {filtradas.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma caixa com esse nome.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function SeletorConversaPreview() {
  const [params, setParams] = useSearchParams();
  const variante = params.get("v") ?? "1";
  const [phone, setPhone] = useState(params.get("phone") ?? "");
  const { data: rows = [], isLoading } = useLeadConversationsByBox(phone || null);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      {import.meta.env.VITE_PROTO_APONTA_PROD === "1" && (
        <div
          role="alert"
          className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <Lock className="size-4 shrink-0" />
          <span>
            <strong>Esta aba fala com PRODUÇÃO.</strong> O protótipo só lê, mas
            qualquer outra tela do app nesta aba escreve em prod. Não navegue para
            fora daqui.
          </span>
        </div>
      )}
      <header className="mb-6 max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Protótipo descartável · #1607
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Seletor de Conversa do Lead
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Dados reais da sua org. Digite um telefone de lead para ver as caixas com
          e sem conversa. A consulta aqui é client-side de propósito — a forma
          final é o #1610.
        </p>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefone do lead — ex.: 48999887766"
          className="mt-4 max-w-xs"
        />
      </header>

      <div className="flex min-h-[400px] items-start">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Digite um telefone acima. Sem telefone não há o que resolver.
          </p>
        )}
        {!isLoading && rows.length > 0 && (
          <>
            {variante === "1" && <VarianteLista rows={rows} />}
            {variante === "2" && <VarianteCards rows={rows} />}
            {variante === "3" && <VarianteComando rows={rows} />}
          </>
        )}
      </div>

      <nav className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 p-1 shadow-2xl backdrop-blur">
        {[
          ["1", "Lista densa"],
          ["2", "Cards"],
          ["3", "Comando"],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => {
              params.set("v", v);
              setParams(params, { replace: true });
            }}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm transition-colors",
              variante === v
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
