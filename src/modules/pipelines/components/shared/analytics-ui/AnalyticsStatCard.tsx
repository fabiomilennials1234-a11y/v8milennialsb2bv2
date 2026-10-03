import type { KeyboardEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { KpiTile, type Tone } from "@/components/ui/bento";
import { cn } from "@/lib/utils";

/**
 * Tom do número quando `tintValue` está ligado. Ouro vira o par legível do
 * ouro (`primary-soft-foreground`): ouro puro sobre o cartão branco reprova
 * contraste no claro.
 */
const ACCENT_VALUE: Record<string, string> = {
  gold: "text-primary-soft-foreground",
  success: "text-success",
  blue: "text-foreground",
  neutral: "text-foreground",
};

/** Tom do chip do ícone, derivado do accent (mockup: ícone tintado no cartão). */
const ACCENT_TONE: Record<string, Tone> = {
  gold: "gold",
  success: "good",
  blue: "info",
  neutral: "neutral",
};

interface AnalyticsStatCardProps {
  label: string;
  value: ReactNode;
  /** Contexto computável: "61% do total", "11 propostas"... */
  sub?: ReactNode;
  accent?: keyof typeof ACCENT_VALUE;
  /** Tinge o número com a cor do accent (default: número neutro). */
  tintValue?: boolean;
  onClick?: () => void;
  delay?: number;
  className?: string;
  /** Ícone no chip tintado do `KpiTile` (V5). */
  icon?: LucideIcon;
  /** Tom do chip quando o accent não diz (ex.: perda em vermelho). */
  tone?: Tone;
}

/**
 * Stat card dos analytics de funil — no V5 é o `KpiTile` do sistema (rótulo,
 * número grande tabular, nota). Mesma API de antes: os três painéis de
 * analytics (genérico, Qualificação, Confirmação, Propostas) não mudam de
 * dado, só de forma. A linha de accent no topo saiu: o tom agora mora no
 * número (`tintValue`), que é onde a leitura acontece.
 */
export function AnalyticsStatCard({
  label,
  value,
  sub,
  accent = "neutral",
  tintValue = false,
  onClick,
  delay = 0,
  className,
  icon,
  tone,
}: AnalyticsStatCardProps) {
  // O card clicável abre o drilldown — então ele tem de ser alcançável por
  // teclado também, não só pelo mouse.
  const onKeyDown = onClick
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }
    : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="min-w-0"
    >
      <KpiTile
        label={label}
        icon={icon}
        tone={tone ?? ACCENT_TONE[accent]}
        value={<span className={cn("whitespace-nowrap", tintValue && ACCENT_VALUE[accent])}>{value}</span>}
        note={sub}
        className={cn(
          "h-full",
          onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
    </motion.div>
  );
}
