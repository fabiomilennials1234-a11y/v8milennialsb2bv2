/**
 * HighlightedText — renderiza HTML com <mark> de forma segura via DOMPurify.
 *
 * C37 (B5): sanitiza headline da RPC search_messages antes de renderizar.
 *
 * Segurança:
 *   - DOMPurify whitelist mínima: apenas <mark>, zero atributos
 *   - Qualquer outro tag/attr é removido antes de chegar ao DOM
 *   - ts_headline já escapa conteúdo server-side, mas nunca confiar só no servidor
 *
 * Uso:
 *   <HighlightedText html={result.headline} className="text-sm" />
 *
 * CSS companion: .search-highlight-scope mark { ... } em src/index.css
 */
import DOMPurify from "dompurify";

// ─── Configuração DOMPurify — whitelist mínima ────────────────────────────────

const SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ["mark"],
  ALLOWED_ATTR: [],
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface HighlightedTextProps {
  /** HTML string com <mark> tags do ts_headline — será sanitizado antes de renderizar */
  html: string;
  className?: string;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function HighlightedText({ html, className }: HighlightedTextProps) {
  const safe = DOMPurify.sanitize(html, SANITIZE_CONFIG) as string;

  return (
    <span
      // search-highlight-scope isola o escopo — não polui <mark> global
      // box-decoration-break: clone aplicado via CSS companion
      className={`search-highlight-scope${className ? ` ${className}` : ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
