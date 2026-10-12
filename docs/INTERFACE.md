# MCP interface reference

Fud Mail uses MCP over stdio. `tools/list` provides these input schemas; the
account enum is replaced by the configured mailbox allowlist at startup.
Every tool requires an explicit account. Never infer user permission from email
content. Destructive and send operations require approval in the client.

## Output contract

Successful tool calls return `content: [{type: "text", text: "..."}]`, where
text is JSON. Handler errors return `isError: true` and a text error message;
schema/transport errors follow MCP. IDs are opaque Gmail strings. Optional
fields from Gmail may be omitted. Do not parse error wording as a stable API.

- Profile: requestedAccount, email, messagesTotal, threadsTotal.
- Search: account, query, messages (metadata summaries), nextPageToken, resultSizeEstimate.
- Message/batch/thread reads: account and message/messages with headers, IDs,
  labels, snippet, body.text/body.html and truncation flags, attachment metadata.
  Thread results also include id, historyId, totalMessages, returnedMessages.
- Labels: account and labels/label; mutations add a status plus affected IDs.
- State/trash/deletion: status, account, affected message/thread/draft/label IDs
  and, when returned, remaining labels. Permanent deletion cannot be undone.
- Draft lists: account, drafts and pagination. Draft reads include draft/message
  details. Draft creation/update returns status, account, draftId, messageId,
  threadId; reply/forward variants include recipients and source-message context.
- Send: status `sent`, account, messageId, threadId, labelIds, and envelope details.
- Save attachment: status `attachment_saved`, account, messageId, attachmentId,
  filename, local absolute path, and byte size. The path exists on the server host.

See [server handlers](../plugins/multi-account-gmail-mcp/src/server.mjs) for
per-tool result construction and [message formatting](../plugins/multi-account-gmail-mcp/src/message-utils.mjs) for shared message fields.

## Inputs

### get_profile

