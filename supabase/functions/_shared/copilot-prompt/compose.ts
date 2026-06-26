// PORT pura de CopilotPlayground.tsx buildSystemPrompt + resolveMentions.
// Guard: compose.test.ts + goldens (próxima tarefa).
// NÃO altere o formato de saída — fidelidade byte-a-byte com o frontend é o requisito.
import { TOOLS_CATALOG } from "./tools-catalog.ts";

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

/** Porta de resolveMentions (CopilotPlayground.tsx:91-115). */
function resolveMentions(text: string, input: ComposeInput): string {
  let resolved = text;

  for (const def of TOOLS_CATALOG) {
    const state = input.tools.find((t) => t.id === def.id);
    const re = new RegExp(`@${def.id}`, "g");
    resolved = state?.enabled
      ? resolved.replace(re, `[usar ferramenta "${def.name}"]`)
      : resolved.replace(re, def.name);
  }

  for (const link of input.links) {
    resolved = resolved.replace(new RegExp(`@${link.id}`, "g"), `${link.alias} (${link.url})`);
  }

  for (const doc of input.documents) {
    resolved = resolved.replace(new RegExp(`@${doc.id}`, "g"), `[documento: ${doc.name}]`);
  }

  return resolved;
}

/** Porta de buildSystemPrompt (CopilotPlayground.tsx:122-184). */
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

  // Tool instructions — only enabled tools, in catalog order
  const toolSections: string[] = [];
  for (const def of TOOLS_CATALOG) {
    const state = input.tools.find((t) => t.id === def.id);
    if (!state?.enabled) continue;
    const instruction = state.instruction?.trim() || def.defaultInstruction;
    toolSections.push(`## ${def.name}\n${resolveMentions(instruction, input)}`);
  }
  if (toolSections.length > 0) {
    parts.push(`# FERRAMENTAS DISPONÍVEIS\n\n${toolSections.join("\n\n")}`);
  }

  // Media available for sending (image/video only, must have description or sendWhen)
  const mediaDocs = input.documents.filter(
    (d) => (d.fileType === "image" || d.fileType === "video") && (d.description || d.sendWhen),
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
    linkSection +=
      "\nIMPORTANTE: Quando relevante, envie o link completo na mensagem para o lead poder clicar.";
    parts.push(linkSection);
  }

  return parts.join("\n\n");
}
