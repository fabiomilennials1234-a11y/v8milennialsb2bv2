/**
 * SubscriptionBlockedPage — o acesso da organização está interrompido.
 *
 * Os três status que chegam aqui (`suspended`, `cancelled`, `expired`) têm a
 * MESMA consequência prática: ninguém entra. O que muda é a causa, e causa se
 * conta com palavra, não com cor.
 *
 * Por isso `expired` deixou de usar âmbar (#1507): âmbar é `--warning`, o hue do
 * OverdueBanner, que é o estado em que o cliente AINDA TEM ACESSO. Vestir a
 * mesma cor num estado que ainda dá para evitar e noutro em que a pessoa já
 * está fora apaga a única diferença que importa para ela.
 *
 *   suspended / expired → `--destructive`: o acesso caiu por falta de pagamento.
 *   cancelled           → `--muted`: fim deliberado, não é erro de ninguém.
 *
 * Matiz marca, `--foreground` fala — `--destructive` como texto dá ~3,4:1 sobre
 * o creme do tema claro e reprova AA para corpo.
 */

import { ShieldOff, CreditCard, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubscriptionBlockedPageProps {
  status: "suspended" | "cancelled" | "expired";
  plan: string | null;
}

const STATUS_CONFIG = {
  suspended: {
    title: "Acesso suspenso por falta de pagamento",
    description:
      "O time não consegue entrar até a cobrança ser regularizada. Nada foi apagado: leads, conversas, funis e histórico continuam aqui e voltam assim que o pagamento entrar.",
    icon: ShieldOff,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  cancelled: {
    title: "Assinatura cancelada",
    description:
      "Esta organização foi encerrada e o acesso está desligado. Nada foi apagado — se quiser voltar, o time reativa a conta com os dados no lugar.",
    icon: CreditCard,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
  expired: {
    title: "Assinatura expirada",
    description:
      "O período contratado terminou e o acesso ficou pausado. Nada foi apagado: renove e o time volta exatamente de onde parou.",
    icon: CreditCard,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
};

export function SubscriptionBlockedPage({ status, plan }: SubscriptionBlockedPageProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  // O identificador interno do plano viaja na mensagem de suporte, onde é útil,
  // e NÃO na tela: `torque-v8` não diz nada para quem paga e é jargão de banco
  // na interface. Quem está bloqueado precisa da saída, não do nosso SKU.
  const whatsappUrl = `https://wa.me/5548991897070?text=${encodeURIComponent(
    `Olá, preciso de ajuda com minha assinatura (status: ${status}, plano: ${plan || "N/A"}).`
  )}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className={`inline-flex p-4 rounded-full ${config.bgColor}`}>
          <Icon className={`w-12 h-12 ${config.color}`} aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-balance">{config.title}</h1>
          {/* `text-foreground`, e não `text-muted-foreground`, por duas razões que
              apontam para o mesmo lado. Hierarquia: nesta página o parágrafo é o
              conteúdo, não apoio — não há mais nada para ele apoiar. Contraste:
              --muted-foreground sobre --background no tema claro dá 4,13:1 e
              reprova AA para corpo (4,5). Isso é dívida do token, não desta tela,
              e vale para o produto inteiro — está reportado à parte. */}
          <p className="text-foreground">{config.description}</p>
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="w-4 h-4 mr-2" aria-hidden="true" />
              Falar com o time
            </a>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Já paguei, verificar de novo
          </Button>
        </div>
      </div>
    </div>
  );
}
