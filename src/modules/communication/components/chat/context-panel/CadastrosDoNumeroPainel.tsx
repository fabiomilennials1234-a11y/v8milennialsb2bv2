import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useFeatureFlag } from "@/modules/platform/feature-flags";
import {
  FLAG_CADASTROS_DO_NUMERO,
  deveMostrarCadastros,
  useCadastrosNaConversa,
  type CadastroNaConversa,
} from "@/modules/communication/hooks/chat/useCadastrosNaConversa";
import { CadastrosDoNumeroLista } from "./CadastrosDoNumeroLista";

interface Props {
  telefone: string | null | undefined;
  leadIdDaConversa: string | null | undefined;
  isGroup?: boolean;
  fallback?: ReactNode;
  /** Rascunho: consultar antes do primeiro envio, sem criar ou vincular. */
  somenteConsulta?: boolean;
  /** A vinculação é fornecida pelo contexto existente, sem importar a ficha do lead. */
  renderSemLead?: (cadastros: CadastroNaConversa[]) => ReactNode;
  children?: ReactNode;
}

function useCadastrosVisiveis({
  telefone,
  leadIdDaConversa,
  isGroup = false,
}: Props) {
  const { enabled } = useFeatureFlag(FLAG_CADASTROS_DO_NUMERO);
  const { data: cadastros = [] } = useCadastrosNaConversa(
    telefone,
    enabled && !isGroup,
  );
  const visivel =
    enabled &&
    deveMostrarCadastros({
      cadastros: cadastros.length,
      conversaTemLead: !!leadIdDaConversa,
      isGroup,
    });
  return { cadastros, visivel };
}

/** Na aba Infos do desktop; no celular, dentro do painel aberto pelo cabeçalho. */
export function CadastrosDoNumeroPainel(props: Props) {
  const { cadastros, visivel } = useCadastrosVisiveis(props);
  if (!visivel) return props.fallback ?? null;
  if (
    !props.leadIdDaConversa &&
    !props.somenteConsulta &&
    props.renderSemLead
  ) {
    return props.renderSemLead(cadastros);
  }
  return (
    <CadastrosDoNumeroLista
      cadastros={cadastros}
      leadIdDaConversa={props.leadIdDaConversa ?? null}
    />
  );
}

/** Acesso lateral quando não há coluna de contexto: celular ou rascunho desktop. */
export function CadastrosDoNumeroAcesso(props: Props) {
  const { cadastros, visivel } = useCadastrosVisiveis(props);
  if (!visivel) return null;
  return (
    <Sheet key={props.telefone}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 rounded-full px-2"
          aria-label={`Ver ${cadastros.length} cadastros deste número`}
        >
          <Users className="h-4 w-4" aria-hidden />
          <span className="text-xs tabular-nums">{cadastros.length}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[calc(100%_-_1rem)] max-w-sm p-4">
        <SheetHeader className="mb-5 pr-8 text-left">
          <SheetTitle>Cadastros deste número</SheetTitle>
          <SheetDescription>
            Consulte os clientes e negócios relacionados a esta conversa.
          </SheetDescription>
        </SheetHeader>
        {props.children ?? <CadastrosDoNumeroPainel {...props} />}
      </SheetContent>
    </Sheet>
  );
}
