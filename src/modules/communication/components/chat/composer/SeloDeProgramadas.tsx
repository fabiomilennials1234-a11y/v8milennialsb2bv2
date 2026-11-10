/**
 * Selo azul no botão Enviar: quantas mensagens programadas esta conversa já
 * tem. Só aparece com a bandeja fechada (quem publica o número é a bandeja,
 * via `composerTrayBus`). Decorativo para leitor de tela — o botão tem
 * `aria-label` próprio e a bandeja já anuncia a fila.
 */
export function SeloDeProgramadas({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden
      data-testid="selo-programadas"
      className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-card bg-scheduled-strong px-[5px] text-[10.5px] font-extrabold tabular-nums leading-none text-scheduled-foreground"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
