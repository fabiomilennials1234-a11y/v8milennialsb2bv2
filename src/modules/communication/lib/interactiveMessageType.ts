export function isInteractiveResponseType(type: string | null): boolean {
  return ["button_response", "buttonResponse", "buttonResponseMessage", "list_response", "listResponse", "listResponseMessage", "poll_update", "pollUpdate", "pollUpdateMessage"].includes(type ?? "");
}

