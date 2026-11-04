import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/torque-logo.png";
import { CHECKOUT_OUTLINE_CLASS } from "./checkout-classes";
import { terminalCopy, type TerminalId } from "./checkout-copy";

const RETRY_DELAY_MS = 60_000;

export function CheckoutTerminal({
  id,
  displayName,
  onRetry,
}: {
  id: TerminalId;
  displayName: string | null;
  onRetry: () => void;
}) {
  const copy = terminalCopy(id, displayName);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [retryOpen, setRetryOpen] = useState(copy.action !== "retry_delayed");

  useEffect(() => {
    titleRef.current?.focus();
  }, [id]);

  useEffect(() => {
    if (copy.action !== "retry_delayed") return;
    setRetryOpen(false);
    const timer = window.setTimeout(() => setRetryOpen(true), RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [copy.action, id]);

  return (
    <div className="min-h-dvh bg-background text-foreground sentry-block">
      <div className="mx-auto max-w-[32rem] px-5 pt-[clamp(3rem,14vh,8rem)] pb-16">
        <img src={logo} alt="Torque CRM" className="h-7 w-auto" />
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="mt-12 text-[1.375rem] lg:text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.035em] outline-none"
        >
          {copy.title}
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-muted-foreground">{copy.body}</p>
        {copy.action === "enter" && (
          <Button variant="outline" size="lg" className={`mt-6 ${CHECKOUT_OUTLINE_CLASS}`} asChild>
            {/* Navegação de verdade: o tema travado desta rota é decidido no boot do App. */}
            <a href="/auth">{copy.actionLabel}</a>
          </Button>
        )}
        {(copy.action === "retry" || copy.action === "retry_delayed") && (
          <Button
            variant="outline"
            size="lg"
            className={`mt-6 ${CHECKOUT_OUTLINE_CLASS}`}
            disabled={!retryOpen}
            onClick={onRetry}
          >
            {copy.actionLabel}
          </Button>
        )}
        {copy.action === "reload" && (
          <Button
            variant="outline"
            size="lg"
            className={`mt-6 ${CHECKOUT_OUTLINE_CLASS}`}
            onClick={() => window.location.reload()}
          >
            {copy.actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
