/**
 * RC.5: Tests para extractReasoningChain via sanitizeAssistantMessage.
 *
 * extractReasoningChain é função interna do message-sanitizer; testamos seu
 * comportamento através do entry point público (sanitizeAssistantMessage).
 *
 * Cobre:
 * - Bloco completo <thinking>...</thinking>
 * - Bloco <response> dentro
 * - Defensive: <thinking> sem fechar → tudo após é descartado
 * - Backward compat: sem <thinking> texto retorna intacto
 * - Strip residual de tags resíduo
 */

import { describe, it, expect } from "vitest";
import "../../helpers/deno-mock";
import { sanitizeAssistantMessage } from "../../../supabase/functions/_shared/message-sanitizer.ts";

describe("sanitizeAssistantMessage — reasoning chain extraction", () => {
  it("extrai bloco <thinking>...</thinking> completo e devolve resposta limpa", () => {
    const raw = `<thinking>
1. Lead quer agendar
2. Tem telefone
3. Vou usar schedule_meeting
</thinking>
Olá! Posso te ajudar a agendar a reunião.`;
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.reasoning).toContain("Lead quer agendar");
    expect(r.reasoning).toContain("schedule_meeting");
    expect(r.text).toBe("Olá! Posso te ajudar a agendar a reunião.");
    expect(r.text).not.toContain("<thinking");
  });

  it("extrai <response>...</response> quando presente, descartando texto fora", () => {
    const raw = `<thinking>raciocínio aqui</thinking>
ruído que não deveria vir
<response>Bom dia! Como posso ajudar?</response>
mais ruído`;
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.reasoning).toBe("raciocínio aqui");
    expect(r.text).toBe("Bom dia! Como posso ajudar?");
    expect(r.text).not.toContain("ruído");
  });

  it("defensive: <thinking> sem fechamento → descarta tudo após (não vaza pro lead)", () => {
    const raw = `Olá tudo bem?
<thinking>
estou pensando ainda
e nunca fechei a tag — bug do LLM
e isso jamais pode chegar no lead`;
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Olá tudo bem?");
    expect(r.text).not.toContain("thinking");
    expect(r.text).not.toContain("bug do LLM");
    expect(r.reasoning).toBeUndefined();
  });

  it("backward compat: input sem <thinking> retorna texto original sem reasoning", () => {
    const raw = "Resposta normal sem reasoning algum.";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Resposta normal sem reasoning algum.");
    expect(r.reasoning).toBeUndefined();
  });

  it("strip residual: tags resíduo de thinking/response são removidas no fallback final", () => {
    const raw = `<thinking>raciocínio</thinking>Texto <response>com tag órfã</response> e </thinking> resíduo.`;
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.reasoning).toBe("raciocínio");
    expect(r.text).not.toContain("<thinking");
    expect(r.text).not.toContain("</thinking");
    expect(r.text).not.toContain("<response");
    expect(r.text).not.toContain("</response");
  });

  it("compõe com sanitização de JSON action: extrai reasoning E remove bloco JSON action vazado", () => {
    const raw = `<thinking>vou usar schedule_meeting</thinking>
{"action":"schedule_meeting","action_input":{"preferred_date":"2026-05-01"}}
Vou agendar pra você!`;
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.reasoning).toBe("vou usar schedule_meeting");
    expect(r.text).not.toContain('"action"');
    expect(r.text).toContain("Vou agendar pra você!");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("preserva newlines internos do bloco <thinking>", () => {
    const raw = `<thinking>
linha 1
linha 2
linha 3
</thinking>
ok`;
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.reasoning).toContain("linha 1");
    expect(r.reasoning).toContain("linha 2");
    expect(r.reasoning).toContain("linha 3");
  });
});
