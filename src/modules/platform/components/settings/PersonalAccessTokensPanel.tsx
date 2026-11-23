/**
 * PersonalAccessTokensPanel — tokens pessoais para conectar uma IA ao CRM por MCP
 * (crm-mcp, ADR 0012). Mora em Configurações › API & Webhooks, atrás da flag `crm_mcp`.
 *
 * Mesma gramática do painel de chaves de API: fila em tinta à esquerda, o token em foco no
 * ouro à direita, e o texto do token aparecendo uma única vez, no diálogo de criação.
 */

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Ban, Check, Copy, Loader2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { FocusCard, FocusTile, InkPanel, InkRow, InkSplit } from "@/components/ui/bento";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth, useIdentity } from "@/modules/identity";
import {
  type CreatedPersonalAccessToken,
  type PersonalAccessToken,
  useCreatePersonalAccessToken,
  usePersonalAccessTokens,
  useRevokePersonalAccessToken,
} from "@/modules/platform/hooks/usePersonalAccessTokens";
import {
  connectionSnippet,
  daysLeft,
  MCP_CLIENTS,
  type McpClient,
  mcpEndpoint,
  revokeReasonLabel,
  tokenState,
  VALIDITY_OPTIONS,
} from "@/modules/platform/lib/mcp-connect";
import { botaoNoOuroSecundario } from "./settings-classes";

const ENDPOINT = mcpEndpoint(import.meta.env.VITE_SUPABASE_URL ?? "");

function useCopiar() {
  const [copiado, setCopiado] = useState<string | null>(null);
  const copiar = async (chave: string, texto: string) => {
    await navigator.clipboard.writeText(texto);
    setCopiado(chave);
    window.setTimeout(() => setCopiado((atual) => (atual === chave ? null : atual)), 2000);
  };
  return { copiado, copiar };
}

