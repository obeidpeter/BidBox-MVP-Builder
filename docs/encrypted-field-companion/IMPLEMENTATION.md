# Encrypted Field Companion

The field companion is a small browser-local draft workspace for a signed-in operator whose connection drops while BidBox is already open. It is not an offline copy of BidBox and it does not create authoritative evidence.

## Delivered boundary

- Up to 25 drafts per direct tenant membership and signed-in user.
- Three draft classes: site-visit note, delivery-receipt note, and checklist progress.
- AES-256-GCM encryption with a separate non-extractable browser key for each signed-in user, stored through structured clone in IndexedDB.
- Authenticated additional data binds each ciphertext to its record identity, schema, organisation-and-user partition digest, and actor-bound key.
- A cross-tab Web Lock serialises reads, revisions, deletions, and device wipe; revisions use an optimistic version.
- Plaintext, checklist, event, and per-tenant counts are bounded before storage.
- Every draft has a non-extendable seven-day expiry. Expired ciphertext is deleted before a partition is listed or a draft is saved.
- An explicit wipe deletes only the current signed-in user’s local encryption key and actor-bound BidBox field drafts across organisations. The application route does not enumerate, open, or remove another recorded actor partition.
- The page clears rendered state on actor or organisation change and decrypts only against the exact active user-and-organisation pair; either mismatch fails closed.
- The version-2 storage upgrade discards legacy organisation-only drafts because they cannot be assigned safely to a historical actor.
- After reconnecting, a named operator with current direct `project:update` authority may explicitly choose one compatible existing governed work item and a bounded subset of `title`, `note`, and `checklist` fields. BidBox does not choose or create a target.
- The client reloads the exact target, presents a field-by-field diff, and reloads it again before submission. A changed target version produces a new diff that must be confirmed again.
- The server rechecks current direct authority inside the compare-and-swap transaction and requires an exact organisation, project, actor, draft, and target binding. Done, cancelled, approved, stale, or over-capacity targets fail closed.
- Each write is bound to one idempotency key and expected target version. Its receipt contains identifiers, selected field names, versions, timestamps, and integrity hashes only; it contains no copied field content and cannot claim evidence creation or local deletion.
- Before POST, the exact bounded command, target, and idempotency key are stored inside the actor-bound encrypted draft. A reload or crash reuses that same identity and first checks for its verified receipt, preventing a second checklist append under a new key.
- Only a cryptographically verified receipt can mark the encrypted draft as promoted and clear its prepared-command marker. The local ciphertext remains subject to its original non-extendable expiry and is deleted only by an explicit operator action or the existing expiry purge.

## Deliberately unavailable

- service-worker caching of authenticated pages or API responses;
- tender corpus, files, photos, credentials, approvals, final receipts, or Restricted Mode content;
- background or automatic synchronization;
- treating a local draft, promotion receipt, or copied work-item field as evidence or approval;
- automatic target selection, target creation, post-promotion deletion, or retention extension;
- raw field content in promotion receipts, idempotency records, audit details, or application logs;
- offline authentication after the currently loaded application session ends.

Operators must reconnect, review the draft and governed target, select the fields to copy, and confirm the mutation. A verified receipt marks that bounded copy; it does not turn the source draft into evidence. Deleting the browser profile, losing the non-extractable key, or using the device-wipe control makes the local drafts unrecoverable by design.

This actor partition is application/session isolation, not a cryptographic browser-user boundary. Use a dedicated operating-system account and browser profile on shared devices, and treat same-origin script compromise as capable of reaching IndexedDB. Stronger cross-user isolation would require separately approved user-held key wrapping, such as WebAuthn or a passphrase-derived wrapping key.
