/**
 * interactive-reply — extrai a OPÇÃO escolhida quando o lead responde a uma
 * mensagem de botão/lista interativa.
 *
 * A Uazapi (instância Carol, 2026-07-27) manda essa resposta como
 * `type:"text"` + `text:""` + `messageType:"TemplateButtonReplyMessage"`, com a
 * escolha em `content.selectedDisplayText` / `content.selectedID` e também em
 * top-level `buttonOrListid` / `vote`. O código antigo só olhava campos
 * top-level (`data.selectedDisplayText`, etc.) e a detecção por `messageType`
 * não batia — então a mensagem ficava sem conteúdo e o chat mostrava só o id da
 * msg citada (`[Em resposta a: "3EB0..."]`), inútil pro atendente.
 *
 * Retorna o texto da opção (ex.: "3") ou null se não for uma resposta interativa.
 */
export function extractInteractiveSelection(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const c = (data.content && typeof data.content === "object" ? data.content : {}) as Record<
    string,
    unknown
  >;
  const raw =
    c.selectedDisplayText ??
    c.selectedID ??
    data.buttonOrListid ??
    data.vote ??
    // formas antigas/planas de outros provedores
    data.selected ??
    data.selectedDisplayText ??
    data.selectedButtonId ??
    data.selectedRowId ??
    data.buttonResponse?.selectedDisplayText ??
    data.listResponse?.title ??
    null;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}
