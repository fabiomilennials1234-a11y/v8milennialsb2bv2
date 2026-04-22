interface UnreadDividerProps {
  count: number;
}

export function UnreadDivider({ count }: UnreadDividerProps) {
  return (
    <div
      className="flex items-center gap-3 py-2 my-1"
      role="separator"
      aria-label={`${count} ${count === 1 ? "mensagem" : "mensagens"} não ${count === 1 ? "lida" : "lidas"}`}
    >
      <div className="flex-1 h-px bg-destructive/30" />
      <span className="text-[10px] font-medium text-destructive uppercase tracking-wider whitespace-nowrap">
        {count} {count === 1 ? "não lida" : "não lidas"}
      </span>
      <div className="flex-1 h-px bg-destructive/30" />
    </div>
  );
}
