/**
 * InboxEnrichmentNotice — o que a lista mostra quando NÃO dá pra aplicar o filtro.
 *
 * Funil, etapa, qualificação, vendedor, etiqueta e "pediu atendente" não vêm na
 * linha da conversa: dependem de um enriquecimento por lead que pode falhar.
 * Quando falha, o engine do filtro avalia sobre dado vazio e descarta tudo — e o
 * usuário via o empty state normal, indistinguível de "não existe conversa nesse
 * funil". Aqui a diferença aparece.
 *
 * "Limpar filtro" não é enfeite: o recorte é persistido por 30 dias por
 * org+usuário (`useInboxFilterState`), então quem deixou um funil marcado abre o
 * chat vazio todo dia até limpar.
 */
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InboxEnrichmentNoticeProps {
  onRetry: () => void;
  onClear: () => void;
}

export function InboxEnrichmentNotice({ onRetry, onClear }: InboxEnrichmentNoticeProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <AlertTriangle className="mb-4 h-10 w-10 text-amber-500/70" />
      <p className="text-sm font-medium text-foreground">Não deu pra aplicar o filtro</p>
      <p className="mt-1.5 max-w-[26rem] text-xs leading-relaxed text-muted-foreground">
        Os dados que o filtro usa — funil, etapa, vendedor, etiqueta — não carregaram,
        então a lista não pode ser filtrada por eles agora. Isto não quer dizer que não
        há conversas.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry} className="h-8 gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Tentar de novo
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} className="h-8 gap-1.5 text-xs">
          <X className="h-3.5 w-3.5" />
          Limpar filtro
        </Button>
      </div>
    </div>
  );
}
