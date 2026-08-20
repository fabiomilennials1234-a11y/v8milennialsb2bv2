/**
 * NotificameOperacaoCard — o que se opera num número oficial, fora da conversa.
 *
 * Três coisas que não têm lugar no chat:
 *
 *   SAÚDE DO NÚMERO — verde, amarelo ou vermelho, do lado da Meta. É o feedback
 *   dos clientes que a determina: bloqueios e denúncias derrubam a nota, e
 *   vermelho é o degrau antes de a Meta limitar o envio. Fica aqui porque é onde
 *   já se olha para saber se o canal está de pé.
 *
 *   BLOQUEADOS — a lista. Bloquear se faz na conversa, que é onde a vontade
 *   aparece; desbloquear se faz aqui, que é onde se procura quem foi bloqueado.
 *
 *   CONVITE DE OPT-IN — o deep link em que o cliente ACEITA receber mensagens. O
 *   aceite fica registrado do lado da Meta: é consentimento formal, e a defesa
 *   mais direta contra os vetores de ban.
 *
 * ⚠️ O formato das respostas do fornecedor NÃO foi medido contra conta viva — a
 * doc mostra a requisição e uma imagem da resposta. Os leitores são tolerantes
 * (`lib/notificame-operacao.ts`) e dizem "não sei" em vez de inventar.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Copy, Loader2, RefreshCw, ShieldOff, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  createSignupInvite,
  listBlocked,
  numberHealth,
  unblockUser,
} from "@/modules/communication/lib/whatsappApi";
import {
  lerBloqueados,
  lerSaudeDoNumero,
  type NivelDeSaude,
} from "@/modules/communication/lib/notificame-operacao";

const CORES: Record<NivelDeSaude, { rotulo: string; classe: string }> = {
  verde: { rotulo: "Qualidade alta", classe: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  amarelo: { rotulo: "Qualidade média", classe: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  vermelho: { rotulo: "Qualidade baixa", classe: "bg-destructive/15 text-destructive border-destructive/30" },
};

export function NotificameOperacaoCard({ instanceId }: { instanceId: string }) {
  const queryClient = useQueryClient();
  const [convite, setConvite] = useState({
    nome: "",
    mensagem: "",
    confirmacao: "",
    politicaDePrivacidade: "",
    site: "",
  });
  const [linkGerado, setLinkGerado] = useState<string | null>(null);

  const saude = useQuery({
    queryKey: ["notificame-saude", instanceId],
    queryFn: () => numberHealth(instanceId),
    // A nota muda em dias, não em segundos. Buscar a cada foco da janela seria
    // uma chamada ao fornecedor por troca de aba.
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const bloqueados = useQuery({
    queryKey: ["notificame-bloqueados", instanceId],
    queryFn: () => listBlocked(instanceId),
    staleTime: 60 * 1000,
    retry: false,
  });

  const desbloquear = useMutation({
    mutationFn: (numero: string) => unblockUser(instanceId, numero),
    onSuccess: () => {
      toast.success("Contato desbloqueado");
      queryClient.invalidateQueries({ queryKey: ["notificame-bloqueados", instanceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criarConvite = useMutation({
    mutationFn: () => createSignupInvite(instanceId, convite),
    onSuccess: (r) => {
      // O id vem no corpo do fornecedor, cujo formato não foi medido. Se não
      // reconhecermos, dizemos isso — em vez de mostrar um link quebrado.
      const id =
        (r as { id?: string; data?: { id?: string } } | null)?.id ??
        (r as { data?: { id?: string } } | null)?.data?.id ??
        null;
      if (!id) {
        toast.success("Convite criado — o link aparece na lista do fornecedor");
        return;
      }
      setLinkGerado(String(id));
      toast.success("Convite criado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Canal que não é oficial não tem nada disso — o card some inteiro em vez de
  // mostrar três seções com erro.
  const naoSuportado = (saude.error as { code?: string } | null)?.code;
  if (naoSuportado === "health_not_supported" || naoSuportado === "channel_not_notificame") {
    return null;
  }

  const nivel = lerSaudeDoNumero(saude.data);
  const lista = lerBloqueados(bloqueados.data);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              Operação do número
            </CardTitle>
            <CardDescription>
              Saúde, contatos bloqueados e o link de consentimento.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              saude.refetch();
              bloqueados.refetch();
            }}
            disabled={saude.isFetching || bloqueados.isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", saude.isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Saúde ─────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Saúde do número</Label>
          {saude.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : nivel ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("font-medium", CORES[nivel.nivel].classe)}>
                {CORES[nivel.nivel].rotulo}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                Bloqueios e denúncias de clientes derrubam esta nota.
              </span>
            </div>
          ) : (
            // ⚠️ Nunca um verde por omissão: dizer "está tudo bem" sem saber é a
            // mentira mais cara que este card poderia contar.
            <p className="text-xs text-muted-foreground">
              A Meta não informou a qualidade deste número agora.
            </p>
          )}
        </div>

        {/* ── Bloqueados ────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Contatos bloqueados</Label>
          {bloqueados.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : lista.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum contato bloqueado.</p>
          ) : (
            <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
              {lista.map((numero) => (
                <li key={numero} className="flex items-center justify-between px-3 py-1.5">
                  <span className="font-mono text-xs">{numero}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => desbloquear.mutate(numero)}
                    disabled={desbloquear.isPending}
                  >
                    <ShieldOff className="h-3.5 w-3.5" />
                    Desbloquear
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Convite de opt-in ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="space-y-0.5">
            <Label className="text-xs text-muted-foreground">Link de consentimento</Label>
            <p className="text-[11px] text-muted-foreground">
              Quem abrir o link aceita receber suas mensagens, e o aceite fica
              registrado na Meta.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={convite.nome}
              onChange={(e) => setConvite({ ...convite, nome: e.target.value })}
              placeholder="Nome interno (ex.: Ofertas)"
              className="h-8 text-xs"
            />
            <Input
              value={convite.site}
              onChange={(e) => setConvite({ ...convite, site: e.target.value })}
              placeholder="https://suaempresa.com.br"
              className="h-8 text-xs"
            />
            <Input
              value={convite.politicaDePrivacidade}
              onChange={(e) => setConvite({ ...convite, politicaDePrivacidade: e.target.value })}
              placeholder="https://suaempresa.com.br/privacidade"
              className="h-8 text-xs sm:col-span-2"
            />
            <Input
              value={convite.mensagem}
              onChange={(e) => setConvite({ ...convite, mensagem: e.target.value })}
              placeholder="O que a pessoa lê antes de aceitar"
              className="h-8 text-xs sm:col-span-2"
            />
            <Input
              value={convite.confirmacao}
              onChange={(e) => setConvite({ ...convite, confirmacao: e.target.value })}
              placeholder="O que ela recebe depois de aceitar"
              className="h-8 text-xs sm:col-span-2"
            />
          </div>

          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => criarConvite.mutate()}
            disabled={
              criarConvite.isPending ||
              !convite.nome.trim() ||
              !convite.mensagem.trim() ||
              !convite.confirmacao.trim() ||
              !convite.site.trim() ||
              !convite.politicaDePrivacidade.trim()
            }
          >
            {criarConvite.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <UserPlus className="h-3.5 w-3.5" />}
            Criar convite
          </Button>

          {linkGerado && (
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-[11px]">
                wa.me/&lt;seu número&gt;/signup/{linkGerado}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(linkGerado);
                  toast.success("Identificador copiado");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
