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
    "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-tinta p-1 text-tinta-muted shadow-relevo-tinta scrollbar-hide",
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

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, variant = "underline", ...props }, ref) => (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        ref={ref}
        data-variant={variant}
        className={cn(listClassName[variant], className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  ),
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
