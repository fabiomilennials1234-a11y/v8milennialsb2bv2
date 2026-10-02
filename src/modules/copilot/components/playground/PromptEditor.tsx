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
 *
 * V5 (mockup "Copilot · Editor"): as cinco caixas ficam EMPILHADAS, cada uma
 * com rótulo, dica em cinza e contador de caracteres — sai o sub-alternador que
 * mostrava uma seção por vez. "Inserir referência" age na última caixa focada.
 * Só forma: o estado, o @autocomplete e o que é salvo são os mesmos.
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
  /** Dica em cinza ao lado do rótulo. */
  hint: string;
  /** Short label shown in the section switcher (long labels don't fit). */
  short: string;
  icon: React.ReactNode;
  placeholder: string;
  minHeight: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "personality",
    hint: "quem é o agente e como ele fala",
    label: "Personalidade",
    short: "Personalidade",
    icon: <User className="w-4 h-4" />,
    placeholder:
      "Quem é o copilot? Descreva a persona, tom de voz, como se apresenta, como age...\n\nEx: Você é a Ana, consultora de vendas B2B da TechCorp. Tom profissional mas acessível, sempre consultivo. Nunca é agressiva ou insistente. Se apresenta pelo nome e pergunta como pode ajudar.",
    minHeight: "min-h-[220px]",
  },
  {
    key: "objective",
    hint: "o resultado que define sucesso",
    label: "Objetivo",
    short: "Objetivo",
    icon: <Target className="w-4 h-4" />,
    placeholder:
      "Qual a missão principal? Critério de sucesso? Limites?\n\nEx: Sua missão é qualificar leads inbound identificando fit, budget e timeline. Sucesso = lead qualificado transferido para vendedor. Limite: nunca negocie preço ou faça promessas de desconto.",
    minHeight: "min-h-[200px]",
  },
  {
    key: "flow",
    hint: "o passo a passo da conversa",
    label: "Fluxo de Atendimento",
    short: "Fluxo",
    icon: <Route className="w-4 h-4" />,
    placeholder:
      "Como deve ser o fluxo da conversa? Etapas, quando avançar, quando recuar?\n\nEx:\n1. Saudação + entender contexto\n2. Identificar dor principal (1-2 perguntas)\n3. Apresentar solução alinhada à dor\n4. Se interesse, agendar reunião\n5. Se objeção, contornar com case de sucesso\n6. Se não qualificado, agradecer e encerrar",
    minHeight: "min-h-[260px]",
  },
  {
    key: "products",
    hint: "o que ele pode oferecer e citar",
    label: "Produtos / Serviços",
    short: "Produtos",
    icon: <Package className="w-4 h-4" />,
    placeholder:
      "Catálogo de produtos ou serviços que o copilot vende. Descrição curta, preço, diferenciais, casos de uso.\n\nEx:\n## Plano Starter — R$ 297/mês\n- Para times de até 5 pessoas\n- Inclui CRM + WhatsApp + 1 copilot\n- Diferencial: setup em 24h\n\n## Plano Pro — R$ 697/mês\n- Para times de até 20 pessoas\n- Tudo do Starter + automações ilimitadas + 3 copilots\n- Diferencial: integração Trello/Sheets nativa\n\n## Serviço de Implantação\n- Consultoria de onboarding\n- Configura funis, copilot e integrações\n- 8h de mentoria + 30 dias de suporte premium",
    minHeight: "min-h-[280px]",
  },
  {
    key: "instructions",
    hint: "limites inegociáveis",
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
  /** Pílulas de contexto acima das caixas (modelo, estilo de resposta). */
  meta?: React.ReactNode;
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
  meta,
}: PromptEditorProps) {
  // A caixa que recebe "Inserir referência": a última focada (começa na primeira).
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

  // Re-fit every box when the value changes from outside (Builder, load).
  useEffect(() => {
    for (const el of Object.values(textareaRefs.current)) autoGrow(el);
  }, [sections, autoGrow]);

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

  const renderMentions = () =>
    activeMention ? (
      <div className="absolute left-2 top-10 z-50 w-72 overflow-hidden rounded-2xl border border-card-border bg-popover shadow-relevo-alto">
        <Command>
          <CommandInput
            placeholder="Buscar tool ou documento..."
            value={activeMention.search}
            onValueChange={(v) => setActiveMention({ ...activeMention, search: v })}
          />
          <CommandList>
            <CommandEmpty>Nenhum item encontrado</CommandEmpty>

            {filteredMentions.some((m) => m.type === "tool") && (
              <CommandGroup heading="Tools">
                {filteredMentions
                  .filter((m) => m.type === "tool")
                  .map((item) => (
                    <CommandItem key={item.id} value={item.id} onSelect={() => handleSelectMention(item)}>
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
                    <CommandItem key={item.id} value={item.id} onSelect={() => handleSelectMention(item)}>
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
                    <CommandItem key={item.id} value={item.id} onSelect={() => handleSelectMention(item)}>
                      <span className="mr-2 rounded-md bg-success/10 px-1.5 py-0.5 font-mono text-xs text-success-strong">
                        @{item.label}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </div>
    ) : null;

  return (
    <div className={`relative flex flex-col ${isExpanded ? "flex-1" : ""}`}>
      {/* Faixa de contexto: pílulas (modelo, estilo) e as ações do editor */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        {meta}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => handleAtInsert(activeSection)}
          >
            <AtSign className="w-3.5 h-3.5" />
            Inserir referência
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-[9px] p-0"
            onClick={onToggleExpand}
            title={isExpanded ? "Recolher editor" : "Expandir editor"}
            aria-label={isExpanded ? "Recolher editor" : "Expandir editor"}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* As cinco caixas, empilhadas */}
      <div role="group" aria-label="Seções do prompt" className="space-y-5 px-4 py-4">
        {SECTIONS.map((section) => {
          const value = sections[section.key] ?? "";
          const inputId = `prompt-section-${section.key}`;
          return (
            <div key={section.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor={inputId} className="flex min-w-0 items-baseline gap-2">
                  <span className="text-sm font-bold tracking-tight text-foreground">{section.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{section.hint}</span>
                </label>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {value.length.toLocaleString("pt-BR")} caracteres
                </span>
              </div>
              <div className="relative">
                <textarea
                  id={inputId}
                  ref={(el) => {
                    textareaRefs.current[section.key] = el;
                    autoGrow(el);
                  }}
                  value={value}
                  onChange={(e) => handleChange(section.key, e)}
                  onFocus={() => setActiveSection(section.key)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => {
                    setTimeout(() => setActiveMention(null), 200);
                  }}
                  placeholder={section.placeholder}
                  rows={1}
                  className="min-h-[112px] w-full resize-none overflow-hidden rounded-2xl border border-input bg-sunken p-4 text-sm leading-relaxed placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-ring/40"
                  style={{ fontFamily: "inherit" }}
                />
                {activeMention?.sectionKey === section.key && renderMentions()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
