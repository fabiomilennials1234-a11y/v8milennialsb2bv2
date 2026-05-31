/**
 * message-debounce — Copilot v2 fragment coalescing.
 *
 * Pure. Groups inbound fragments that arrive within `debounceMs` of each other
 * into a single message so the cognition layer runs one turn per burst, not one
 * per fragment. Blank fragments are dropped from the joined content; ordering is
 * normalized chronologically.
 */

export interface InboundFragment {
  content: string;
  timestamp: string;
}

export interface CoalescedMessage {
  content: string;
  fragmentCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

export function coalesceFragments(
  fragments: InboundFragment[],
  debounceMs: number,
): CoalescedMessage[] {
  if (fragments.length === 0) return [];

  const sorted = [...fragments].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const groups: InboundFragment[][] = [];
  let current: InboundFragment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const gap = new Date(sorted[i].timestamp).getTime() - new Date(prev.timestamp).getTime();
    if (gap <= debounceMs) {
      current.push(sorted[i]);
    } else {
      groups.push(current);
      current = [sorted[i]];
    }
  }
  groups.push(current);

  return groups
    .map((group) => ({
      content: group
        .map((f) => f.content.trim())
        .filter((c) => c.length > 0)
        .join(" "),
      fragmentCount: group.length,
      firstTimestamp: group[0].timestamp,
      lastTimestamp: group[group.length - 1].timestamp,
    }))
    // A burst of only-blank fragments yields no message — never emit an empty turn.
    .filter((m) => m.content !== "");
}
