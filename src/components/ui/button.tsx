import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-150 active:scale-[.98] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-brilho-ouro hover:bg-primary/90 hover:-translate-y-px",
        // Branco sobre o vermelho de preenchimento dava 3,8:1 no claro. No
        // claro o fundo é o par forte (~6,5:1); no escuro o `--destructive` já
        // é mais fechado e passa.
        destructive:
          "bg-destructive-strong text-destructive-foreground shadow-sm hover:bg-destructive-strong/90 dark:bg-destructive dark:hover:bg-destructive/90",
        outline:
          "border border-input bg-card shadow-relevo hover:border-foreground/20 hover:bg-card hover:-translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // V5: pílula escura — ação secundária forte ("Ver agenda", "Abrir chat")
        ink: "bg-tinta text-tinta-foreground hover:bg-tinta-3 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90",
        // V5: a ação do cartão de ouro (FocusCard) — branca, texto na tinta do ouro
        "on-gold": "bg-primary-cta text-primary-foreground hover:bg-primary-cta/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-7",
        // ícone é quadrado arredondado, não pílula — é o vocabulário do V5
        icon: "h-10 w-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
