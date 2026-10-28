import { useState } from "react";
import { Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBrDocument, onlyDigits } from "../../lib/document";
import {
  adicionarCnpj,
  removerDocumento,
  renomearDocumento,
  tornarPrincipal,
  type DocumentoEditado,
  type LeadDocumentItem,
  type ResultadoDaEdicao,
} from "../../lib/lead-documents";

/**
 * Outros CNPJ do lead — o campo CPF / CNPJ virou lista.
 *
 * A linha "CPF / CNPJ" logo acima continua sendo o documento PRINCIPAL (é a que
 * edita o principal, como sempre). Aqui moram os demais CNPJ do mesmo cliente,
 * cada um com rótulo ("Filial Sul"). Marcar um como principal troca com o
 * principal atual, que vira extra.
 *
 * Os extras só existem no Torque: não vão ao Toth e nunca casam cliente, pedido
 * ou cobrança. Um lead tem 1 CPF OU vários CNPJ; com CPF a lista não abre.
 *
 * Quem tem o banco (`LeadCardContainer`) entrega `onSalvar`; este bloco só
 * monta a lista nova e pede para gravar. A recusa do banco (duplicado na org,
 * sem permissão) volta como erro e fica na tela.
 */
const ROTULO = "text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground";
const ACAO =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Máscara enquanto digita: só CNPJ completo ganha pontuação; antes disso, dígitos. */
function mascararCnpj(valor: string): string {
  const d = onlyDigits(valor).slice(0, 14);
  return d.length === 14 ? (formatBrDocument(d) ?? d) : d;
}

export function LeadCardDocumentos({
  documentos,
  podeEditar,
  onSalvar,
}: {
  documentos: LeadDocumentItem[];
  podeEditar: boolean;
  onSalvar: (lista: DocumentoEditado[]) => Promise<void>;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const [rotulo, setRotulo] = useState("");
  const [renomeando, setRenomeando] = useState<{ id: string; valor: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const extras = documentos.filter((d) => !d.isPrimary);
  const temCpf = documentos.some((d) => d.document.length === 11);
  const podeAdicionar = podeEditar && !temCpf;

  async function aplicar(resultado: ResultadoDaEdicao | DocumentoEditado[]): Promise<boolean> {
    if (!Array.isArray(resultado) && !resultado.ok) {
      setErro(resultado.erro);
      return false;
    }
    const lista = Array.isArray(resultado) ? resultado : resultado.lista;
    setErro(null);
    setSalvando(true);
    try {
      await onSalvar(lista);
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o documento");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarAdicao() {
    if (await aplicar(adicionarCnpj(documentos, cnpj, rotulo))) {
      setAdicionando(false);
      setCnpj("");
      setRotulo("");
    }
  }

  async function confirmarRotulo() {
    if (!renomeando) return;
    if (await aplicar(renomearDocumento(documentos, renomeando.id, renomeando.valor))) setRenomeando(null);
  }

  if (extras.length === 0 && !podeAdicionar) return null;

  return (
    <div className="flex flex-col gap-1.5 pb-1 pl-0.5" data-testid="lead-card-documentos">
      {(extras.length > 0 || adicionando) && <h4 className={ROTULO}>Outros CNPJ</h4>}

      {extras.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {extras.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-[13px]">
              <span className="font-semibold tabular-nums text-foreground">{formatBrDocument(d.document)}</span>
              {renomeando?.id === d.id ? (
                <Input
                  autoFocus
                  value={renomeando.valor}
                  maxLength={120}
                  disabled={salvando}
                  placeholder="Rótulo"
                  aria-label={`Rótulo do CNPJ ${formatBrDocument(d.document)}`}
                  onChange={(e) => setRenomeando({ id: d.id, valor: e.target.value })}
                  onBlur={confirmarRotulo}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void confirmarRotulo();
                    if (e.key === "Escape") setRenomeando(null);
                  }}
                  className="h-7 min-w-0 flex-1 text-[12.5px]"
                />
              ) : (
                <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", d.label ? "text-muted-foreground" : "text-muted-foreground/45")}>
                  {d.label ?? "Sem rótulo"}
                </span>
              )}
              {podeEditar && (
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className={ACAO}
                    disabled={salvando}
                    title="Renomear"
                    aria-label={`Renomear o CNPJ ${formatBrDocument(d.document)}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setRenomeando({ id: d.id, valor: d.label ?? "" })}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={ACAO}
                    disabled={salvando}
                    title="Tornar principal"
                    aria-label={`Tornar principal o CNPJ ${formatBrDocument(d.document)}`}
                    onClick={() => void aplicar(tornarPrincipal(documentos, d.id))}
                  >
                    <Star className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={cn(ACAO, "hover:bg-destructive/10 hover:text-destructive")}
                    disabled={salvando}
                    title="Remover"
                    aria-label={`Remover o CNPJ ${formatBrDocument(d.document)}`}
                    onClick={() => void aplicar(removerDocumento(documentos, d.id))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {adicionando && (
        <div className="flex flex-col gap-1.5" data-testid="lead-card-documentos-form">
          <div className="grid grid-cols-[1fr_1fr] gap-1.5">
            <Input
              autoFocus
              inputMode="numeric"
              value={cnpj}
              disabled={salvando}
              placeholder="00.000.000/0000-00"
              aria-label="CNPJ"
              onChange={(e) => setCnpj(mascararCnpj(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmarAdicao();
                if (e.key === "Escape") setAdicionando(false);
              }}
              className="h-8 text-[12.5px] tabular-nums"
            />
            <Input
              value={rotulo}
              maxLength={120}
              disabled={salvando}
              placeholder="Rótulo (opcional)"
              aria-label="Rótulo do CNPJ"
              onChange={(e) => setRotulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmarAdicao();
                if (e.key === "Escape") setAdicionando(false);
              }}
              className="h-8 text-[12.5px]"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" disabled={salvando} onClick={() => { setAdicionando(false); setErro(null); }}>
              Cancelar
            </Button>
            <Button type="button" size="sm" disabled={salvando || onlyDigits(cnpj).length === 0} onClick={() => void confirmarAdicao()}>
              {salvando && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
              Adicionar
            </Button>
          </div>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-[12px] text-destructive">
          {erro}
        </p>
      )}

      {podeAdicionar && !adicionando && (
        <button
          type="button"
          onClick={() => { setAdicionando(true); setErro(null); }}
          className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" aria-hidden />
          Adicionar CNPJ
        </button>
      )}
    </div>
  );
}
