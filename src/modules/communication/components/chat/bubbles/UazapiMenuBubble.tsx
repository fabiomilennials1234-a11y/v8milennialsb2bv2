import type { readUazapiMenu } from "@/modules/communication/lib/uazapiMenuDisplay";

export function UazapiMenuBubble({ menu, fallbackText }: { menu: NonNullable<ReturnType<typeof readUazapiMenu>>; fallbackText: string | null }) {
  return <div className="space-y-2 text-sm">
    {menu.title && <p className="font-medium break-words">{menu.title}</p>}
    <p className="whitespace-pre-wrap break-words">{menu.description || fallbackText}</p>
    <details className="rounded-md border border-current/20 p-2">
      <summary className="cursor-pointer font-medium">{menu.button}</summary>
      <div className="mt-2 space-y-3" aria-label="Opções da lista">
        {menu.sections.map((section, index) => <div key={index}>
          {section.title && section.title !== menu.button && <p className="text-xs opacity-70 mb-1">{section.title}</p>}
          <ul className="space-y-1">
            {section.rows.map((row, rowIndex) => <li key={rowIndex} className="rounded bg-background/15 px-2 py-1.5 break-words">
              <span className="font-medium">{row.title}</span>
              {row.description && <p className="text-xs opacity-70">{row.description}</p>}
            </li>)}
          </ul>
        </div>)}
      </div>
    </details>
    {menu.footer && <p className="text-xs opacity-70 break-words">{menu.footer}</p>}
  </div>;
}
