/**
 * /checkout/:token: página pública do link de pagamento. Decide qual tela mostrar a partir do
 * link; o fluxo de comprador, cartão e confirmação mora em `CheckoutScreen`.
 *
 * O título nunca leva o nome da empresa nem o token, e a página não indexa.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { reportError, toAppError } from "@/shared/errors";
import { CheckoutScreen, CheckoutSkeleton } from "../components/checkout/CheckoutScreen";
import { CheckoutTerminal } from "../components/checkout/CheckoutTerminal";
import { recurrenceText, type TerminalId } from "../components/checkout/checkout-copy";
import { useCheckoutLink } from "../hooks/useCheckoutLink";
import type { CheckoutLink, LinkOutcome } from "../lib/checkout-api";
import { clearRedirectParams, readPaidMark, readRedirectSecret } from "../lib/checkout-paid-mark";
import { readPublishableKey, type PublishableKey } from "../lib/stripe-env";

const SKELETON_DELAY_MS = 150;

function useDocumentMeta() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Pagamento | Torque CRM";
    const restores = (
      [
        ["robots", "noindex,nofollow"],
        ["referrer", "no-referrer"],
        ["theme-color", "#000000"],
      ] as const
    ).map(([name, content]) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (existing) {
        const previous = existing.content;
        existing.content = content;
        return () => {
          existing.content = previous;
        };
      }
      const created = document.createElement("meta");
      created.name = name;
      created.content = content;
      document.head.appendChild(created);
      return () => created.remove();
    });
    return () => {
      document.title = previousTitle;
      restores.forEach((restore) => restore());
    };
  }, []);
}

function terminalFor(outcome: LinkOutcome, key: PublishableKey): TerminalId | null {
  if (outcome.kind === "valid") return terminalForLink(outcome.link, key);
  return outcome.kind;
}

/** Sem recorrência clara, sem valor ou sem chave não se pede dado nenhum. */
function terminalForLink(link: CheckoutLink, key: PublishableKey): TerminalId | null {
  if (link.target_kind === "new_org") return "not_supported";
  if (!key.ok || !(link.amount_cents > 0) || !recurrenceText(link.plan?.billing_cycle)) return "unavailable";
  return null;
}

export default function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  useDocumentMeta();

  const [key] = useState(readPublishableKey);
  const [redirectSecret] = useState(() => readRedirectSecret(window.location.search));
  useLayoutEffect(clearRedirectParams, []);

  const link = useCheckoutLink(token);

  // Chave fora do build: a tela só diz "indisponível", então é o relatório que avisa quem pode agir.
  const validLink = link.data?.kind === "valid";
  useEffect(() => {
    if (validLink && !key.ok) {
      reportError(toAppError(new Error("checkout_publishable_key_invalid"), "Pagamento indisponível."), { feature: "checkout" });
    }
  }, [validLink, key.ok]);

  const [paidMark, setPaidMark] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (token ? readPaidMark(token) : Promise.resolve(false)).then((marked) => {
      if (alive) setPaidMark(marked);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  if (!link.data || paidMark === null || link.isFetching) {
    return showSkeleton ? <CheckoutSkeleton /> : <div className="min-h-dvh bg-background" />;
  }

  const terminal = terminalFor(link.data, key);
  if (terminal || link.data.kind !== "valid" || !key.ok || !token) {
    return (
      <CheckoutTerminal
        id={terminal ?? "unavailable"}
        displayName={link.data.kind === "valid" ? link.data.link.display_name : null}
        onRetry={() => void link.refetch()}
      />
    );
  }

  return (
    <CheckoutScreen
      token={token}
      link={link.data.link}
      publishableKey={key}
      initialPaid={paidMark}
      redirectSecret={redirectSecret}
      onRetry={() => void link.refetch()}
    />
  );
}
