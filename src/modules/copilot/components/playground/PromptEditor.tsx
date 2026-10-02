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
  /** Short label shown in the section switcher (long labels don't fit). */
  short: string;
  icon: React.ReactNode;
  placeholder: string;
  minHeight: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "personality",
    label: "Personalidade",
    short: "Personalidade",
    icon: <User className="w-4 h-4" />,
    placeholder:
      "Quem é o copilot? Descreva a persona, tom de voz, como se apresenta, como age...\n\nEx: Você é a Ana, consultora de vendas B2B da TechCorp. Tom profissional mas acessível, sempre consultivo. Nunca é agressiva ou insistente. Se apresenta pelo nome e pergunta como pode ajudar.",
    minHeight: "min-h-[220px]",
  },
  {
    key: "objective",
    label: "Objetivo",
    short: "Objetivo",
    icon: <Target className="w-4 h-4" />,
    placeholder:
      "Qual a missão principal? Critério de sucesso? Limites?\n\nEx: Sua missão é qualificar leads inbound identificando fit, budget e timeline. Sucesso = lead qualificado transferido para vendedor. Limite: nunca negocie preço ou faça promessas de desconto.",
    minHeight: "min-h-[200px]",
  },
  {
    key: "flow",
    label: "Fluxo de Atendimento",
    short: "Fluxo",
    icon: <Route className="w-4 h-4" />,
    placeholder:
      "Como deve ser o fluxo da conversa? Etapas, quando avançar, quando recuar?\n\nEx:\n1. Saudação + entender contexto\n2. Identificar dor principal (1-2 perguntas)\n3. Apresentar solução alinhada à dor\n4. Se interesse, agendar reunião\n5. Se objeção, contornar com case de sucesso\n6. Se não qualificado, agradecer e encerrar",
    minHeight: "min-h-[260px]",
  },
  {
    key: "products",
    label: "Produtos / Serviços",
    short: "Produtos",
    icon: <Package className="w-4 h-4" />,
    placeholder:
      "Catálogo de produtos ou serviços que o copilot vende. Descrição curta, preço, diferenciais, casos de uso.\n\nEx:\n## Plano Starter — R$ 297/mês\n- Para times de até 5 pessoas\n- Inclui CRM + WhatsApp + 1 copilot\n- Diferencial: setup em 24h\n\n## Plano Pro — R$ 697/mês\n- Para times de até 20 pessoas\n- Tudo do Starter + automações ilimitadas + 3 copilots\n- Diferencial: integração Trello/Sheets nativa\n\n## Serviço de Implantação\n- Consultoria de onboarding\n- Configura funis, copilot e integrações\n- 8h de mentoria + 30 dias de suporte premium",
    minHeight: "min-h-[280px]",
  },
  {
    key: "instructions",
    label: "Instruções (Do's e Don'ts)",
    short: "Instruções",
    icon: <ShieldCheck className="w-4 h-4" />,
    placeholder:
      "Regras rígidas. O que DEVE fazer e o que NUNCA deve fazer.\n\nEx:\n- Faça no máximo 1 pergunta por mensagem\n- Sempre use o nome do lead\n- Nunca mencione concorrentes\n- Nunca invente dados ou preços\n- Se não souber, diga que vai verificar",
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
      {/* Section selector — alternador claro do V5 (segmented). O ponto dourado
          marca seção já preenchida; a ativa é o cartão branco em relevo. */}
      <div className="border-b border-border/60 px-4 py-3">
        <div
          role="group"
          aria-label="Seções do prompt"
          className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-[3px] scrollbar-hide"
        >
          {SECTIONS.map((section) => {
            const isActive = section.key === activeSection;
            const hasContent = (sections[section.key] ?? "").length > 0;

            return (
              <button
                key={section.key}
                type="button"
                title={section.label}
                aria-pressed={isActive}
                onClick={() => setActiveSection(section.key)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-3.5 [&_svg]:w-3.5 ${
                  isActive
                    ? "bg-card text-foreground shadow-relevo"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {section.icon}
                {section.short}
                {hasContent && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    <span className="sr-only">(preenchida)</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active section — single auto-growing editor */}
      <div className="px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold tracking-tight">{activeConfig.label}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">{totalChars} chars</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => handleAtInsert(activeSection)}
            >
              <AtSign className="w-3.5 h-3.5" />
              Inserir referência
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-[9px] p-0"
              onClick={onToggleExpand}
              title={isExpanded ? "Recolher editor" : "Expandir editor"}
              aria-label={isExpanded ? "Recolher editor" : "Expandir editor"}
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
            className="w-full resize-none overflow-hidden rounded-2xl border border-input bg-sunken p-4 text-sm leading-relaxed placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-ring/40 min-h-[320px]"
            style={{ fontFamily: "inherit" }}
          />

          {/* Mention dropdown */}
          {activeMention?.sectionKey === activeSection && (
            <div className="absolute left-2 top-10 z-50 w-72 overflow-hidden rounded-2xl border border-card-border bg-popover shadow-relevo-alto">
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
                            <span className="mr-2 rounded-md bg-primary-soft px-1.5 py-0.5 font-mono text-xs text-primary-soft-foreground">
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
                            <span className="mr-2 rounded-md bg-insights/10 px-1.5 py-0.5 font-mono text-xs text-insights">
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
                            <span className="mr-2 rounded-md bg-success/10 px-1.5 py-0.5 font-mono text-xs text-success">
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
