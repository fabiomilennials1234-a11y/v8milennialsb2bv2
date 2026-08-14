/**
 * InstagramChannelSettings — a porta de conexão do Instagram pelo NotificaMe.
 *
 * O QUE ESTA FATIA ENTREGA, E SÓ: o ATO DE CONECTAR. O canal fica vinculado à
 * org em `messaging_channels` e nada mais acontece — não há envio, não há caixa
 * de entrada, não há link para lugar nenhum. É deliberado, e o texto do card diz
 * isso em voz alta: prometer inbox aqui seria vender uma porta que ainda não
 * existe. A entrada de mensagens depende de um payload que o fornecedor não
 * documenta e que precisa ser capturado contra um canal real primeiro.
 *
 * NENHUMA PALAVRA "WHATSAPP" NESTE ARQUIVO, e nenhum "número". Este é o erro de
 * rótulo que a fatia 1 evitou ao criar um perfil próprio para o NotificaMe, e o
 * mesmo cuidado vale aqui: um perfil de Instagram não é um número, o fluxo por
 * baixo é que é compartilhado.
 *
 * "(oficial)" no título é temporário e tem uma razão exata: o card do caminho
 * antigo — Instagram pela Graph API, em `MetaSettings` — ainda existe no mesmo
 * catálogo por uma fatia, porque é ele quem tem inbox hoje. Dois cards com o
 * mesmo nome seriam armadilha. Quando o caminho antigo sair, o sufixo sai junto.
 *
 * FLAG PRÓPRIA (`notificame_instagram`), separada da do WhatsApp Oficial: ligar
 * o canal oficial de WhatsApp numa org NÃO liga o Instagram dela. Fail-closed —
 * enquanto a flag carrega, o card não renderiza. O gate que VALE é o do
 * servidor, que recusa `channel_type:"instagram"` com `instagram_not_enabled`;
 * este aqui só evita mostrar uma porta que bateria na cara de quem a abrisse.
 */
import { Instagram, Loader2, Plug, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConnectNotificame, useMessagingChannels } from "@/modules/communication";
import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";
import { useIdentity } from "@/modules/identity";

export function InstagramChannelSettings() {
  const flag = useFeatureFlag("notificame_instagram");
  // ADMIN OU MASTER — o MESMO gate do servidor, não a feature permission
  // `whatsapp.manage_instances` (que nasce liberada para todo membro ativo).
  // A razão é o que viaja na URL do popup: o `company_uuid` é o TOKEN da
  // subconta da org, e ele NÃO é rotacionável. Entregá-lo ao browser errado é
  // irreversível. Espelhar o gate do servidor aqui evita sondar — e mostrar
  // botão — para quem levaria 403 no clique.
  const { isAdmin } = useIdentity();
  const canManage = isAdmin;

  const {
    connectNotificame,
    isConnecting,
    isConfigured,
    // `configReasonFor`, NUNCA `configReason`. A sonda é uma só para os dois
    // canais e as frases dela vêm do servidor, que as escreveu nomeando o
    // WhatsApp Oficial: renderizar `configReason` aqui punha aquela palavra
    // dentro deste card — o arquivo jurava não dizê-la e a dizia por variável.
    // O argumento é EXPLÍCITO, como no `connectNotificame`: o default do hook é
    // WhatsApp, e acertar por omissão é o mesmo erro de novo.
    configReasonFor,
    isConfigLoading,
    isProvisioning,
  } = useConnectNotificame({ enabled: flag.enabled && canManage });

  // A tabela só existe depois da migration desta fatia. A query fica fora do ar
  // enquanto a flag estiver desligada — que é exatamente o período em que a
  // tabela pode não existir no ambiente.
  const { data: channels = [] } = useMessagingChannels({ enabled: flag.enabled });

  // Fail-closed: flag carregando ou desligada ⇒ o card não existe.
  if (!flag.enabled) return null;

  const instagramChannels = channels.filter((c) => c.channel_type === "instagram");

  // Uma espera de cada vez, cada uma com a sua frase. Empilhar tudo num
  // "carregando..." é o que faz o usuário clicar de novo achando que travou.
  const blockedReason = isConfigLoading
    ? "Verificando disponibilidade…"
    : !isConfigured
      ? configReasonFor("instagram")
      : isProvisioning
        ? "Preparando sua conta oficial…"
        : null;

  return (
    <div className="space-y-5">
      {/* Cabeçalho — o que é, e o que ainda não é */}
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#F77737] via-[#E1306C] to-[#833AB4]">
          <Instagram className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Instagram (oficial)</h3>
            {instagramChannels.length > 0 && (
              <Badge
                variant="outline"
                className="border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Conectado
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Conecte a conta profissional do Instagram. Mensagens diretas com
            verificação da Meta.
          </p>
        </div>
      </div>

      {/* Contas já conectadas */}
      {instagramChannels.length > 0 && (
        <div className="space-y-2">
          {instagramChannels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {channel.handle ? `@${channel.handle}` : channel.display_name}
                </p>
                {channel.handle && (
                  <p className="truncate text-xs text-muted-foreground">
                    {channel.display_name}
                  </p>
                )}
              </div>
              <Badge
                variant={channel.status === "connected" ? "secondary" : "destructive"}
                className="shrink-0 text-[11px] font-normal"
              >
                {channel.status === "connected"
                  ? "Ativo"
                  : channel.status === "disconnected"
                    ? "Desconectado"
                    : "Com erro"}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* Ação */}
      <div className="space-y-2">
        <Button
          // SEM `await`, SEM handler async: o `window.open` do fluxo precisa
          // rodar dentro do gesto do clique, ou Safari e Firefox bloqueiam a
          // janela. O argumento é EXPLÍCITO — nunca acertar por default.
          onClick={() => connectNotificame("instagram")}
          disabled={!!blockedReason || isConnecting || !canManage}
          className="w-full sm:w-auto"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Conectando…
            </>
          ) : (
            <>
              <Plug className="mr-2 h-4 w-4" />
              Conectar Instagram
            </>
          )}
        </Button>

        {/* O motivo vem ANTES do clique, não depois por toast. */}
        {blockedReason && !isConnecting && (
          <p className="text-xs text-muted-foreground">{blockedReason}</p>
        )}
        {!canManage && !blockedReason && (
          <p className="text-xs text-muted-foreground">
            Apenas administradores podem conectar contas nesta organização.
          </p>
        )}

        {/* Honestidade sobre o escopo desta entrega. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          A conexão vincula o perfil à sua organização. O recebimento de mensagens
          no Torque entra em uma próxima etapa.
        </p>
      </div>
    </div>
  );
}

export default InstagramChannelSettings;
