// Reusable port of CopilotPlayground.tsx buildSystemPrompt + resolveMentions.
// Guard: compose-system-prompt.test.ts runs the SAME goldens as the Deno port
// (supabase/functions/_shared/copilot-prompt). If the frontend ever diverges
// from the Deno port, that golden test fails.
// NÃO altere o formato de saída — fidelidade byte-a-byte é o requisito.
import { PLAYGROUND_TOOLS } from "../components/playground/types";

// Shared contract (frontend copy — identical shape to the Deno ComposeInput).
export interface ComposePromptSections {
  personality: string;
  objective: string;
  flow: string;
  products?: string;
  instructions: string;
}

export interface ComposeToolState {
  id: string;
  enabled: boolean;
  instruction: string;
}

export interface ComposeDoc {
  id: string;
  name: string;
  fileType: "image" | "video" | "document";
  description?: string;
  sendWhen?: string;
}

export interface ComposeLink {
  id: string;
  alias: string;
  url: string;
}

export interface ComposeInput {
  promptSections: ComposePromptSections;
  tools: ComposeToolState[];
  documents: ComposeDoc[];
  links: ComposeLink[];
}

/** Resolve @menções em texto, substituindo por instruções que o LLM entende. */
function resolveMentions(text: string, input: ComposeInput): string {
  let resolved = text;

  for (const def of PLAYGROUND_TOOLS) {
    const state = input.tools.find((t) => t.id === def.id);
    const mentionRegex = new RegExp(`@${def.id}`, "g");
    if (state?.enabled) {
      resolved = resolved.replace(mentionRegex, `[usar ferramenta "${def.name}"]`);
    } else {
      resolved = resolved.replace(mentionRegex, def.name);
    }
  }

  for (const link of input.links) {
    const linkMentionRegex = new RegExp(`@${link.id}`, "g");
    resolved = resolved.replace(linkMentionRegex, `${link.alias} (${link.url})`);
  }

  for (const doc of input.documents) {
    const docMentionRegex = new RegExp(`@${doc.id}`, "g");
    resolved = resolved.replace(docMentionRegex, `[documento: ${doc.name}]`);
  }

  return resolved;
}

/**
 * Monta o system prompt final a partir das seções estruturadas + tool instructions.
 *
 * Ordem: Personalidade → Objetivo → Fluxo → Produtos → Ferramentas → Mídia → Instruções → Links
 */
export function composeSystemPrompt(input: ComposeInput): string {
  const parts: string[] = [];
  const s = input.promptSections;

  if (s.personality.trim()) {
    parts.push(`# PERSONALIDADE\n\n${resolveMentions(s.personality.trim(), input)}`);
  }

  if (s.objective.trim()) {
    parts.push(`# OBJETIVO\n\n${resolveMentions(s.objective.trim(), input)}`);
  }

  if (s.flow.trim()) {
    parts.push(`# FLUXO DE ATENDIMENTO\n\n${resolveMentions(s.flow.trim(), input)}`);
  }

  if (s.products?.trim()) {
    parts.push(`# PRODUTOS E SERVICOS\n\n${resolveMentions(s.products.trim(), input)}`);
  }

  // Tool instructions — only enabled tools
  const toolSections: string[] = [];
  for (const def of PLAYGROUND_TOOLS) {
    const state = input.tools.find((t) => t.id === def.id);
    if (!state?.enabled) continue;
    const instruction = state.instruction?.trim() || def.defaultInstruction;
    toolSections.push(`## ${def.name}\n${resolveMentions(instruction, input)}`);
  }
  if (toolSections.length > 0) {
    parts.push(`# FERRAMENTAS DISPONÍVEIS\n\n${toolSections.join("\n\n")}`);
  }

  // Media available for sending
  const mediaDocs = input.documents.filter(
    (d) => (d.fileType === "image" || d.fileType === "video") && (d.description || d.sendWhen)
  );
  if (mediaDocs.length > 0) {
    const mediaSections = mediaDocs.map((d) => {
      const typeLabel = d.fileType === "image" ? "imagem" : "video";
      let section = `## [${typeLabel}] ${d.name}`;
      if (d.description) section += `\nDescricao: ${d.description}`;
      if (d.sendWhen) section += `\nQuando enviar: ${d.sendWhen}`;
      return section;
    });
    parts.push(`# MÍDIA DISPONÍVEL PARA ENVIAR\n\n${mediaSections.join("\n\n")}`);
  }

  if (s.instructions.trim()) {
    parts.push(`# INSTRUÇÕES\n\n${resolveMentions(s.instructions.trim(), input)}`);
  }

  // Links
  if (input.links.length > 0) {
    let linkSection = "## Links disponiveis para enviar ao lead:\n";
    for (const link of input.links) {
      linkSection += `- ${link.alias}: ${link.url}\n`;
    }
    linkSection += "\nIMPORTANTE: Quando relevante, envie o link completo na mensagem para o lead poder clicar.";
    parts.push(linkSection);
  }

  return parts.join("\n\n");
}
