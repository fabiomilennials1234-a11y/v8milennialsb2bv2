# 22. Chamado attachments hang off the Comentário, not the Chamado

Date: 2026-07-22

## Status

Accepted

Extends ADR-0018, decision 9 (`support-attachments` is a private bucket read through short-lived signed URLs).

## Context

ADR-0018 shipped attachments as a single-purpose affordance: the customer attaches a **screenshot** to a Chamado. The bucket accepts four image types up to 5 MB, the path is `<ticketId>/<uuid>.<ext>`, and every authorization question is answered by deriving the ticket id from the first path segment and asking `can_read_support_ticket()`. The original filename is discarded on purpose — `Proposta Fulano da Silva.png` would carry PII into the signed URL and the Storage access logs, which sit outside RLS.

That design was correct for what it did, and it is load-bearing: the same path-derived authorization is what makes the bucket safe without a metadata table.

Two things it does not do, both now required:

**Torque staff cannot attach anything.** `MasterSupportTickets.tsx` renders the attachment strip with `canAttach={false}`. The Storage INSERT policy already permits master — the block is purely in the React prop. Staff answering "click the button in the top right" cannot show which button.

**Only images are accepted.** A customer reporting a broken spreadsheet import cannot send the spreadsheet. A customer disputing an invoice cannot send the PDF. The evidence that would resolve the Chamado in one turn is the exact evidence the bucket rejects.

Fixing the second without the first would be a MIME-list edit. Fixing both together is not, because attachments from two parties raise a question a single-party design never had to answer: **who sent this, and at what point in the conversation?** Today the strip is a flat, undifferentiated pile at the foot of the thread. With staff attaching too, that pile stops being readable — the master's "here's the fix" screenshot lands in the same heap as the customer's three "here's the bug" screenshots, in no order, with no author.

There is already a correct thing to hang an attachment on. `support_ticket_comments` is the unit of the thread, and the glossary already defends it as such.

## Decision

1. **An Anexo belongs to a Comentário.** A new `support_ticket_attachments` table carries `ticket_id` (NOT NULL), `comment_id` (**nullable**), `path`, `filename`, `mime`, `size_bytes`, `author_user_id`, `created_at`. What the customer sends is a conversation, not a dossier: "send me a screenshot of the error" happens on turn three, and reading that as a strip of thumbnails detached from the text is reading the conversation with its images torn out and stacked at the bottom.

   `comment_id IS NULL` means *attached when the Chamado was opened* — there is no Comentário at that moment, and the Chamado's `description` is a column, not a comment. A null here is honest: that evidence belongs to the Chamado in exactly the way `support_context` does, captured at open time and owned by the ticket rather than by a turn. Manufacturing a synthetic first Comentário to avoid the null would give `description` two sources of truth and silently change what "the first comment" means to every existing query.

2. **Attaching at open time happens after the INSERT, and never rolls it back.** The path and the Storage policy both depend on `ticketId`, so the form holds the chosen files in memory, creates the Chamado, and only then uploads. If an upload fails, the Chamado stands and the user is told which file did not make it. The Chamado *is* the request for help; losing it because an attachment failed would discard the thing that mattered to keep the thing that illustrated it.

3. **The original filename is stored in the table; the path stays a uuid.** The reason to discard the name was never the name — it was the *path*, which travels in the signed URL, the Storage access logs, and the CDN headers, none of which RLS reaches. A column is a different place: it sits under the same policy already protecting the Comentário body, which carries far worse PII. This is not a trade-off resolved in one direction; both properties hold at once.

   `filename` is stored **raw**, with a `CHECK` rejecting control characters and Unicode bidi overrides and a length ceiling. Sanitizing on write destroys the real name; sanitizing on display is a rule that holds only while every future consumer remembers it — and the master panel is merely the first. The guarantee belongs where it cannot be forgotten.

4. **The allowlist is chosen by what is dangerous to *serve*, not by what is useful to send.** `allowed_mime_types` is enforced against a browser-declared `file.type`, which is trivially forged; what it actually pins is the `Content-Type` the file will later be served with. A renamed `.exe` gets in, and it is precisely *because* it is served as `image/png` that it does not execute. The allowlist protects the reader's browser, not the bucket.

   Accepted: the four existing image types, `application/pdf`, `text/csv`, `text/plain`, `.xlsx`, `.docx`. Refused: `.xlsm` and `.docm` (VBA is the real Office vector, and they are distinct MIME types, so the inert formats cost nothing to keep), archives, executables, `text/html` and `image/svg+xml` (both execute JavaScript in the Storage origin — the vector ADR-0018 already names).

5. **25 MB per file; 5 attachments per Comentário; 20 per Chamado.** The per-comment cap is not about storage cost — it is about a thread staying legible to someone triaging forty Chamados in a day. Both caps live in a **trigger**, following `20270120000000_support_ticket_rate_limit.sql`: an INSERT blocked by RLS returns success with zero rows, and a refusal has to be loud. The caps apply symmetrically to staff; a master who needs six screenshots in one reply should be writing a Help Article.

