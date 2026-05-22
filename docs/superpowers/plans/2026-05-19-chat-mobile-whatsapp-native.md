## Problem Statement

O chat mobile do Torque CRM está inutilizável. Na lista de conversas, 40% da tela é chrome (navbar + instance selector + search + filtros + tabs + bottom nav). Na thread, double header + triple bottom bar (quick actions + compositor + bottom nav) deixam apenas 35% da tela para mensagens. A bubble de chat é bugada no mobile. A experiência é "desktop shrunk" — não se sente nativo.

Vendedores B2B usam o celular entre visitas para responder WhatsApp. Precisam de uma experiência que se sinta como WhatsApp nativo, não como um CRM desktop encolhido.

## Solution

Redesenhar o chat mobile como experiência fullscreen WhatsApp-native. Lista de conversas com avatar + preview + chips CRM sutis. Thread fullscreen sem navbar nem bottom nav. Compositor contextual (vazio=mic, texto=send). Transições slide horizontal com swipe-back. Bubble desativada no mobile.

## User Stories

1. As a vendedor mobile, I want the chat list to show avatar + name + message preview + timestamp, so that I can quickly scan conversations like WhatsApp
2. As a vendedor mobile, I want to see a pipeline stage chip on each conversation, so that I know the lead's status without opening the thread
3. As a vendedor mobile, I want an AI badge on conversations handled by copilot, so that I know which ones need human attention
4. As a vendedor mobile, I want to filter conversations with horizontal chips (Todas/Não lidas/Grupos), so that I can find what I need in 1 tap
5. As a vendedor mobile, I want a compact instance selector in the header, so that I can switch WhatsApp numbers without losing screen space
6. As a vendedor mobile, I want the navbar hidden on the chat page, so that conversations get maximum vertical space
7. As a vendedor mobile, I want the bottom nav hidden when I'm in a thread, so that the chat feels fullscreen like WhatsApp
8. As a vendedor mobile, I want a minimal thread header (back + avatar + name only), so that messages get maximum space
9. As a vendedor mobile, I want to tap the thread header to open the lead's detail sheet, so that I can check lead info without leaving chat
10. As a vendedor mobile, I want the composer to show a mic button when empty and a send button when I type, so that it works exactly like WhatsApp
11. As a vendedor mobile, I want a "+" button that reveals actions (template, attach, schedule, camera), so that I have quick actions without cluttering the composer
12. As a vendedor mobile, I want to tap-hold the mic to record audio, so that I can send voice messages quickly
13. As a vendedor mobile, I want slide-left animation when opening a thread and swipe-right to go back, so that navigation feels native
14. As a vendedor mobile, I want the search bar to filter conversations by name or phone number, so that I can find a specific lead fast
15. As a vendedor mobile, I want unread count badges on conversations, so that I know which ones need attention
16. As a vendedor mobile, I want the chat bubble hidden on mobile, so that it doesn't overlap with the bottom nav or other UI elements
17. As a vendedor mobile, I want archived conversations as an item at the top of the list (not a separate tab), so that the UI is cleaner
18. As a vendedor mobile, I want smooth momentum scrolling in the conversation list, so that browsing many conversations feels native
19. As a vendedor mobile, I want the bottom nav to reappear when I go back to the conversation list, so that I can navigate to other sections
20. As a vendedor mobile, I want message bubbles properly sized for mobile width, so that long messages don't create horizontal scroll
21. As a vendedor mobile, I want the keyboard to push the composer up without hiding behind the bottom nav, so that I can always see what I'm typing
22. As a vendedor mobile, I want the "Não lidas" chip to show unread count, so that I know how many conversations need attention
23. As a vendedor mobile, I want the conversation list to virtualize on mobile for 200+ contacts, so that scrolling stays smooth

## Implementation Decisions

### Module A — MobileChatFullscreen
- Rewrite MobileChatLayout as fullscreen 2-state component (list / thread)
- List state: fullscreen with compact header (instance pill + search + chips). Bottom nav visible.
- Thread state: fullscreen with minimal header. Navbar AND bottom nav hidden.
- Slide horizontal animation (Framer Motion): list exits left, thread enters right, 220ms, ease curve
- Swipe-back gesture: drag-x on thread, 80px threshold + 300px/s velocity triggers back
- ChatShellWithContext renders MobileChatFullscreen (not MobileChatLayout) when isMobile
- Thread hide mechanism: expose `isChatThreadOpen` via React context, consumed by MainLayout and MobileBottomNav

### Module B — MobileConversationRow
- New presentational component replacing ConversationListItem on mobile
- Layout: 56px row — avatar (40px circular, initials) | name + timestamp (top), preview + unread badge (bottom) | chip stage + AI badge
- Unread badge: amber circle with count, right-aligned, like WhatsApp
- Stage chip: small colored pill (e.g., "Abordado") from lead's pipe_whatsapp status
- AI badge: small bot icon when conversation has active copilot
- Timestamp: "HH:MM" today, "Ontem" yesterday, "DD/MM" older
- No inline 3-dot menu on mobile — long-press for context menu (archive, tags)
- Props: ChatContact + stage info + AI status, onPress, onLongPress

