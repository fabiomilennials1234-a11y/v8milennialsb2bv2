import { parseLocation } from './rich-message-input';

/** Universal Maps URL: app on mobile when available, browser on desktop. */
export function googleMapsUrl(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/** Reads both the webhook's persisted coordinates and the composer's Maps URL. */
export function readLocationMapsLink(content: string | null) {
  const lines = (content ?? '').trim().split(/\r?\n/);
  const lastLine = lines.at(-1)?.trim() ?? '';
  let coordinates = lastLine.replace(/^📍\s*/, '');

  if (lastLine.startsWith('https://')) {
    try {
      const url = new URL(lastLine);
      if (url.hostname !== 'www.google.com' || url.port || url.username || url.password) return null;
      if (/^\/maps\/?$/.test(url.pathname)) coordinates = url.searchParams.get('q') ?? '';
      else if (/^\/maps\/search\/?$/.test(url.pathname) && url.searchParams.get('api') === '1') {
        coordinates = url.searchParams.get('query') ?? '';
      } else return null;
    } catch { return null; }
  }

  const parts = coordinates.split(',');
  if (parts.length !== 2) return null;
  try {
    const point = parseLocation(parts[0], parts[1]);
    const mapsUrl = googleMapsUrl(point.latitude, point.longitude);
    return mapsUrl ? { mapsUrl, description: lines.slice(0, -1).join('\n') } : null;
  } catch { return null; }
}

export function isLocationMessageType(messageType: string | null): boolean {
  return ['location', 'locationmessage', 'livelocation', 'livelocationmessage'].includes(messageType?.toLowerCase() ?? '');
}
