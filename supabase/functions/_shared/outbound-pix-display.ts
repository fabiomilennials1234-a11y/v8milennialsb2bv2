/** Display-only fields. Never store the complete request or provider credentials. */
export function outboundPixDisplay(input?: { pixkey?: string; merchantName?: string; pixkeyType?: string }) {
 return input?.pixkey && input.merchantName ? { sendPayload: { pixKey: input.pixkey, pixName: input.merchantName, pixType: input.pixkeyType } } : undefined;
}
