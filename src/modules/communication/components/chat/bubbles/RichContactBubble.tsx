import { Contact, Copy, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { parseLocation } from '@/modules/communication/lib/rich-message-input';

export function RichContactBubble({ content, location }: { content: string | null; location: boolean }) {
  const lines = (content ?? '').split('\n');
  const match = location ? /^https:\/\/www\.google\.com\/maps\?q=([+-]?[\d.]+),([+-]?[\d.]+)$/.exec(lines.at(-1) ?? '') : null;
  let mapsUrl: string | null = null;
  if (match) {
    try { const point = parseLocation(match[1], match[2]); mapsUrl = `https://www.google.com/maps?q=${point.latitude},${point.longitude}`; } catch { /* malformed coordinates remain plain text */ }
  }
  const phone = !location && /^\d{8,15}$/.test(lines[1] ?? '') ? lines[1] : null;
  return <div className="space-y-2 rounded-lg border border-current/20 p-3 text-sm">
    <div className="flex items-center gap-2 text-xs opacity-75">
      {location ? <MapPin className="h-4 w-4" /> : <Contact className="h-4 w-4" />}
      {location ? 'Localização' : 'Contato'}
    </div>
    <p className="whitespace-pre-wrap break-words">{(mapsUrl ? lines.slice(0, -1).join('\n') : content) || (location ? 'Localização compartilhada' : 'Contato compartilhado')}</p>
    {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center underline underline-offset-4">Abrir no mapa</a>}
    {phone && <button type="button" className="flex min-h-9 items-center gap-2 text-xs" onClick={async () => {
      try { await navigator.clipboard.writeText(phone); toast.success('Telefone copiado'); }
      catch { toast.error('Não foi possível copiar o telefone'); }
    }}><Copy className="h-3.5 w-3.5" />Copiar telefone</button>}
  </div>;
}
