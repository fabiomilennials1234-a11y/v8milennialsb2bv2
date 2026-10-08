/**
 * PromptEditor — Editor estruturado com seções colapsáveis e @autocomplete
 *
 * Seções:
 *   1. Personalidade — quem é o copilot, persona, tom
 *   2. Objetivo — missão, critério de sucesso, limites
 *   3. Fluxo — etapas da conversa, como conduzir
 *   4. Instruções — do's e don'ts
 *
 * Cada seção é um textarea independente com @mention support.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Maximize2,
  Minimize2,
  AtSign,
  User,
  Target,
  Route,
  ShieldCheck,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import type {
  MentionItem,
  PlaygroundToolState,
  PlaygroundToolDef,
  KnowledgeDocument,
  KnowledgeLink,
  PromptSections,
} from "./types";

// =====================================================
// SECTION CONFIG
// =====================================================

interface SectionConfig {
  key: keyof PromptSections;
  label: string;
  /** Short label shown inside the gradient pill (long labels don't fit). */
  short: string;
  icon: React.ReactNode;
  placeholder: string;
  minHeight: string;
  /** Per-section gradient (design 1 palette) for the hover-expand pill. */
  gradientFrom: string;
  gradientTo: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "personality",
    label: "Personalidade",
    short: "Personalidade",
    gradientFrom: "hsl(47 100% 58%)",
    gradientTo: "hsl(40 96% 45%)",
    icon: <User className="w-4 h-4" />,
    placeholder:
      "Quem e o copilot? Descreva a persona, tom de voz, como se apresenta, como age...\n\nEx: Voce e a Ana, consultora de vendas B2B da TechCorp. Tom profissional mas acessivel, sempre consultivo. Nunca e agressiva ou insistente. Se apresenta pelo nome e pergunta como pode ajudar.",
    minHeight: "min-h-[220px]",
  },
  {
    key: "objective",
    label: "Objetivo",
    short: "Objetivo",
    gradientFrom: "hsl(47 100% 58%)",
    gradientTo: "hsl(40 96% 45%)",
    icon: <Target className="w-4 h-4" />,
    placeholder:
      "Qual a missao principal? Criterio de sucesso? Limites?\n\nEx: Sua missao e qualificar leads inbound identificando fit, budget e timeline. Sucesso = lead qualificado transferido para vendedor. Limite: nunca negocie preco ou faca promessas de desconto.",
    minHeight: "min-h-[200px]",
  },
  {
    key: "flow",
    label: "Fluxo de Atendimento",
    short: "Fluxo",
    gradientFrom: "hsl(47 100% 58%)",
    gradientTo: "hsl(40 96% 45%)",
    icon: <Route className="w-4 h-4" />,
    placeholder:
      "Como deve ser o fluxo da conversa? Etapas, quando avancar, quando recuar?\n\nEx:\n1. Saudacao + entender contexto\n2. Identificar dor principal (1-2 perguntas)\n3. Apresentar solucao alinhada a dor\n4. Se interesse, agendar reuniao\n5. Se objecao, contornar com case de sucesso\n6. Se nao qualificado, agradecer e encerrar",
    minHeight: "min-h-[260px]",
  },
  {
    key: "products",
    label: "Produtos / Servicos",
    short: "Produtos",
    gradientFrom: "hsl(47 100% 58%)",
    gradientTo: "hsl(40 96% 45%)",
    icon: <Package className="w-4 h-4" />,
    placeholder:
      "Catalogo de produtos ou servicos que o copilot vende. Descricao curta, preco, diferenciais, casos de uso.\n\nEx:\n## Plano Starter — R$ 297/mes\n- Para times de ate 5 pessoas\n- Inclui CRM + WhatsApp + 1 copilot\n- Diferencial: setup em 24h\n\n## Plano Pro — R$ 697/mes\n- Para times de ate 20 pessoas\n- Tudo do Starter + automacoes ilimitadas + 3 copilots\n- Diferencial: integracao Trello/Sheets nativa\n\n## Servico de Implantacao\n- Consultoria de onboarding\n- Configura funis, copilot e integracoes\n- 8h de mentoria + 30 dias de suporte premium",
    minHeight: "min-h-[280px]",
  },
  {
    key: "instructions",
    label: "Instrucoes (Do's e Don'ts)",
    short: "Instruções",
    gradientFrom: "hsl(47 100% 58%)",
    gradientTo: "hsl(40 96% 45%)",
    icon: <ShieldCheck className="w-4 h-4" />,
    placeholder:
      "Regras rigidas. O que DEVE fazer e o que NUNCA deve fazer.\n\nEx:\n- Faca no maximo 1 pergunta por mensagem\n- Sempre use o nome do lead\n- Nunca mencione concorrentes\n- Nunca invente dados ou precos\n- Se nao souber, diga que vai verificar",
    minHeight: "min-h-[220px]",
  },
];

