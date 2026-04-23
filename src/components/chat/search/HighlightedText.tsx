/**
 * HighlightedText — renderiza texto com <mark> HTML de forma segura.
 *
 * C34 (provisório): renderiza apenas texto puro sem HTML.
 * C37 (B5): substitui por DOMPurify.sanitize com whitelist { ALLOWED_TAGS: ["mark"] }.
 *
 * NUNCA usar dangerouslySetInnerHTML com valor bruto — apenas após sanitização DOMPurify.
 */

interface HighlightedTextProps {
  html: string;
  className?: string;
}

/**
 * Versão provisória (C34): strip HTML, renderiza texto puro.
 * Substituída em C37 com DOMPurify.
 */
export function HighlightedText({ html, className }: HighlightedTextProps) {
  // Strip HTML tags temporariamente — C37 vai usar DOMPurify com <mark> permitido
  const plainText = html.replace(/<[^>]*>/g, "");
  return <span className={className}>{plainText}</span>;
}