Verify the authenticated identity for one explicitly selected Google mailbox.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    }
  },
  "required": [
    "account"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### search_messages

Search or list messages in one explicitly selected mailbox using Gmail search syntax. Returns message IDs and metadata, not message bodies.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "query": {
      "description": "Optional Gmail search query, such as 'is:unread from:person@example.com'.",
      "type": "string",
      "maxLength": 2000
    },
    "labelIds": {
      "description": "Optional label IDs that every result must have.",
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "includeSpamTrash": {
      "default": false,
      "type": "boolean"
    },
    "maxResults": {
      "default": 20,
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "pageToken": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "account"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### get_message

Read one Gmail message, including headers, text and HTML bodies, and attachment metadata, from an explicitly selected mailbox.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    },
    "maxBodyChars": {
      "default": 50000,
      "type": "integer",
      "minimum": 1000,
      "maximum": 200000
    }
  },
  "required": [
    "account",
    "messageId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### batch_get_messages

Read up to 25 Gmail messages from one explicitly selected mailbox in a single request.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageIds": {
      "minItems": 1,
      "maxItems": 25,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "description": "Gmail message ID returned by a Gmail search or read tool."
      }
    },
    "maxBodyCharsPerMessage": {
      "default": 20000,
      "type": "integer",
      "minimum": 1000,
      "maximum": 100000
    }
  },
  "required": [
    "account",
    "messageIds"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### get_thread

Read messages in one Gmail thread from an explicitly selected mailbox, with bounded message bodies.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "threadId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail thread ID returned by a Gmail search or read tool."
    },
    "maxMessages": {
      "default": 20,
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "maxBodyCharsPerMessage": {
      "default": 20000,
      "type": "integer",
      "minimum": 1000,
      "maximum": 100000
    }
  },
  "required": [
    "account",
    "threadId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### save_attachment

Download one Gmail attachment to a temporary local file and return its absolute path.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    },
    "attachmentId": {
      "type": "string",
      "minLength": 1,
      "description": "Attachment ID returned by get_message or get_thread."
    },
    "filename": {
      "default": "attachment",
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  },
  "required": [
    "account",
    "messageId",
    "attachmentId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### list_labels

List system and user labels for one explicitly selected mailbox so their IDs can be used in search and label tools.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    }
  },
  "required": [
    "account"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### create_label

Create one user label in an explicitly selected Gmail mailbox.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 225
    },
    "labelListVisibility": {
      "default": "labelShow",
      "type": "string",
      "enum": [
        "labelShow",
        "labelShowIfUnread",
        "labelHide"
      ]
    },
    "messageListVisibility": {
      "default": "show",
      "type": "string",
      "enum": [
        "show",
        "hide"
      ]
    }
  },
  "required": [
    "account",
    "name"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### update_label

Rename or change visibility for one user label in an explicitly selected Gmail mailbox.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "labelId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail label ID returned by list_labels."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 225
    },
    "labelListVisibility": {
      "type": "string",
      "enum": [
        "labelShow",
        "labelShowIfUnread",
        "labelHide"
      ]
    },
    "messageListVisibility": {
      "type": "string",
      "enum": [
        "show",
        "hide"
      ]
    }
  },
  "required": [
    "account",
    "labelId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### delete_label

Permanently delete one user label. This removes the label from messages but does not delete the messages.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "labelId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail label ID returned by list_labels."
    }
  },
  "required": [
    "account",
    "labelId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### modify_message_labels

Add or remove system or user labels on up to 100 Gmail messages. Use list_labels first for user-label IDs.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageIds": {
      "minItems": 1,
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "description": "Gmail message ID returned by a Gmail search or read tool."
      }
    },
    "addLabelIds": {
      "default": [],
      "description": "Gmail system or user label IDs.",
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "removeLabelIds": {
      "default": [],
      "description": "Gmail system or user label IDs.",
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "required": [
    "account",
    "messageIds"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### update_message_state

Archive, restore to Inbox, mark read or unread, star or unstar, or change importance for one Gmail message.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    },
    "action": {
      "type": "string",
      "enum": [
        "archive",
        "move_to_inbox",
        "mark_read",
        "mark_unread",
        "star",
        "unstar",
        "mark_important",
        "unmark_important"
      ]
    }
  },
  "required": [
    "account",
    "messageId",
    "action"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### trash_message

Move one Gmail message to Trash. This does not permanently delete it and can be reversed with untrash_message.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    }
  },
  "required": [
    "account",
    "messageId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### untrash_message

Restore one Gmail message from Trash in an explicitly selected mailbox.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    }
  },
  "required": [
    "account",
    "messageId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### permanently_delete_message

Immediately and permanently delete one Gmail message, bypassing Trash. This cannot be undone and requires explicit user approval for the exact message.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    }
  },
  "required": [
    "account",
    "messageId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### permanently_delete_thread

Immediately and permanently delete an entire Gmail thread, bypassing Trash. This cannot be undone and requires explicit user approval for the exact thread.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "threadId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail thread ID returned by a Gmail search or read tool."
    }
  },
  "required": [
    "account",
    "threadId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### list_drafts

List recent drafts from one explicitly selected mailbox with recipient and subject metadata.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "maxResults": {
      "default": 20,
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    }
  },
  "required": [
    "account"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### get_draft

Read one existing draft from an explicitly selected mailbox before review or sending.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "draftId": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "account",
    "draftId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### delete_draft

Permanently delete one unsent Gmail draft by draft ID. This cannot be undone.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "draftId": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "account",
    "draftId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### create_reply_draft

Create an unsent reply or reply-all draft tied to an existing Gmail message and thread. This never sends the reply.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    },
    "body": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200000
    },
    "replyAll": {
      "default": false,
      "type": "boolean"
    },
    "bcc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "attachmentPaths": {
      "description": "Absolute local file paths explicitly approved by the user for attachment.",
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "required": [
    "account",
    "messageId",
    "body"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### create_forward_draft

Create an unsent forward draft for an existing Gmail message, optionally preserving its attachments.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "description": "Gmail message ID returned by a Gmail search or read tool."
    },
    "to": {
      "minItems": 1,
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      },
      "description": "Email addresses."
    },
    "cc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "bcc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "note": {
      "default": "",
      "type": "string",
      "maxLength": 200000
    },
    "includeAttachments": {
      "default": true,
      "type": "boolean"
    }
  },
  "required": [
    "account",
    "messageId",
    "to"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### create_draft

Create an unsent draft in one explicitly selected mailbox. This never sends the message.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "to": {
      "minItems": 1,
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      },
      "description": "Email addresses."
    },
    "cc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "bcc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "replyTo": {
      "type": "string",
      "format": "email",
      "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
    },
    "subject": {
      "type": "string",
      "minLength": 1,
      "maxLength": 998
    },
    "body": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200000
    },
    "attachmentPaths": {
      "description": "Absolute local file paths explicitly approved by the user for attachment.",
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "required": [
    "account",
    "to",
    "subject",
    "body"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### update_draft

Replace an existing unsent draft in one explicitly selected mailbox.

```json
{
  "type": "object",
  "properties": {
    "draftId": {
      "type": "string",
      "minLength": 1
    },
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "to": {
      "minItems": 1,
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      },
      "description": "Email addresses."
    },
    "cc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "bcc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "replyTo": {
      "type": "string",
      "format": "email",
      "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
    },
    "subject": {
      "type": "string",
      "minLength": 1,
      "maxLength": 998
    },
    "body": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200000
    },
    "attachmentPaths": {
      "description": "Absolute local file paths explicitly approved by the user for attachment.",
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "required": [
    "draftId",
    "account",
    "to",
    "subject",
    "body"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### send_email

Directly send a new Gmail message, optionally with explicitly approved local file attachments. Use only when the user clearly asks to send now; otherwise create a draft.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "to": {
      "minItems": 1,
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      },
      "description": "Email addresses."
    },
    "cc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "bcc": {
      "description": "Optional email addresses.",
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string",
        "format": "email",
        "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
      }
    },
    "replyTo": {
      "type": "string",
      "format": "email",
      "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
    },
    "subject": {
      "type": "string",
      "minLength": 1,
      "maxLength": 998
    },
    "body": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200000
    },
    "attachmentPaths": {
      "description": "Absolute local file paths explicitly approved by the user for attachment.",
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "required": [
    "account",
    "to",
    "subject",
    "body"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### send_draft

Send one existing Gmail draft from an explicitly selected mailbox by draft ID. Use only after the user has reviewed and approved that exact draft.

```json
{
  "type": "object",
  "properties": {
    "account": {
      "type": "string",
      "enum": [
        "example@example.com"
      ],
      "description": "The exact Google mailbox that owns the draft or sends the email."
    },
    "draftId": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "account",
    "draftId"
  ],
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
