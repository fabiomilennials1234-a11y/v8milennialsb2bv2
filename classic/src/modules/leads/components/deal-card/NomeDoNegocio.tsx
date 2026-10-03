import { useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** O título tem escrita própria; renomear a pessoa exige uma escolha explícita. */
export function NomeDoNegocio({
  titulo,
  nomeLead,
  onRenomear,
}: {
  titulo: string;
  nomeLead: string;
  onRenomear?: (nome: string, alterarLead: boolean) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(titulo);
  const [perguntando, setPerguntando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const emVoo = useRef(false);
  const nomeValido = nome.trim();

  const cancelar = () => {
    if (emVoo.current) return;
    setEditando(false);
    setPerguntando(false);
    setErro("");
  };

  const salvar = async (alterarLead: boolean) => {
    if (!onRenomear || !nomeValido || emVoo.current) return;
    emVoo.current = true;
    setSalvando(true);
    setErro("");
    try {
      await onRenomear(nomeValido, alterarLead);
      setEditando(false);
      setPerguntando(false);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar o nome. Tente novamente.");
    } finally {
      emVoo.current = false;
      setSalvando(false);
    }
  };

  if (!editando) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className="truncate text-[18px] font-semibold tracking-[-0.02em]" title={titulo}>
          {titulo}
        </h1>
        {onRenomear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Editar nome do negócio"
            title="Editar nome do negócio"
            onClick={() => { setNome(titulo); setEditando(true); }}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="w-full min-w-0 space-y-3"
      data-summary-pending="true"
      onSubmit={(event) => {
        event.preventDefault();
        if (nomeValido && nomeValido !== titulo.trim() && !salvando) setPerguntando(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelar();
        }
      }}
    >
      <Input
        autoFocus
        aria-label="Nome do negócio"
        value={nome}
        disabled={salvando}
        onChange={(event) => { setNome(event.target.value); setPerguntando(false); setErro(""); }}
      />
      {perguntando && (
        <div className="space-y-1 text-sm" aria-live="polite">
          <p className="font-medium">Deseja alterar também o nome do lead?</p>
          <p className="break-words text-muted-foreground">
            O lead “{nomeLead}” passará a se chamar “{nomeValido}” se você escolher “Negócio e lead”.
          </p>
        </div>
      )}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {perguntando ? (
          <>
            <Button type="button" size="sm" disabled={salvando} onClick={() => void salvar(false)}>
              Só o negócio
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={salvando} onClick={() => void salvar(true)}>
              Negócio e lead
            </Button>
          </>
        ) : (
          <Button type="submit" size="sm" disabled={!nomeValido || nomeValido === titulo.trim() || salvando}>
            Salvar nome
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={salvando} onClick={cancelar} aria-label="Cancelar alteração do nome">
          Cancelar
        </Button>
        {salvando && <span role="status" className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Salvando...</span>}
      </div>
    </form>
  );
}
