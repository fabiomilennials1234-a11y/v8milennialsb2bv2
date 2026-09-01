import { describe, it, expect } from "vitest";
import {
  sanitizeAssistantMessage,
  splitByDelimiter,
} from "../../supabase/functions/_shared/message-sanitizer";

describe("sanitizeAssistantMessage", () => {
  it("passes through clean text untouched", () => {
    const r = sanitizeAssistantMessage("Oi Thais, tudo bem?", false);
    expect(r.text).toBe("Oi Thais, tudo bem?");
    expect(r.droppedBlocks).toBe(0);
    expect(r.recoveredAction).toBeNull();
  });

  it("strips raw ReAct JSON leaked as text (incidente Barulhinho Bom)", () => {
    const raw = [
      "Com certeza! Vou te mandar a foto e o vídeo.",
      "",
      '{ "action": "send_media", "action_input": "{ \\"media_id\\": \\"banana verde.jpeg\\" }" }',
      "",
      '{ "action": "send_media", "action_input": "{ \\"media_id\\": \\"Video banana verde.mp4\\" }" }',
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Com certeza! Vou te mandar a foto e o vídeo.");
    expect(r.droppedBlocks).toBe(2);
    // send_media não é tool real → não recupera
    expect(r.recoveredAction).toBeNull();
  });

  it("strips fenced JSON ```json ... ```", () => {
    const raw =
      "Claro, segue o material.\n\n```json\n{\"action\":\"send_product_material\",\"action_input\":{\"material_id\":\"abc-123\"}}\n```";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Claro, segue o material.");
    expect(r.droppedBlocks).toBe(1);
  });

  it("strips inline <tool_name: args> pseudo-tags leaked as text (Barulhinho Bom 2026-06-02)", () => {
    const raw = [
      "Vou te encaminhar agora para o consultor que ele já te passa a tabela de preços junto com os vídeos, pode ser?",
      "",
      "<send_video: Linha de produtos.mp4>",
      '<qualify_lead: {"nome": "gabriel", "empresa": "Mtech", "segmento": "mercadinho", "cidade": "não informada", "linha_interesse": "batata doce e mix nuts", "volume_estimado": "não informado"}>',
      '<move_card: "Qualificado">',
      '<transfer_to_human: "Lead Gabriel do mercadinho quer saber preços e ver vídeos da linha. Já sabe do pedido mínimo de R$ 300.">',
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Vou te encaminhar agora para o consultor que ele já te passa a tabela de preços junto com os vídeos, pode ser?",
    );
    // Nenhuma tag de tool pode sobrar no texto que vai pro cliente.
    expect(r.text).not.toContain("<");
    expect(r.droppedBlocks).toBe(4);
    // qualify_lead tem args JSON e mapeia → recupera a ação.
    expect(r.recoveredAction?.action).toBe("QUALIFY_LEAD");
    expect((r.recoveredAction?.params as Record<string, unknown>)?.empresa).toBe("Mtech");
  });

  it("does NOT strip legitimate text with a non-tool <word: value> shape", () => {
    const raw = "Horário de atendimento <segunda: 9h às 18h>, pode contar comigo!";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("recovers mapped tool as action when tool_call was missed", () => {
    const raw =
      'Vou enviar o catálogo.\n{ "action": "send_product_material", "action_input": "{\\"material_id\\":\\"mat-1\\"}" }';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Vou enviar o catálogo.");
    expect(r.droppedBlocks).toBe(1);
    expect(r.recoveredAction).toEqual({
      action: "SEND_PRODUCT_MATERIAL",
      params: { material_id: "mat-1" },
    });
  });

  it("accepts action_input as object (not only string)", () => {
    const raw =
      'Agendando.\n{ "action": "schedule_meeting", "action_input": { "preferred_date": "2026-05-01" } }';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredAction).toEqual({
      action: "SCHEDULE_MEETING",
      params: { preferred_date: "2026-05-01" },
    });
  });

  it("does not recover when tool_call already came from native tool_calls", () => {
    const raw =
      'Ok.\n{ "action": "schedule_meeting", "action_input": { "preferred_date": "2026-05-01" } }';
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.droppedBlocks).toBe(1);
    expect(r.recoveredAction).toBeNull();
  });

  it("handles empty / null input safely", () => {
    expect(sanitizeAssistantMessage("", false).text).toBe("");
    expect(sanitizeAssistantMessage(null as unknown as string, false).text).toBe(null);
  });

  it("collapses triple newlines left by stripping", () => {
    const raw = 'Topo\n\n\n{"action":"x_unknown"}\n\n\nFim';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Topo\n\nFim");
  });

  it("kills residual line-form action JSON the main regex misses", () => {
    const raw = 'Mensagem\n{"action":"send_product_material","action_input":"incomplete';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).not.toMatch(/"action"/);
  });

  // ============================================================
  // Regressão: leak <tool_call> XML (Barulinho Bom 2026-05-21)
  // gemini-3-flash-preview emite tool calls como TEXTO no formato
  // universal-tool-calling (Hermes/Qwen) em vez de native tool_calls.
  // ============================================================

  it("strips <tool_call> XML blocks with tool_name/tool_arguments schema", () => {
    const raw = [
      "Como sua loja é de produtos naturais, você pretende focar mais nos pacotinhos ou granel?",
      "",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "e5e84c2d-ac9e-4dc2-8349-02f6893f6f1e"}}',
      "</tool_call>",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "060d4750-7f23-45f8-84be-977469ec1101"}}',
      "</tool_call>",
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Como sua loja é de produtos naturais, você pretende focar mais nos pacotinhos ou granel?",
    );
    expect(r.text).not.toMatch(/tool_call/i);
    expect(r.text).not.toMatch(/tool_name/i);
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(2);
  });

  it("recovers action from <tool_call> with tool_name/tool_arguments when native tool missed", () => {
    const raw = [
      "Segue o material.",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "mat-xyz"}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Segue o material.");
    expect(r.recoveredAction).toEqual({
      action: "SEND_PRODUCT_MATERIAL",
      params: { material_id: "mat-xyz" },
    });
  });

  // ============================================================
  // Regressão: leak <tool_code> (Itatex Têxtil 2026-06-17)
  // Gemini emite o tool-call no formato code-execution
  // `<tool_code>{"tool":"...","parameters":{...}}</tool_code>` como TEXTO.
  // PDF chegou (tool nativa disparou) MAS o bloco cru vazou no WhatsApp.
  // ============================================================

  it("strips <tool_code> blocks with tool/parameters schema (native already fired)", () => {
    const raw = [
      "Com certeza, Gisely! Vou te enviar agora mesmo o nosso catálogo completo.",
      "",
      "<tool_code>",
      "{",
      '  "tool": "send_document",',
      '  "parameters": {',
      '    "document_url": "https://storage.googleapis.com/vapi-public/itatex/Catalago%20de%20Produtos_compressed.pdf",',
      '    "caption": "Aqui está o nosso catálogo completo, Gisely! 🦋"',
      "  }",
      "}",
      "</tool_code>",
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe(
      "Com certeza, Gisely! Vou te enviar agora mesmo o nosso catálogo completo.",
    );
    expect(r.text).not.toMatch(/tool_code/i);
    expect(r.text).not.toMatch(/send_document/i);
    expect(r.text).not.toMatch(/document_url/i);
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("recovers action from <tool_code> tool/parameters when native tool missed", () => {
    const raw = [
      "Segue o catálogo.",
      "<tool_code>",
      '{"tool": "send_document", "parameters": {"document_url": "https://x/y.pdf", "caption": "Catálogo"}}',
      "</tool_code>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Segue o catálogo.");
    expect(r.recoveredAction).toEqual({
      action: "SEND_DOCUMENT",
      params: { document_url: "https://x/y.pdf", caption: "Catálogo" },
    });
  });

  it("supports legacy <tool_call> schema name/arguments (OpenRouter universal)", () => {
    const raw = [
      "Buscando.",
      "<tool_call>",
      '{"name": "search_knowledge", "arguments": {"query": "chips embalagem"}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Buscando.");
    expect(r.text).not.toMatch(/tool_call/i);
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips <vertical_tool_calls> wrapper variant", () => {
    const raw = [
      "Olha só.",
      "<vertical_tool_calls>",
      '<tool_call name="search_knowledge" arguments=\'{"query":"x"}\'>',
      "</tool_call>",
      "</vertical_tool_calls>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Olha só.");
    expect(r.text).not.toMatch(/tool_call|vertical/i);
  });

  it("strips standalone <no_tool_calls> sentinel", () => {
    const raw = "Ok, sem ação agora.\n<no_tool_calls>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Ok, sem ação agora.");
    expect(r.text).not.toMatch(/no_tool_calls/i);
  });

  it("self-closing <no_tool_calls /> also stripped", () => {
    const raw = "Tudo certo.\n<no_tool_calls />";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Tudo certo.");
  });

  it("handles unclosed <tool_call> defensively (discards trailing leak)", () => {
    const raw = "Vou enviar.\n<tool_call>\n{\"tool_name\": \"send_product_material\", \"tool_arguments\":";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Vou enviar.");
    expect(r.text).not.toMatch(/tool_call|tool_name/i);
  });

  it("does not recover from <tool_call> when alreadyHasAction (native fired)", () => {
    const raw = [
      "Ok.",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "m1"}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe("Ok.");
    expect(r.recoveredAction).toBeNull();
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("ignores <tool_call> with unknown tool name (no recovery, still strips)", () => {
    const raw = [
      "Hmm.",
      "<tool_call>",
      '{"tool_name": "made_up_tool", "tool_arguments": {}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Hmm.");
    expect(r.recoveredAction).toBeNull();
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips case-insensitive <TOOL_CALL> / <Tool_Call>", () => {
    const raw = "Texto.\n<TOOL_CALL>\n{}\n</TOOL_CALL>\n<Tool_Call>\n{}\n</Tool_Call>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Texto.");
  });

  // ============================================================
  // Regressão: leak de diretiva de mídia SEM "action" (incidente
  // VitrineVET 2026-06-01). Agente "Luiza" improvisou {"file":"X.jpg"}
  // porque o documento estava preso em status=processing (tool send_document
  // não oferecido). Sem chave "action" → escapava de todos os filtros.
  // ============================================================

  it("strips leaked media directives without an action key (incidente VitrineVET)", () => {
    const raw = [
      "Com certeza, Auré! Vou te enviar agora mesmo as imagens do catálogo da Biocepa com a linha completa de suplementos.",
      "",
      "{",
      '  "file": "CATALOGO BIOCEPA(2)_pag_001.jpg"',
      "}",
      "",
      "{",
      '  "file": "CATALOGO BIOCEPA(2)_pag_002.jpg"',
      "}",
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Com certeza, Auré! Vou te enviar agora mesmo as imagens do catálogo da Biocepa com a linha completa de suplementos.",
    );
    expect(r.text).not.toMatch(/\{/); // JSON totalmente removido
    expect(r.droppedBlocks).toBe(2);
    // não recupera — resolução filename→document_id é fora do sanitizer
    expect(r.recoveredAction).toBeNull();
  });

  it('strips a leaked { "document": ... } directive', () => {
    const raw = 'Claro, segue o catálogo técnico:\n{\n  "document": "Catalogo Seamaty.pdf"\n}';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Claro, segue o catálogo técnico:");
    expect(r.text).not.toMatch(/\{/);
    expect(r.droppedBlocks).toBe(1);
  });

  it("strips media directive with multiple allowlisted keys (file + caption)", () => {
    const raw = 'Olha:\n{"image": "promo.png", "caption": "Promoção da semana"}';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Olha:");
    expect(r.droppedBlocks).toBe(1);
  });

  it("preserves legitimate JSON whose keys are NOT media (no over-stripping)", () => {
    const raw = 'O preço fica assim: {"preco": "R$ 1.200", "parcelas": 12}';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toContain('{"preco": "R$ 1.200", "parcelas": 12}');
    expect(r.droppedBlocks).toBe(0);
  });

  // ============================================================
  // Regressão: leak de tag em forma de CHAMADA-DE-FUNÇÃO com nome FORA
  // da allowlist (incidente KomBag 2026-06-23). gemini-2.5-flash vazou
  // `<atendimento_vendas_b2b:enviar_midia_vendas_b2b(arquivo_midia='[imagem]Tamanhos.jpeg')>`
  // como TEXTO. O nome antes do `:` (atendimento_vendas_b2b) não está na
  // allowlist → stripInlineToolTags preservava → vazava ao cliente.
  // Sinal seguro: tag angular cujo conteúdo casa `identificador(`.
  // ============================================================

  it("strips the exact KomBag function-call tag leaked as text (out-of-allowlist name)", () => {
    const raw =
      "Vou te mandar os tamanhos:\n<atendimento_vendas_b2b:enviar_midia_vendas_b2b(arquivo_midia='[imagem]Tamanhos.jpeg')>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Vou te mandar os tamanhos:");
    expect(r.text).not.toContain("atendimento_vendas_b2b");
    expect(r.text).not.toContain("enviar_midia");
    expect(r.text).not.toContain("<");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("captures recoveredMediaByName from the leaked call tag (strips [imagem] prefix + quotes)", () => {
    const raw =
      "Segue:\n<atendimento_vendas_b2b:enviar_midia_vendas_b2b(arquivo_midia='[imagem]Tamanhos.jpeg')>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toEqual({ file_name: "Tamanhos.jpeg" });
  });

  it("strips a scope-less function-call tag <send_media(file='x.jpg')>", () => {
    const raw = "Olha:\n<send_media(file='x.jpg')>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Olha:");
    expect(r.text).not.toContain("send_media");
    expect(r.recoveredMediaByName).toEqual({ file_name: "x.jpg" });
  });

  it("strips a generic <a:b(c='d')> function-call tag even with no media filename", () => {
    const raw = "Texto.\n<a:b(c='d')>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Texto.");
    expect(r.text).not.toContain("<");
  });

  it("strips an orphan function-call tag with no closing '>' (defensive)", () => {
    const raw = "Vou enviar.\n<atendimento_vendas_b2b:enviar_midia(arquivo_midia='Tamanhos.jpeg'";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Vou enviar.");
    expect(r.text).not.toContain("atendimento_vendas_b2b");
    expect(r.text).not.toContain("enviar_midia");
  });

  it("does NOT strip legitimate text with parenthesis NOT inside a tag", () => {
    const raw = "preço (promocional) hoje, custa R$ 5 (cinco)";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
    expect(r.recoveredMediaByName).toBeNull();
  });

  it("does NOT strip a markdown/autolink <https://site.com>", () => {
    const raw = "Veja em <https://site.com> por favor";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("still strips allowlisted <send_video: Linha.mp4> (no parens) as before", () => {
    const raw = "Segue o vídeo.\n<send_video: Linha.mp4>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Segue o vídeo.");
    expect(r.text).not.toContain("send_video");
  });

  it("recoveredMediaByName is null when no media filename is present in the call tag", () => {
    const raw = "Texto.\n<scope:tool(flag='on')>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toBeNull();
  });

  it("recoveredMediaByName normalizes [video] prefix too", () => {
    const raw = "Segue:\n<scope:tool(arquivo_midia=\"[video] Linha de Produtos.mp4\")>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toEqual({ file_name: "Linha de Produtos.mp4" });
  });

  // --- Namespaced tool-calls vazados como texto (Bia 2026-06-30 / 2026-07-02) ---

  it("strips declaration:default_api:update_lead{...} com args sem aspas (Bia 2026-07-02)", () => {
    const raw =
      "declaration:default_api:update_lead{updates:{pedido:1x Kit Reconstrutor FB Cosméticos,produto_interesse:Kit Reconstrutor}}";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips deffn:default_api:update_lead{...} (Bia 2026-06-30)", () => {
    const raw = "deffn:default_api:update_lead{updates:{address:askabhan,cep:66609621}}";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("keeps the human text and strips only the leaked namespaced call", () => {
    const raw =
      "Perfeito, Maria! Já anotei seu pedido.\ndeclaration:default_api:update_lead{updates:{pedido:1x Kit}}";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Perfeito, Maria! Já anotei seu pedido.");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips known tool glued to brace without namespace (update_lead{...})", () => {
    const raw = "Anotado.\nupdate_lead{updates:{nome:Maria}}";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Anotado.");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips namespaced call in paren form default_api:tool(args)", () => {
    const raw = "Ok!\nns:default_api:qualify_lead(score=80, motivo=quente)";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Ok!");
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips orphan head default_api:tool sem grupo balanceado (LLM cortou)", () => {
    const raw = "Fechado.\ndeclaration:default_api:update_lead{updates:{pedido:1x Kit";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Fechado.");
  });

  it("does NOT touch legit text that merely mentions a colon or braces", () => {
    const raw = "Horário: 9h às 18h. Uso: aplicar e enxaguar.";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Horário: 9h às 18h. Uso: aplicar e enxaguar.");
    expect(r.droppedBlocks).toBe(0);
  });

  // ============================================================
  // Regressão: tags de RACIOCÍNIO/estrutura inventadas além de
  // <thinking>/<response> (incidente Forever Bella/Bia 2026-07-13).
  // gpt-4.1-mini + reasoning_mode='always' vazou `<prefill> </prefill>`
  // e `<thought>` como TEXTO no balão do cliente ("mensagem de código").
  // O strip antigo só casava thinking|response.
  // ============================================================

  it("strips the leaked <prefill> </prefill> tag keeping the human text (Bia 2026-07-13)", () => {
    const raw =
      "Tenho sim, Natalia! Vou te enviar o catálogo completo pra você conhecer toda a nossa linha. <prefill> </prefill>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Tenho sim, Natalia! Vou te enviar o catálogo completo pra você conhecer toda a nossa linha.",
    );
    expect(r.text).not.toContain("<");
  });

  it("strips a <perfil> variant tag (accented/PT hallucination) keeping content", () => {
    const raw = "Segue seu resumo <perfil>cliente premium</perfil> e já te ajudo.";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).not.toContain("<perfil>");
    expect(r.text).not.toContain("</perfil>");
    expect(r.text).toContain("cliente premium");
  });

  it("drops a <thought>...</thought> reasoning block, keeps the answer after it", () => {
    const raw =
      "<thought>O cliente quer preço; vou responder o valor cheio primeiro.</thought>\n\nO Banho de Verniz fica R$ 179, tudo bem?";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("O Banho de Verniz fica R$ 179, tudo bem?");
    expect(r.text).not.toMatch(/thought/i);
    expect(r.reasoning).toContain("valor cheio");
  });

  it("drops an <analysis> block and unwraps <response>", () => {
    const raw =
      "<analysis>lead frio, reengajar</analysis><response>Oi! Vi que você se interessou pela Progressiva. Posso te ajudar?</response>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Oi! Vi que você se interessou pela Progressiva. Posso te ajudar?",
    );
    expect(r.text).not.toMatch(/analysis|response/i);
  });

  it("handles unclosed <thought> defensively (discards trailing leak)", () => {
    const raw = "Deixa eu ver...\n<thought>preciso conferir o estoque e o frete pra";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Deixa eu ver...");
    expect(r.text).not.toMatch(/thought/i);
  });

  it("does NOT strip legit '<' in math/price comparisons or emoticons", () => {
    const raw = "Se o pedido for <200 não fecha; acima disso sim. <3 valeu!";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  // ============================================================
  // Passo 1f — NARRAÇÃO DE MÍDIA ENTRE COLCHETES
  // Texto pt-BR: sem `<...>`, sem JSON, sem "action", sem namespace.
  // Payloads copiados verbatim de conversation_messages em PROD.
  // ============================================================

  it("strips the exact Forever Bella bracket leak (2026-09-01, chegou no WhatsApp do lead)", () => {
    const raw =
      "[Enviando Banho de Verniz - PRODUTO 1.png]  \n" +
      "[Enviando Banho de Verniz - EXPLICACAO 1.png] O Banho de Verniz é perfeito " +
      "para reconstruir e dar brilho, com ativos que fortalecem e protegem. " +
      "Quer que eu te mande o modo de uso completo?";
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe(
      "O Banho de Verniz é perfeito para reconstruir e dar brilho, com ativos que " +
        "fortalecem e protegem. Quer que eu te mande o modo de uso completo?",
    );
    expect(r.text).not.toContain("[");
    expect(r.text).not.toContain(".png");
    expect(r.droppedBlocks).toBe(2);
  });

  it("recovers the announced file name so the engine can actually send it", () => {
    const raw = "[Enviando Banho de Verniz - PRODUTO 1.png] Olha que lindo!";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toEqual({
      file_name: "Banho de Verniz - PRODUTO 1.png",
    });
  });

  it("strips bracket narration with no file name at all (2026-08-06)", () => {
    const raw =
      "[Enviando imagem dos modelos BP MINI e BP INOX 8,5L] Aqui estão os modelos " +
      "BP MINI 4,7L e BP INOX 8,5L.";
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe("Aqui estão os modelos BP MINI 4,7L e BP INOX 8,5L.");
    expect(r.recoveredMediaByName).toBeNull();
    expect(r.droppedBlocks).toBe(1);
  });

  it("strips the catalog label form `[video] Arquivo.mp4` (2026-08-06)", () => {
    const raw = "[video] Video BP FARINA em ação.mp4 Aqui está o vídeo da BP FARINA!";
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe("Aqui está o vídeo da BP FARINA!");
    expect(r.text).not.toContain(".mp4");
    expect(r.droppedBlocks).toBe(1);
  });

  it("keeps the file name intact when the label is also the first word of the file", () => {
    const raw = "[video] Video BP FARINA em ação.mp4";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toEqual({
      file_name: "Video BP FARINA em ação.mp4",
    });
  });

  it("drops the media-type word that follows the verb (`[Enviando imagem X.png]`)", () => {
    const raw = "[Enviando imagem Kit Reconstrutor - PRODUTO 1.png]";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toEqual({
      file_name: "Kit Reconstrutor - PRODUTO 1.png",
    });
  });

  it("strips the bare catalog label `[imagem]` used as a narration marker", () => {
    const raw = "Olha só [imagem] que resultado!";
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe("Olha só que resultado!");
  });

  it("strips `[Anexo: catalogo.pdf]` (verb form with colon)", () => {
    const raw = "Segue tudo. [Anexo: catalogo.pdf]";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Segue tudo.");
    expect(r.recoveredMediaByName).toEqual({ file_name: "catalogo.pdf" });
  });

  it("does NOT eat a markdown link whose label starts with a send verb", () => {
    const raw = "[Enviar pedido](https://loja.com/checkout) é só clicar aí.";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("does NOT eat a markdown image `![imagem](url)`", () => {
    const raw = "Olha: ![imagem](https://cdn.site.com/a.png)";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("does NOT eat legitimate bracketed text that is not media narration", () => {
    const raw = "O prazo [conforme combinado] é de 5 dias úteis. [Obs: sem frete]";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("does NOT eat a bracket whose closing ] is only on the next line", () => {
    const raw = "Enviar amanhã:\n[enviar\ntudo junto]";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("does not disturb text with no brackets at all (fast path)", () => {
    const raw = "Bom dia! O Banho de Verniz custa R$ 89,90 e o frete sai grátis.";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("does not overwrite a recoveredMediaByName already captured from a call-tag", () => {
    const raw =
      "<send_media(file='Tamanhos.jpeg')>\n[Enviando Outro Arquivo.png] pronto!";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredMediaByName).toEqual({ file_name: "Tamanhos.jpeg" });
    expect(r.text).toBe("pronto!");
  });

  it("strips narration exposed only after a tool_call block is removed (defensive pass)", () => {
    const raw =
      '<tool_call>{"tool_name":"send_document","tool_arguments":{}}</tool_call>[Enviando Foto.png]';
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe("");
  });
});

describe("splitByDelimiter", () => {
  it("splits on canonical ||SPLIT||", () => {
    expect(splitByDelimiter("a ||SPLIT|| b ||SPLIT|| c")).toEqual(["a", "b", "c"]);
  });

  it("splits on lowercase ||split|| (case tolerant)", () => {
    expect(splitByDelimiter("a ||split|| b")).toEqual(["a", "b"]);
  });

  it("tolerates whitespace variation || SPLIT ||", () => {
    expect(splitByDelimiter("a || SPLIT || b")).toEqual(["a", "b"]);
  });

  // Incidente Forever Bella/Bia 2026-07-14: LLM truncou o token no meio e
  // ||SPL|| vazou cru no balão do lead Kaylane (não bateu no split literal).
  it("splits on front-truncated ||SPL|| (LLM stopped mid-token)", () => {
    expect(
      splitByDelimiter("Quer que eu te explique como funciona? ||SPL|| Assim, te mostro os preços."),
    ).toEqual(["Quer que eu te explique como funciona?", "Assim, te mostro os preços."]);
  });

  it("splits on other truncated variants ||SPLI|| / ||SPLITT|| / |||SPLIT|||", () => {
    expect(splitByDelimiter("a ||SPLI|| b")).toEqual(["a", "b"]);
    expect(splitByDelimiter("a ||SPLITT|| b")).toEqual(["a", "b"]);
    expect(splitByDelimiter("a |||SPLIT||| b")).toEqual(["a", "b"]);
  });

  it("does NOT eat legitimate double-pipe text (no 'spl' stem)", () => {
    expect(splitByDelimiter("custa R$10 || R$20 no varejo")).toEqual([
      "custa R$10 || R$20 no varejo",
    ]);
  });

  it("returns single-element array when no delimiter", () => {
    expect(splitByDelimiter("just text")).toEqual(["just text"]);
  });

  it("drops empty chunks", () => {
    expect(splitByDelimiter("||SPLIT||a||SPLIT||")).toEqual(["a"]);
  });

  it("splits on paragraph breaks (\\n\\n) into separate bubbles", () => {
    expect(
      splitByDelimiter("Que bom que gostou, Gabriel!\n\nTenho sim a foto. Qual prefere?"),
    ).toEqual(["Que bom que gostou, Gabriel!", "Tenho sim a foto. Qual prefere?"]);
  });

  it("does NOT split on a single newline (stays one bubble)", () => {
    expect(splitByDelimiter("linha 1\nlinha 2")).toEqual(["linha 1\nlinha 2"]);
  });

  it("combines ||SPLIT|| and paragraph breaks", () => {
    expect(splitByDelimiter("a\n\nb ||SPLIT|| c\n\n\nd")).toEqual(["a", "b", "c", "d"]);
  });
});
