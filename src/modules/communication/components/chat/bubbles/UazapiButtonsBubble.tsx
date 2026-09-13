export function UazapiButtonsBubble({ text, options }: { text: string; options: string[] }) {
  return <div className="space-y-3 text-sm">
    <p className="whitespace-pre-wrap break-words">{text}</p>
    <ul aria-label="Botões da mensagem" className="space-y-1.5 border-t border-current/15 pt-2">
      {options.map((option, index) => <li key={index} className="rounded-lg border border-current/20 bg-background/15 px-3 py-2 text-center font-medium break-words">{option}</li>)}
    </ul>
  </div>;
}