6. **Internal notes may carry attachments, and the path encodes visibility.** `is_internal` is filtered in the comments policy, but attachment authorization is derived from the *path* — so an attachment on a staff-only note would land in `<ticketId>/` and be listed by the customer, who can read the ticket. The internal note's text stays hidden while its evidence leaks.

   Internal attachments therefore go to `<ticketId>/internal/<uuid>.<ext>`, and `can_read_support_attachment()` requires `is_master_user()` for that branch. Authorization stays path-derived — no table lookup.

   This forces a second change: **`is_internal` becomes immutable** by trigger. It is already immutable in fact (the app writes it only at INSERT), but a master flipping it after upload would put the path and the database in silent disagreement, and the disagreement favours disclosure in one direction.

   The alternative — having the policy read the attachments table to find `is_internal` — is the semantically correct design and the wrong one here. The file is uploaded to Storage *before* its row exists; in that window the lookup finds nothing and falls back to the ticket check, and a customer listing at that instant sees the internal attachment. A policy whose correctness depends on write ordering is not a policy.

7. **Only master deletes.** Unchanged from ADR-0018's stance that a Chamado is not deleted. A customer who attaches the wrong file asks staff to remove it; the confirmation dialog says so *before* the upload, since there is no after.

8. **The listing comes from the table; Storage only signs URLs.** `filename`, author, size, and the link to the Comentário exist nowhere else, and `storage.list()` cannot see the `internal/` branch without a second call.

   Deletion is two operations with no transaction between them, so the **row goes first and the object second**. A failure then leaves an orphaned file nobody lists — it costs bytes and is invisible. The reverse order leaves a row pointing at nothing, which the master sees as a broken attachment. When two writes cannot be atomic, the residue belongs on the side nobody reads. At ~30 tenants and master-only deletion this is a handful of files a year; a cleanup cron is noted as known debt rather than built.

9. **Attachments are deleted 90 days after the Chamado reaches `fechado`.** The bucket holds, in ADR-0018's own words, the tenant's leads' names, phones and CNPJs — data subjects who have never heard of Torque and for whom we are operator. LGPD's minimization and purpose-limitation are about *discarding when the purpose ends*, and this purpose ends on a dated event.

   The thread, the history and the row survive; only the file goes, and the row records that retention removed it. Ninety days because `fechado` arrives 7 days after `resolvido` and reopening must remain possible, with room left for a post-mortem on a recurring defect. It runs inside the existing `close_resolved_support_tickets()` pg_cron function — a second step, not new infrastructure, honouring ADR-0018's refusal to add an edge function ("one more edge function is one more secret to rotate").

10. **A Comentário still requires text.** `body TEXT NOT NULL CHECK (length(btrim(body)) > 0)` stands; an attachment accompanies a comment and never replaces one. A turn that is a 25 MB spreadsheet and no words transfers the whole interpretive burden to the person triaging. The friction is on the correct side, and it is one sentence. The UI absorbs it — focused field, "Enviar", and a placeholder that becomes "O que tem nesse arquivo?" once a file is selected.

11. **Images preview; everything else is a card, and nothing non-image opens inline.** Non-image attachments are fetched with `?download=`, so a PDF's embedded JavaScript never runs in a viewer, and `.csv` warns before download.

## Consequences

- **Two accepted risks, each with a review trigger.** Neither is "solved":
  - **CSV injection.** A cell beginning `=` executes when staff opens it in Excel, and staff machines hold master access to every org. Mitigated by forced download and an explicit warning, not eliminated. Accepted over refusing `.csv` because the CTO judged the export convenience worth it.
  - **No malware scanning.** Senders are ~30 authenticated paying tenants under contract, not anonymous internet; the realistic vector is a customer forwarding an already-infected file, against which endpoint AV is the right layer. Revisit if org count grows substantially, if support begins receiving files from non-customers, or on the first real incident. Sending customer files to a third-party scanner (VirusTotal and similar) is refused outright — we are operator of their leads' data, and a scanner that retains samples is a larger LGPD problem than the virus.
- **The table has no `organization_id`, deliberately.** `supabase/migrations/CLAUDE.md` calls that column non-negotiable for tenant data, and this is a knowing exception with a precedent: `support_ticket_comments` has the same shape. Tenancy is derived through `ticket_id` → `can_read_support_ticket()`, which is the *same* function every other support policy already trusts. Denormalizing the org onto the attachment would create a second answer to "whose is this?", and the two would eventually disagree. The guard rails hold because the coherence trigger pins `ticket_id` to the first path segment, so a row cannot claim a ticket its file does not belong to.
- **Both guard triggers are `SECURITY DEFINER`, and must stay that way.** As invoker, their `SELECT count(*)` and their read of the parent Comentário run under RLS — which hides internal rows from a non-master. The customer would then count fewer attachments than exist and walk straight through the 20-per-ticket cap, and the coherence check would compare against a comment it cannot see. A limit that only binds the people who can see everything is not a limit. This is the same reason `20270120000000`'s rate-limit trigger is `SECURITY DEFINER`.
- **`can_read_support_attachment()` gains a branch and keeps its contract.** It still returns `false` rather than raising — the policy is evaluated across other buckets' objects, and an inline cast would take their listing down with it.
- **A staff attachment arrives live by riding its Comentário, with a race we accept.** `useTicketChannel` (ADR-0021) folds incoming comment rows into the cache; `support_ticket_attachments` is deliberately *not* added to the realtime publication. The sender's order is forced — upload the files, insert the comment, then insert the rows that reference `comment_id` — so the comment is announced a few milliseconds *before* its attachments exist. The channel therefore also invalidates the attachments query on each incoming comment. If that refetch wins the race, the attachment simply appears on the next fetch; nothing is lost and nothing is wrong, only late. Publishing the attachments table to fix a benign millisecond gap would add a second live subscription per open thread for no gain.
- **Deferred on purpose**: per-attachment audit of *who downloaded what* (the Storage logs know; we do not join them), inline preview for PDF, orphan-file cleanup cron, and virus scanning as decision 4's review trigger describes.
