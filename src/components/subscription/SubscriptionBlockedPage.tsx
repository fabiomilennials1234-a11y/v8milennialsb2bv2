/**
 * SubscriptionBlockedPage — página de bloqueio para orgs com subscription
 * suspensa, cancelada ou expirada.
 */

import { ShieldOff, CreditCard, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubscriptionBlockedPageProps {
  status: "suspended" | "cancelled" | "expired";
  plan: string | null;
}

const STATUS_CONFIG = {
  suspended: {
    title: "Conta Suspensa",
    description: "Sua conta foi suspensa por falta de pagamento. Regularize para restaurar o acesso.",
    icon: ShieldOff,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  cancelled: {
    title: "Assinatura Cancelada",
    description: "Sua assinatura foi cancelada. Entre em contato para reativar.",
    icon: CreditCard,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
  expired: {
    title: "Assinatura Expirada",
    description: "Sua assinatura expirou. Renove para continuar usando a plataforma.",
    icon: CreditCard,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
};

export function SubscriptionBlockedPage({ status, plan }: SubscriptionBlockedPageProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const whatsappUrl = `https://wa.me/5511999999999?text=${encodeURIComponent(
    `Olá, preciso de ajuda com minha assinatura (status: ${status}, plano: ${plan || "N/A"}).`
  )}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className={`inline-flex p-4 rounded-full ${config.bgColor}`}>
          <Icon className={`w-12 h-12 ${config.color}`} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{config.title}</h1>
          <p className="text-muted-foreground">{config.description}</p>
        </div>

        {plan && (
          <p className="text-sm text-muted-foreground">
            Plano: <strong className="capitalize">{plan}</strong>
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Button asChild>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="w-4 h-4 mr-2" />
              Falar com Suporte
            </a>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tentar Novamente
          </Button>
        </div>
      </div>
    </div>
  );
}
