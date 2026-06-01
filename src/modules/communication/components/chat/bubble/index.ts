/**
 * Barrel exports do Chat Bubble Kanban (PR3).
 *
 * Apenas re-exports de superfície pública. ChatBubblePanel é dynamic-imported
 * de dentro de ChatBubble.tsx (não exportar aqui pra preservar o code-split).
 */
export { ChatBubble } from "./ChatBubble";
export { ChatBubbleFab } from "./ChatBubbleFab";
export { ChatBubbleBadge } from "./ChatBubbleBadge";
export { instanceColor } from "./utils/instanceColor";
