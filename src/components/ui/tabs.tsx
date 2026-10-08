import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Três formas de aba, escolhidas na lista e herdadas pelos gatilhos:
 * - `underline` (padrão): sublinhado dourado — abas dentro de um cartão.
 * - `pill`: pílula escura com o ativo em ouro — navegação de PÁGINA (V5).
 * - `segmented`: alternador claro — filtros curtos dentro de um bloco.
 * A variante mora na lista para que nenhum gatilho precise repeti-la.
 */
type TabsVariant = "underline" | "pill" | "segmented";
const TabsVariantContext = React.createContext<TabsVariant>("underline");

const tabControlClassName = cn(
  "relative inline-flex items-center justify-center whitespace-nowrap pb-2.5 text-[13px] font-medium transition-colors",
  "text-muted-foreground hover:text-foreground/80",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-50",
);

const listClassName: Record<TabsVariant, string> = {
  underline: "inline-flex items-center gap-6 border-b border-border text-muted-foreground",
  pill: cn(
    "relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-tinta p-1 text-tinta-muted shadow-relevo-tinta scrollbar-hide",
    // Borda que esconde aba esmaece — sem isso o corte parece defeito, não rolagem.
    "data-[fade-end=true]:[mask-image:linear-gradient(to_right,black_calc(100%_-_36px),transparent)]",
    "data-[fade-start=true]:[mask-image:linear-gradient(to_left,black_calc(100%_-_36px),transparent)]",
    "data-[fade-start=true]:data-[fade-end=true]:[mask-image:linear-gradient(to_right,transparent,black_36px,black_calc(100%_-_36px),transparent)]",
  ),
  segmented: "inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px] text-muted-foreground",
};

const triggerClassName: Record<TabsVariant, string> = {
  underline: cn(
    tabControlClassName,
    "data-[state=active]:text-foreground data-[state=active]:font-semibold",
    "data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-[2px] data-[state=active]:after:bg-primary data-[state=active]:after:rounded-full",
  ),
  pill: cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-150",
    "text-tinta-muted hover:text-tinta-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    "disabled:pointer-events-none disabled:opacity-50",
    "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-brilho-ouro",
  ),
  segmented: cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
    "text-muted-foreground hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-relevo",
  ),
};

/** Action beside a tab list: same visual vocabulary, but not a selectable tab. */
const TabsAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(tabControlClassName, "min-h-11 gap-1.5", className)} {...props} />
  ),
);
TabsAction.displayName = "TabsAction";

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: TabsVariant;
}

/**
 * A pílula rola na horizontal quando as abas não cabem. Este efeito marca as
 * bordas que escondem aba (`data-fade-start`/`data-fade-end`, lidas pelo CSS) e
 * traz a aba ativa para dentro quando ela muda. Escreve no DOM direto: rolar
 * não deve re-renderizar a lista.
 */
function useOverflowAffordance(ref: React.RefObject<HTMLElement>, enabled: boolean) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.dataset.fadeStart = String(el.scrollLeft > 1);
      el.dataset.fadeEnd = String(el.scrollLeft < max - 1);
    };
    const revealActive = () => {
      const active = el.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active) return;
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      // Rola só o eixo da lista; scrollIntoView arrastaria a página junto.
      if (left < el.scrollLeft) el.scrollLeft = left - 24;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 24;
    };

    revealActive();
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    const mutation = new MutationObserver(() => {
      revealActive();
      update();
    });
    mutation.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });

    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation.disconnect();
    };
  }, [ref, enabled]);
}

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, variant = "underline", ...props }, forwardedRef) => {
    const innerRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List>>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as React.ElementRef<typeof TabsPrimitive.List>);
    useOverflowAffordance(innerRef, variant === "pill");

    return (
      <TabsVariantContext.Provider value={variant}>
        <TabsPrimitive.List
          ref={innerRef}
          data-variant={variant}
          className={cn(listClassName[variant], className)}
          {...props}
        />
      </TabsVariantContext.Provider>
    );
  },
);
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return <TabsPrimitive.Trigger ref={ref} className={cn(triggerClassName[variant], className)} {...props} />;
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsAction };
export type { TabsVariant };
