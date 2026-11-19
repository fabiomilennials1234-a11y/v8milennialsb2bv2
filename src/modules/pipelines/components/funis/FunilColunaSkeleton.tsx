import { Osso, useFaseEspera } from "@/shared/espera";

/** Quantos cards-esqueleto uma coluna mostra enquanto a 1ª página não chega. */
const CARDS_DO_ESQUELETO = 3;

/** Um card do funil (densidade compacta) em osso: nome, empresa, valor · tempo. */
export function CardDoFunilEmOsso() {
  return (
    <div
      aria-hidden
      data-testid="card-em-osso"
      className="flex flex-col gap-2 rounded-[14px] border border-card-border bg-card p-3 shadow-relevo"
    >
      <Osso className="h-3 w-3/4" />
      <Osso className="h-2.5 w-1/2" />
      <div className="mt-1 flex items-center justify-between">
        <Osso className="h-2.5 w-16" />
        <Osso className="h-2.5 w-8" />
      </div>
    </div>
  );
}

/**
 * Corpo de uma coluna do Funil enquanto a 1ª página dela não chega — a régua
 * aplicada por coluna (cada coluna pagina sozinha):
 *   < 100 ms   nada (a coluna já tem altura mínima; não pisca)
 *   ≥ 100 ms   cards em osso com a forma do card real
 *   ≥ 1 s      a frase, se esta coluna for a que fala pelo board (uma só, para
 *              o leitor de tela não ouvir a mesma frase por etapa)
 *   fim        o osso cumpre 300 ms antes de dar lugar aos cards
 */
export function FunilColunaSkeleton({
  carregando,
  frase,
}: {
  carregando: boolean;
  /** Só a 1ª coluna em espera fala; as outras ficam caladas. */
  frase?: string;
}) {
  const { fase, segurando } = useFaseEspera(carregando);
  if (!carregando && !segurando) return null;
  const visivel = fase !== "oculta";

  return (
    <div
      data-testid="funil-coluna-skeleton"
      data-espera={fase}
      aria-busy="true"
      className="flex flex-col gap-2.5 px-2.5 pb-2.5"
    >
      {visivel &&
        Array.from({ length: CARDS_DO_ESQUELETO }, (_, i) => <CardDoFunilEmOsso key={i} />)}
      {frase !== undefined && (
        <p aria-live="polite" className="flex min-h-[18px] items-center gap-2 px-1 text-[12px] text-muted-foreground">
          {fase === "skeleton+frase" && (
            <>
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-novo-pulso motion-reduce:animate-none"
              />
              {frase}
            </>
          )}
        </p>
      )}
    </div>
  );
}
