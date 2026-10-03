/**
 * instanceColor — hash determinístico de instance_id → HSL hue.
 *
 * Uso: color-dot 6px à esquerda do nome do contato no Bubble, identificando
 * visualmente de qual instância vem cada conversa quando o usuário tem >1
 * instância permitida. Mesmo instance_id sempre produz a mesma cor.
 *
 * Saturação 70% e lightness 55% mantém contraste em dark e light mode.
 */
export function instanceColor(instanceId: string): string {
  let h = 0;
  for (let i = 0; i < instanceId.length; i++) {
    h = (h * 31 + instanceId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 70% 55%)`;
}