export function PersonalAccessTokensPanel() {
  const { data: tokens = [], isLoading } = usePersonalAccessTokens();
  const { user } = useAuth();
  const { isAdmin } = useIdentity();
  const criar = useCreatePersonalAccessToken();
  const revogar = useRevokePersonalAccessToken();
  const { copiado, copiar } = useCopiar();

  const [criarAberto, setCriarAberto] = useState(false);
  const [novo, setNovo] = useState<CreatedPersonalAccessToken | null>(null);
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("90");
  const [cliente, setCliente] = useState<McpClient>("claude-code");
  const [focoId, setFocoId] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<PersonalAccessToken | null>(null);
  const [vazou, setVazou] = useState(false);

  // No máximo 200 linhas (o hook limita): particionar a cada render custa nada e mantém
  // "expirou agora" honesto sem memo preso a um relógio velho.
  const agora = Date.now();
  const ativos = tokens.filter((t) => tokenState(t, agora) === "active");
  const inativos = tokens.filter((t) => tokenState(t, agora) !== "active");
  const foco = ativos.find((t) => t.id === focoId) ?? ativos[0] ?? null;

  const desde = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  const dono = (t: PersonalAccessToken) => (t.user_id === user?.id ? "você" : t.owner_name ?? "membro da equipe");

  const fecharCriar = (aberto: boolean) => {
    if (!aberto) {
      setNome("");
      setValidade("90");
      setNovo(null);
      setCliente("claude-code");
    }
    setCriarAberto(aberto);
  };

  const handleCriar = async () => {
    if (!nome.trim()) return;
    try {
      setNovo(await criar.mutateAsync({ name: nome.trim(), expires_in_days: Number(validade) }));
    } catch {
      // toast no hook
    }
  };

  const handleRevogar = async () => {
    if (!alvo) return;
    try {
      await revogar.mutateAsync({ id: alvo.id, suspeitaDeVazamento: vazou });
    } finally {
      setAlvo(null);
      setVazou(false);
    }
  };

  const botaoNovo = (
    <Button size="sm" onClick={() => setCriarAberto(true)}>
      <Plus />
      Novo token
    </Button>
  );

  return (
    <div className="space-y-4">
      {isLoading ? (
        <InkPanel title="IA conectada (MCP)">
          <div className="space-y-2" aria-busy>
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-2xl bg-white/[.06]" />
            ))}
          </div>
        </InkPanel>
      ) : !foco ? (
        <InkPanel title="IA conectada (MCP)" count="0 ativos" actions={botaoNovo}>
          <div className="grid gap-6 px-1.5 pb-2 pt-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <div>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[.07] text-primary">
                <Sparkles className="h-6 w-6" aria-hidden />
              </span>
              <p className="mt-4 text-[1.35rem] font-extrabold leading-tight tracking-[-0.02em]">
                Pergunte ao seu CRM pela sua IA
              </p>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-tinta-muted">
                Conecte o Claude, o Cursor ou outro cliente MCP e consulte leads, funis e conversas em linguagem
                natural. O token é seu: a IA enxerga exatamente o que você enxerga no Torque.
              </p>
              <Button variant="outline" className="mt-5 text-foreground" onClick={() => setCriarAberto(true)}>
                <Plus />
                Gerar meu token
              </Button>
            </div>
            <ul className="space-y-2.5 text-[12.5px]">
              {[
                ["Só leitura", "A IA consulta. Nada é criado, movido ou enviado por ela."],
                ["Sua visibilidade", "Mesmas regras de acesso do seu usuário, na sua organização."],
                ["Sob seu controle", "Validade de até 1 ano, revogação na hora e registro de uso."],
              ].map(([titulo, texto]) => (
                <li key={titulo} className="flex gap-3 rounded-2xl border border-white/[.08] bg-white/[.04] p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span>
                    <span className="block font-bold text-tinta-foreground">{titulo}</span>
                    <span className="text-tinta-muted">{texto}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </InkPanel>
      ) : (
        <InkSplit
          title="IA conectada (MCP)"
          count={`${ativos.length} ${ativos.length === 1 ? "ativo" : "ativos"}`}
          actions={botaoNovo}
          listClassName="lg:max-h-[520px] lg:overflow-y-auto"
          list={
            <>
              {ativos.map((t) => {
                const selecionado = t.id === foco.id;
                return (
                  <InkRow key={t.id} selected={selecionado} onClick={() => setFocoId(t.id)}>
                    <span
                      className={cn(
                        "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
                        selecionado ? "bg-primary-foreground text-primary" : "bg-white/[.07] text-primary",
                      )}
                    >
                      <Sparkles className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold">{t.name}</span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[11px]",
                          selecionado ? "text-primary-foreground/70" : "text-tinta-muted",
                        )}
                      >
                        <span className="font-mono">{t.token_prefix}••••</span> · {dono(t)}
                      </span>
                    </span>
                    {t.last_used_at ? (
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-semibold",
                          selecionado ? "text-primary-foreground/75" : "text-tinta-muted",
                        )}
                      >
                        {desde(t.last_used_at)}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                          selecionado ? "bg-tinta text-tinta-foreground" : "bg-primary-soft text-primary-soft-foreground",
                        )}
                      >
                        sem uso
                      </span>
                    )}
                  </InkRow>
                );
              })}
              {inativos.length > 0 && (
                <div className="mt-3 border-t border-white/[.08] px-3 pt-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-[.06em] text-tinta-muted">
                    Encerrados ({inativos.length})
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {inativos.slice(0, 5).map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-[12px] text-tinta-muted">
                        <span className="truncate line-through">{t.name}</span>
                        <span className="ml-auto shrink-0 text-[10.5px]">
                          {t.revoked_at ? revokeReasonLabel(t.revoked_reason) : "expirado"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          }
          detail={
            <FocusCard className="gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-primary-foreground/70">
                  {foco.user_id === user?.id ? "Seu token" : `Token de ${dono(foco)}`}
                </p>
                <h3 className="mt-1 truncate text-[1.55rem] font-extrabold leading-[1.12] tracking-[-0.03em] max-sm:text-[1.3rem]">
                  {foco.name}
                </h3>
                <p className="mt-1 truncate font-mono text-[12.5px] font-semibold text-primary-foreground/80">
                  {foco.token_prefix}••••••••••••••••••••••
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <FocusTile>
                  <p className="text-[1rem] font-extrabold tabular-nums tracking-[-0.02em]">
                    {format(new Date(foco.created_at), "dd/MM/yyyy")}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-primary-foreground/65">Criado em</p>
                </FocusTile>
                <FocusTile>
                  <p className="truncate text-[1rem] font-extrabold tracking-[-0.02em]">
                    {foco.last_used_at ? desde(foco.last_used_at) : "Nunca"}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-primary-foreground/65">Último uso</p>
                </FocusTile>
                <FocusTile className="col-span-2 lg:col-span-1">
                  <p className="text-[1rem] font-extrabold tabular-nums tracking-[-0.02em]">
                    {format(new Date(foco.expires_at), "dd/MM/yyyy")}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-primary-foreground/65">
                    Expira em {daysLeft(foco.expires_at, agora)} {daysLeft(foco.expires_at, agora) === 1 ? "dia" : "dias"}
                  </p>
                </FocusTile>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-bold text-primary-foreground/65">Endereço do servidor MCP</p>
                <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-primary-foreground/[.07] p-2 pl-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold">{ENDPOINT}</code>
                  <button
                    type="button"
                    onClick={() => copiar("endpoint", ENDPOINT)}
                    className={botaoNoOuroSecundario}
                    aria-label="Copiar endereço do servidor"
                  >
                    {copiado === "endpoint" ? <Check /> : <Copy />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-primary-foreground/65">
                  Somente leitura · até 120 chamadas por minuto por token
                </p>
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setAlvo(foco)} className={botaoNoOuroSecundario}>
                  <Ban />
                  Revogar
                </button>
              </div>
            </FocusCard>
          }
        />
      )}

      {/* Criar */}
      <Dialog open={criarAberto} onOpenChange={fecharCriar}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {novo ? "Token criado" : "Novo token de IA"}
            </DialogTitle>
            {!novo && (
              <DialogDescription>
                A IA vai consultar o CRM como você: os mesmos leads, funis e conversas que você vê. Só leitura.
              </DialogDescription>
            )}
          </DialogHeader>

          {novo ? (
            // min-w-0 na cadeia inteira: o DialogContent é grid, e um <pre> longo (o comando
            // de uma linha) alargava a coluna e empurrava abas e botões para fora do diálogo.
            <div className="min-w-0 space-y-4 py-1">
              <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/15 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-strong" />
                <div>
                  <p className="text-sm font-medium">Copie agora</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    O token não aparece de novo. Quem tiver este texto consulta o CRM como você — guarde como uma senha.
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xl bg-muted p-3 font-mono text-sm">{novo.token}</code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copiar("token", novo.token)}
                  aria-label="Copiar token"
                >
                  {copiado === "token" ? <Check className="h-4 w-4 text-success-strong" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium">Conectar</p>
                <Tabs value={cliente} onValueChange={(v) => setCliente(v as McpClient)} className="min-w-0">
                  <TabsList className="grid h-auto w-full grid-cols-3">
                    {MCP_CLIENTS.map((c) => (
                      <TabsTrigger key={c.id} value={c.id} className="min-w-0 truncate">
                        {c.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {MCP_CLIENTS.map((c) => {
                    const trecho = connectionSnippet(c.id, ENDPOINT, novo.token);
                    return (
                      <TabsContent key={c.id} value={c.id} className="mt-3 min-w-0 space-y-2">
                        <p className="text-xs text-muted-foreground">{c.hint}</p>
                        <div className="relative min-w-0">
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 pr-12 font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere]">
                            {trecho}
                          </pre>
                          <Button
                            variant="outline"
                            size="icon"
                            className="absolute right-2 top-2 h-8 w-8"
                            onClick={() => copiar(`trecho-${c.id}`, trecho)}
                            aria-label={`Copiar configuração para ${c.label}`}
                          >
                            {copiado === `trecho-${c.id}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>

              <DialogFooter>
                <Button onClick={() => fecharCriar(false)}>Pronto</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="grid gap-2">
                <Label htmlFor="pat-nome">Nome</Label>
                <Input
                  id="pat-nome"
                  value={nome}
                  maxLength={80}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Claude do notebook"
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pat-validade">Validade</Label>
                <Select value={validade} onValueChange={setValidade}>
                  <SelectTrigger id="pat-validade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALIDITY_OPTIONS.map((o) => (
                      <SelectItem key={o.days} value={String(o.days)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Sem uso por 90 dias, o token é revogado sozinho.</p>
              </div>

              {isAdmin && (
                <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
                  <p className="text-xs text-muted-foreground">
                    Como administrador você vê praticamente toda a organização — e a IA conectada com este token
                    também verá.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => fecharCriar(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCriar} disabled={!nome.trim() || criar.isPending}>
                  {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar token
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revogar */}
      <AlertDialog
        open={!!alvo}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setAlvo(null);
            setVazou(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar “{alvo?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA conectada com este token perde o acesso na próxima chamada. Não dá para desfazer — se precisar,
              crie outro token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl p-2 text-sm hover:bg-muted/50">
            <Checkbox checked={vazou} onCheckedChange={(v) => setVazou(v === true)} />
            Acho que o token vazou
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevogar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
