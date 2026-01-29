import { useState } from "react";
import { useTheme } from "next-themes";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import { motion } from "framer-motion";
import { Sun, Moon, Monitor, Palette, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

const themes: Array<{ value: Theme; label: string; icon: typeof Sun; description: string }> = [
  { value: "light", label: "Claro", icon: Sun, description: "Tema claro padrão" },
  { value: "dark", label: "Escuro", icon: Moon, description: "Tema escuro para ambientes com pouca luz" },
  { value: "system", label: "Sistema", icon: Monitor, description: "Segue as configurações do sistema" },
];

const accentColors = [
  { name: "Amarelo (Padrão)", value: "48 92% 53%", preview: "#F5C518" },
  { name: "Azul", value: "217 91% 60%", preview: "#3B82F6" },
  { name: "Verde", value: "142 70% 45%", preview: "#22C55E" },
  { name: "Roxo", value: "262 83% 58%", preview: "#8B5CF6" },
  { name: "Rosa", value: "330 81% 60%", preview: "#EC4899" },
  { name: "Laranja", value: "25 95% 53%", preview: "#F97316" },
];

export function ThemeSettings() {
  const { theme, setTheme: setThemeNext } = useTheme();
  const transition = useThemeTransition();
  const [accentColor, setAccentColor] = useState(accentColors[0].value);
  const [animations, setAnimations] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const handleThemeChange = (newTheme: Theme) => {
    if (transition) transition.requestThemeChange(newTheme);
    else setThemeNext(newTheme);
  };

  const displayTheme = (theme ?? "system") as Theme;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium">Aparência</h3>
        <p className="text-sm text-muted-foreground">
          Personalize a aparência do sistema
        </p>
      </div>

      {/* Theme Selection */}
      <div className="space-y-4">
        <Label>Tema</Label>
        <div className="grid grid-cols-3 gap-4">
          {themes.map((t) => {
            const Icon = t.icon;
            const isSelected = displayTheme === t.value;
            
            return (
              <motion.button
                key={t.value}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleThemeChange(t.value)}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all",
                  isSelected 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50"
                )}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <Check className="w-4 h-4 text-primary" />
                  </div>
                )}
                <Icon className={cn(
                  "w-6 h-6 mb-2",
                  isSelected ? "text-primary" : "text-muted-foreground"
                )} />
                <p className="font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Accent Color */}
      <div className="space-y-4">
        <Label className="flex items-center gap-2">
          <Palette className="w-4 h-4" />
          Cor de Destaque
        </Label>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {accentColors.map((color) => {
            const isSelected = accentColor === color.value;
            
            return (
              <motion.button
                key={color.value}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setAccentColor(color.value)}
                className={cn(
                  "relative p-3 rounded-xl border-2 transition-all",
                  isSelected 
                    ? "border-foreground" 
                    : "border-border hover:border-foreground/50"
                )}
              >
                <div 
                  className="w-8 h-8 rounded-full mx-auto mb-2 shadow-inner"
                  style={{ backgroundColor: color.preview }}
                />
                <p className="text-xs text-center font-medium truncate">{color.name}</p>
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-foreground text-background rounded-full flex items-center justify-center"
                  >
                    <Check className="w-3 h-3" />
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Animation Settings */}
      <div className="space-y-4">
        <Label>Animações</Label>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5">
              <p className="font-medium">Animações</p>
              <p className="text-sm text-muted-foreground">
                Ativar animações e transições no sistema
              </p>
            </div>
            <Switch 
              checked={animations} 
              onCheckedChange={setAnimations}
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5">
              <p className="font-medium">Movimento Reduzido</p>
              <p className="text-sm text-muted-foreground">
                Reduzir animações para melhor acessibilidade
              </p>
            </div>
            <Switch 
              checked={reducedMotion} 
              onCheckedChange={setReducedMotion}
            />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="p-4 border border-dashed rounded-xl">
        <p className="text-sm text-muted-foreground mb-3">Preview</p>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold">ML</span>
          </div>
          <div>
            <p className="font-medium">Millennials CRM</p>
            <p className="text-sm text-muted-foreground">Sistema de Gestão Comercial</p>
          </div>
        </div>
      </div>
    </div>
  );
}