### Module C — MobileChatListHeader
- Compact header replacing current 4-line filter stack
- Row 1: Back/logo area + instance selector pill (dot + short name + chevron) + search icon toggle
- Row 2: Horizontal scrollable chips — "Todas" | "Não lidas (N)" | "Grupos (N)"
- Search: expands from icon to full-width input with animation, auto-focus
- "Arquivadas" shown as first item in list (like WhatsApp) not as tab
- Instance selector opens bottom sheet with all instances + status indicators

### Module D — MobileChatThreadHeader
- Minimal: height 48px. Back arrow (left) + avatar (32px) + name (truncated) + online dot
- Tap anywhere on header (except back) opens lead detail bottom sheet via useLeadSheet
- If no lead linked: shows phone number, tap opens "Create lead" action
- No AI toggle, no density toggle, no sync button, no takeover controls — all moved to lead sheet or removed from mobile

### Module E — MobileComposerContextual
- State machine: IDLE (empty input) / TYPING (has text) / RECORDING (audio)
- IDLE: "+" button left, input center, mic button right
- TYPING: "+" button left, input center, send button right (mic replaced)
- RECORDING: waveform visualization, timer, send/cancel buttons
- "+" button opens action tray (Framer Motion slide-up): 4 icons in a row — Camera, File, Template, Schedule
- Template action triggers existing slash command popover
- Schedule action opens ScheduleMessageModal
- File action triggers file input
- Camera action triggers file input with accept="image/*,video/*" + capture
- Keyboard offset from useKeyboardOffset applied to entire compositor area
- No ChatQuickActions row above input — everything consolidated into "+" tray and contextual buttons

### Module F — ChatBubbleMobileGate
- In ChatBubble component: early return null when useViewport().isMobile
- Prevents FAB rendering, lazy-load, and all bubble state management on mobile

### Module G — NavbarThreadHide
- New React context: MobileChatContext with `{ isChatThreadOpen: boolean }`
- MobileChatFullscreen provides this context based on selectedPhone state
- MainLayout consumes context: if isChatThreadOpen && isMobile, hide TopNavigation
- MobileBottomNav consumes context: if isChatThreadOpen, render null
- Chat page (/chat-whatsapp) on mobile: MainLayout also hides navbar when route matches + isMobile (even in list state, to give max space)

### Breakpoint unification
- All chat mobile code uses useViewport() hook (768px) — remove hardcoded 780px from ConversationList
- Single source of truth for mobile detection

### ConversationList virtualization on mobile
- Remove the `!isMobile` gate from shouldVirtualize
- Mobile uses overscan=5 (same as MessageList mobile setting)

## Testing Decisions

Good tests verify behavior through public interfaces — what the user sees and does, not implementation details. A test should survive internal refactors.

### Module A — MobileChatFullscreen (unit + integration)
- Renders list when no selectedPhone
- Renders thread when selectedPhone is set
- Back action clears selectedPhone and shows list
- Exposes isChatThreadOpen context correctly
- Prior art: tests/unit/use-viewport.test.ts (mock viewport)

### Module B — MobileConversationRow (unit)
- Renders name, preview, timestamp, unread badge
- Shows stage chip when stage data present
- Shows AI badge when copilot active
- Fires onPress / onLongPress callbacks
- Prior art: src/components/lead-detail/modal/__tests__/gates-applied.test.tsx

### Module E — MobileComposerContextual (unit)
- Shows mic button when input empty
- Shows send button when input has text
- "+" opens action tray
- Send fires onSend with message text
- Mic triggers recording state
- Prior art: tests/unit/use-push-subscription.test.ts (state machine testing)

## Out of Scope

- Desktop chat layout changes — this PRD is mobile-only
- Message bubble redesign — current bubbles are acceptable on mobile
- Read receipts / typing indicators — separate feature
- Voice message transcription — future enhancement
- Chat search within messages (message-level search) — separate feature
- Group chat specific UI — groups use same list/thread as 1:1
- Offline message queueing — requires service worker integration beyond current scope
- Push notification deep-linking to specific conversation — separate from UI
- Audio recording waveform visualization — nice-to-have, can be plain timer initially
- Context panel / lead detail within chat — uses existing lead sheet (bottom sheet)

## Further Notes

- The existing MobileChatLayout has good Framer Motion animation foundation — refine, don't rewrite from scratch
- ChatComposer is 600+ lines — the mobile compositor should be a new component that reuses hooks (useWhatsAppSend, useConversationDraft, AudioRecorder) but not the desktop UI
- ConversationListItem is used by both desktop and mobile today — new MobileConversationRow coexists, selected by viewport
- ChatBubblePanel (the popup chat) actually has good mobile UX (screenshots confirm) but conflicts with full chat page on mobile — correct decision to gate it out
- Instance selector in ChatBubblePanel (ChatBubbleInstanceSwitcher) is a good reference for compact instance pill
- The 780px hardcoded breakpoint in ConversationList must be replaced with useViewport() for consistency
