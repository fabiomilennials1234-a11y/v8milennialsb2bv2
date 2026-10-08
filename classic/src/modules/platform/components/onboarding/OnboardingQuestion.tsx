import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Option {
  value: string;
  label: string;
  description?: string;
  icon?: React.ElementType;
}

interface OnboardingQuestionProps {
  title: string;
  subtitle?: string;
  type: "single" | "boolean";
  options?: Option[];
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
  disabled?: boolean;
}

export function OnboardingQuestion({ title, subtitle, type, options, value, onChange, disabled }: OnboardingQuestionProps) {
  if (type === "boolean") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className="flex gap-3">
          {[
            { val: true, label: "Sim" },
            { val: false, label: "Não" },
          ].map(({ val, label }) => (
            <button
              key={String(val)}
              onClick={() => !disabled && onChange(val)}
              disabled={disabled}
              className={cn(
                "flex-1 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all duration-150",
                value === val
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="grid gap-2">
        {options?.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-3 py-3 px-4 rounded-xl border-2 text-left transition-all duration-150",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border/50 hover:border-border",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {opt.icon && <opt.icon className={cn("w-5 h-5 flex-shrink-0", selected ? "text-primary" : "text-muted-foreground")} />}
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", selected ? "text-foreground" : "text-muted-foreground")}>{opt.label}</p>
                {opt.description && <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>}
              </div>
              {selected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
