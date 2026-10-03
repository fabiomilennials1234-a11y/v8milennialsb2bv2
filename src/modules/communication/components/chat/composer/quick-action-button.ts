import { cn } from "@/lib/utils";

/** O botão da régua — exportado para as ferramentas extras terem a mesma forma. */
export const QUICK_ACTION_BUTTON = cn(
  "inline-flex items-center justify-center rounded-xl",
  "min-w-[44px] min-h-[44px]",
  "text-muted-foreground transition-colors",
  "hover:text-foreground hover:bg-foreground/[.06]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
  "disabled:opacity-40 disabled:pointer-events-none",
);
