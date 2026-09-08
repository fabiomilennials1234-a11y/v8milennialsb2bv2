# Operator-controlled document delivery

`copilot_agents.conversation_style.document_delivery_policy` supports:

```json
{
  "prevent_repeated_documents": true,
  "captions_by_document": {
    "document-uuid": "Operator-approved explanation attached to this file."
  }
}
```

Defaults preserve existing behavior. Enable per agent when a new model action must not imply permission to resend an already delivered document. This policy also blocks explicit repeat requests; operators must disable it if they want to permit resends. No model-provided flag bypasses it.

With prevention enabled, the worker checks actual delivery records and shares an atomic lock across distinct actions for the same conversation/document. Suppressed actions are stamped separately from delivered actions. Unknown lock outcomes fail for retry rather than permitting another send. Captions are attached to the media request and recorded with that same message, never sent as an independently ordered job.

The Uazapi wire contract uses `text` for captions and `docName` for filenames. The client translates the internal `caption` / `filename` fields at `/send/media`. Reference: https://www.postman.com/augustofcs/uazapi-v2/request/enerb9a/enviar-media

September 8 Forever Bella reproduction: one inbound requested all products; 11 media actions were created, then a confirmation created 6 more, repeating the same documents. The action-specific lock allowed each new action. Meanwhile captions were persisted in CRM but sent under the unsupported `caption` key. Regression tests cover the actual worker send boundary and client HTTP body without contacting WhatsApp.

Validation: 115 focused tests passed. A broader run also found a pre-existing historySync test expecting `/message/history-sync` while the implementation uses `/message/find`; the media change does not touch that method.