// =====================================================
// PROPS
// =====================================================

interface PromptEditorProps {
  sections: PromptSections;
  onSectionsChange: (sections: PromptSections) => void;
  tools: Record<string, PlaygroundToolState>;
  toolDefs: PlaygroundToolDef[];
  documents: KnowledgeDocument[];
  links: KnowledgeLink[];
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function PromptEditor({
  sections,
  onSectionsChange,
  tools,
  toolDefs,
  documents,
  links,
  isExpanded,
  onToggleExpand,
}: PromptEditorProps) {
  const [activeSection, setActiveSection] = useState<keyof PromptSections>(SECTIONS[0].key);
  const [activeMention, setActiveMention] = useState<{
    sectionKey: string;
    startPos: number;
    search: string;
  } | null>(null);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Auto-grow: the textarea height tracks its content so it never scrolls
  // internally. With only the active section mounted, the page keeps a single,
  // clean scroll instead of the old scroll-inside-a-scroll.
  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Re-fit when switching sections or when the value changes from outside (Builder).
  useEffect(() => {
    autoGrow(textareaRefs.current[activeSection]);
  }, [activeSection, sections, autoGrow]);

  // Total char count
  const totalChars = useMemo(() => {
    return Object.values(sections).reduce((sum, v) => sum + v.length, 0);
  }, [sections]);

  // Build mention items
  const mentionItems = useMemo<MentionItem[]>(() => {
    const items: MentionItem[] = [];
    for (const def of toolDefs) {
      if (tools[def.id]?.enabled) {
        items.push({ type: "tool", id: def.id, label: def.name, icon: def.icon });
      }
    }
    for (const doc of documents) {
      items.push({ type: "document", id: doc.id, label: doc.name });
    }
    for (const link of links) {
      items.push({ type: "link", id: link.id, label: link.alias });
    }
    return items;
  }, [tools, toolDefs, documents, links]);

  const filteredMentions = useMemo(() => {
    if (!activeMention) return mentionItems;
    const q = activeMention.search.toLowerCase();
    if (!q) return mentionItems;
    return mentionItems.filter(
      (item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    );
  }, [mentionItems, activeMention]);

  // Update a single section
  const updateSection = useCallback(
    (key: keyof PromptSections, value: string) => {
      onSectionsChange({ ...sections, [key]: value });
    },
    [sections, onSectionsChange]
  );

  // Handle textarea change with @ detection
  const handleChange = useCallback(
    (sectionKey: keyof PromptSections, e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;
      updateSection(sectionKey, newValue);
      autoGrow(e.target);

      // Check @ trigger
      if (cursorPos > 0 && newValue[cursorPos - 1] === "@") {
        const charBefore = cursorPos > 1 ? newValue[cursorPos - 2] : " ";
        if (charBefore === " " || charBefore === "\n" || cursorPos === 1) {
          setActiveMention({ sectionKey, startPos: cursorPos, search: "" });
          return;
        }
      }

      // Update search if mention active
      if (activeMention && activeMention.sectionKey === sectionKey) {
        const searchText = newValue.slice(activeMention.startPos, cursorPos);
        if (searchText.includes(" ") || searchText.includes("\n")) {
          setActiveMention(null);
        } else {
          setActiveMention({ ...activeMention, search: searchText });
        }
      }
    },
    [updateSection, activeMention, autoGrow]
  );

  // Handle mention selection
  const handleSelectMention = useCallback(
    (item: MentionItem) => {
      if (!activeMention) return;
      const ta = textareaRefs.current[activeMention.sectionKey];
      if (!ta) return;

      const sectionKey = activeMention.sectionKey as keyof PromptSections;
      const currentValue = sections[sectionKey] ?? "";
      const before = currentValue.slice(0, activeMention.startPos - 1);
      const after = currentValue.slice(ta.selectionStart);
      const mentionText = `@${item.id}`;
      const newValue = `${before}${mentionText} ${after}`;

      updateSection(sectionKey, newValue);
      setActiveMention(null);

      setTimeout(() => {
        if (ta) {
          const newPos = before.length + mentionText.length + 1;
          ta.focus();
          ta.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [activeMention, sections, updateSection]
  );

  // Handle keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && activeMention) {
        e.preventDefault();
        setActiveMention(null);
      }
      if (e.key === "Escape" && isExpanded) {
        e.preventDefault();
        onToggleExpand();
      }
    },
    [activeMention, isExpanded, onToggleExpand]
  );

  // Insert @ manually
  const handleAtInsert = useCallback(
    (sectionKey: keyof PromptSections) => {
      const ta = textareaRefs.current[sectionKey];
      if (!ta) return;
      const cursorPos = ta.selectionStart;
      const currentValue = sections[sectionKey] ?? "";
      const before = currentValue.slice(0, cursorPos);
      const after = currentValue.slice(cursorPos);
      const newValue = `${before}@${after}`;
      updateSection(sectionKey, newValue);

      setTimeout(() => {
        ta.focus();
        const newPos = cursorPos + 1;
        ta.setSelectionRange(newPos, newPos);
        setActiveMention({ sectionKey, startPos: newPos, search: "" });
      }, 0);
    },
    [sections, updateSection]
  );

  const activeConfig = SECTIONS.find((s) => s.key === activeSection) ?? SECTIONS[0];

  return (
    <div className={`relative flex flex-col ${isExpanded ? "flex-1" : ""}`}>
      {/* Section selector — gradient hover-expand menu (design 1 applied to the
          prompt sections). Each section is an icon circle that expands on hover to
          reveal a gradient fill + blur glow + its label; the ACTIVE section stays
          expanded + filled so the current section is always readable (the original
          design is hover-only, with no persistent state). Icons are lucide; the
          per-section gradients use design 1's palette. `data-gradient` opts these
          buttons out of the global .copilot-surface gold-hover treatment. */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-5 border-b">
        {SECTIONS.map((section) => {
          const isActive = section.key === activeSection;
          const hasContent = (sections[section.key] ?? "").length > 0;

          return (
            <button
              key={section.key}
              type="button"
              data-gradient
              title={section.label}
              onClick={() => setActiveSection(section.key)}
              style={
                {
                  "--gradient-from": section.gradientFrom,
                  "--gradient-to": section.gradientTo,
                } as React.CSSProperties
              }
              className={`group relative h-[56px] flex items-center justify-center shrink-0 cursor-pointer rounded-full border bg-card shadow-sm transition-all duration-500 ${
                isActive
                  ? "w-[184px] border-transparent shadow-none"
                  : "w-[56px] border-border/60 hover:w-[184px] hover:border-transparent"
              }`}
            >
              {/* Gradient fill */}
              <span
                className={`absolute inset-0 rounded-full bg-[linear-gradient(45deg,var(--gradient-from),var(--gradient-to))] transition-opacity duration-500 ${
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              />
              {/* Blur glow */}
              <span
                className={`absolute top-2 inset-x-0 h-full rounded-full bg-[linear-gradient(45deg,var(--gradient-from),var(--gradient-to))] blur-[15px] -z-10 transition-opacity duration-500 ${
                  isActive ? "opacity-40" : "opacity-0 group-hover:opacity-40"
                }`}
              />
              {/* Filled indicator (collapsed circles only) */}
              {hasContent && !isActive && (
                <span className="absolute top-1.5 right-1.5 z-20 h-2 w-2 rounded-full bg-primary ring-2 ring-card transition-opacity duration-300 group-hover:opacity-0" />
              )}
              {/* Icon */}
              <span
                className={`relative z-10 text-muted-foreground transition-transform duration-500 [&_svg]:w-6 [&_svg]:h-6 ${
                  isActive ? "scale-0" : "scale-100 group-hover:scale-0"
                }`}
              >
                {section.icon}
              </span>
              {/* Label */}
              <span
                className={`absolute inset-0 z-10 flex items-center justify-center px-3 text-center text-primary-foreground uppercase tracking-wide text-[11px] font-semibold whitespace-nowrap transition-transform duration-500 ${
                  isActive ? "scale-100 delay-150" : "scale-0 group-hover:scale-100 group-hover:delay-150"
                }`}
              >
                {section.short}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active section — single auto-growing editor */}
      <div className="px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{activeConfig.label}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{totalChars} chars</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => handleAtInsert(activeSection)}
            >
              <AtSign className="w-3.5 h-3.5" />
              Inserir referencia
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onToggleExpand}
              title={isExpanded ? "Recolher editor" : "Expandir editor"}
            >
              {isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="relative">
          <textarea
            ref={(el) => {
              textareaRefs.current[activeSection] = el;
              autoGrow(el);
            }}
            value={sections[activeSection] ?? ""}
            onChange={(e) => handleChange(activeSection, e)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setTimeout(() => setActiveMention(null), 200);
            }}
            placeholder={activeConfig.placeholder}
            rows={1}
            className="w-full resize-none overflow-hidden bg-muted/20 rounded-lg p-3 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/30 border border-border/50 min-h-[320px]"
            style={{ fontFamily: "inherit" }}
          />

          {/* Mention dropdown */}
          {activeMention?.sectionKey === activeSection && (
            <div className="absolute left-2 top-10 z-50 w-72 rounded-lg border bg-popover shadow-md">
              <Command>
                <CommandInput
                  placeholder="Buscar tool ou documento..."
                  value={activeMention.search}
                  onValueChange={(v) =>
                    setActiveMention({ ...activeMention, search: v })
                  }
                />
                <CommandList>
                  <CommandEmpty>Nenhum item encontrado</CommandEmpty>

                  {filteredMentions.some((m) => m.type === "tool") && (
                    <CommandGroup heading="Tools">
                      {filteredMentions
                        .filter((m) => m.type === "tool")
                        .map((item) => (
                          <CommandItem
                            key={item.id}
                            value={item.id}
                            onSelect={() => handleSelectMention(item)}
                          >
                            <span className="text-xs font-mono bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded mr-2">
                              @{item.id}
                            </span>
                            <span className="text-sm">{item.label}</span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  )}

                  {filteredMentions.some((m) => m.type === "document") && (
                    <CommandGroup heading="Documentos">
                      {filteredMentions
                        .filter((m) => m.type === "document")
                        .map((item) => (
                          <CommandItem
                            key={item.id}
                            value={item.id}
                            onSelect={() => handleSelectMention(item)}
                          >
                            <span className="text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded mr-2">
                              @{item.label}
                            </span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  )}

                  {filteredMentions.some((m) => m.type === "link") && (
                    <CommandGroup heading="Links">
                      {filteredMentions
                        .filter((m) => m.type === "link")
                        .map((item) => (
                          <CommandItem
                            key={item.id}
                            value={item.id}
                            onSelect={() => handleSelectMention(item)}
                          >
                            <span className="text-xs font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded mr-2">
                              @{item.label}
                            </span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
