import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { z } from "zod";
import {
  createAuthorizedGmail,
  SUPPORTED_EMAILS,
} from "./google-auth.mjs";
import {
  attachmentParts,
  buildForwardBody,
  buildReplyEnvelope,
  formatMessage,
  headerValue,
  messageSummary,
} from "./message-utils.mjs";

const server = new McpServer({
  name: "multi-account-gmail-mcp",
  version: "0.1.0",
});

const accountSchema = z
  .enum(SUPPORTED_EMAILS)
  .describe("The exact Google mailbox that owns the draft or sends the email.");
const recipientList = z
  .array(z.string().email())
  .min(1)
  .max(50)
  .describe("Email addresses.");
const optionalRecipientList = z
  .array(z.string().email())
  .max(50)
  .optional()
  .describe("Optional email addresses.");
const attachmentPathList = z
  .array(z.string().min(1))
  .max(20)
  .optional()
  .describe("Absolute local file paths explicitly approved by the user for attachment.");
const messageIdSchema = z
  .string()
  .min(1)
  .describe("Gmail message ID returned by a Gmail search or read tool.");
const threadIdSchema = z
  .string()
  .min(1)
  .describe("Gmail thread ID returned by a Gmail search or read tool.");
const labelIdList = z
  .array(z.string().min(1))
  .max(100)
  .default([])
  .describe("Gmail system or user label IDs.");
const labelIdSchema = z
  .string()
  .min(1)
  .describe("Gmail label ID returned by list_labels.");
const metadataHeaders = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Reply-To",
  "Subject",
  "Date",
  "Message-ID",
  "In-Reply-To",
  "References",
];

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

function wrapTool(handler) {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      return errorResult(error);
    }
  };
}

async function buildRawMessage({
  account,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  body,
  inReplyTo,
  references,
  attachments,
}) {
  const composer = new MailComposer({
    from: account,
    to: to.join(", "),
    cc: cc?.join(", "),
    bcc: bcc?.join(", "),
    replyTo,
    subject,
    text: body,
    inReplyTo,
    references,
    attachments,
    textEncoding: "quoted-printable",
  });
  const message = await composer.compile().build();
  return message.toString("base64url");
}

async function localAttachments(attachmentPaths = []) {
  let totalSize = 0;
  const attachments = [];
  for (const attachmentPath of attachmentPaths) {
    if (!path.isAbsolute(attachmentPath)) {
      throw new Error(`Attachment path must be absolute: ${attachmentPath}`);
    }
    const fileStats = await stat(attachmentPath);
    if (!fileStats.isFile()) {
      throw new Error(`Attachment path is not a file: ${attachmentPath}`);
    }
    totalSize += fileStats.size;
    if (totalSize > 25 * 1024 * 1024) {
      throw new Error("Combined local attachments exceed the 25 MB safety limit.");
    }
    attachments.push({
      filename: path.basename(attachmentPath),
      path: attachmentPath,
    });
  }
  return attachments;
}

async function buildRawMessageWithLocalAttachments(input) {
  const attachments = await localAttachments(input.attachmentPaths);
  return buildRawMessage({ ...input, attachments });
}

async function gmailAttachments(gmail, message) {
  const parts = attachmentParts(message);
  const attachments = [];
  let totalSize = 0;
  for (const part of parts) {
    let data = part.inlineData;
    if (!data && part.attachmentId) {
      const { data: attachment } =
        await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: message.id,
          id: part.attachmentId,
        });
      data = attachment.data;
    }
    if (!data) {
      continue;
    }
    const content = Buffer.from(data, "base64url");
    totalSize += content.length;
    if (totalSize > 25 * 1024 * 1024) {
      throw new Error("Combined forwarded attachments exceed the 25 MB safety limit.");
    }
    attachments.push({
      filename: part.filename || "attachment",
      content,
      contentType: part.mimeType || undefined,
    });
  }
  return attachments;
}

function safeFilename(filename) {
  const sanitized = path.basename(filename || "attachment").replace(
    /[^a-zA-Z0-9._ -]/g,
    "_",
  );
  return sanitized || "attachment";
}

const draftInputSchema = {
  account: accountSchema,
  to: recipientList,
  cc: optionalRecipientList,
  bcc: optionalRecipientList,
  replyTo: z.string().email().optional(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(200_000),
  attachmentPaths: attachmentPathList,
};

server.registerTool(
  "get_profile",
  {
    title: "Get Gmail profile",
    description:
      "Verify the authenticated identity for one explicitly selected Google mailbox.",
    inputSchema: {
      account: accountSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account }) => {
    const { profile } = await createAuthorizedGmail(account);
    return textResult({
      requestedAccount: account,
      email: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
      threadsTotal: profile.threadsTotal,
    });
  }),
);

server.registerTool(
  "search_messages",
  {
    title: "Search Gmail messages",
    description:
      "Search or list messages in one explicitly selected mailbox using Gmail search syntax. Returns message IDs and metadata, not message bodies.",
    inputSchema: {
      account: accountSchema,
      query: z
        .string()
        .max(2_000)
        .optional()
        .describe("Optional Gmail search query, such as 'is:unread from:person@example.com'."),
      labelIds: z
        .array(z.string().min(1))
        .max(20)
        .optional()
        .describe("Optional label IDs that every result must have."),
      includeSpamTrash: z.boolean().default(false),
      maxResults: z.number().int().min(1).max(100).default(20),
      pageToken: z.string().min(1).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(
    async ({
      account,
      query,
      labelIds,
      includeSpamTrash,
      maxResults,
      pageToken,
    }) => {
      const { gmail } = await createAuthorizedGmail(account);
      const { data } = await gmail.users.messages.list({
        userId: "me",
        q: query,
        labelIds,
        includeSpamTrash,
        maxResults,
        pageToken,
      });
      const ids = data.messages?.map((message) => message.id).filter(Boolean) || [];
      const messages = await Promise.all(
        ids.map(async (id) => {
          const { data: message } = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders,
          });
          return messageSummary(message);
        }),
      );

      return textResult({
        account,
        query: query || "",
        messages,
        nextPageToken: data.nextPageToken || null,
        resultSizeEstimate: data.resultSizeEstimate || 0,
      });
    },
  ),
);

server.registerTool(
  "get_message",
  {
    title: "Read a Gmail message",
    description:
      "Read one Gmail message, including headers, text and HTML bodies, and attachment metadata, from an explicitly selected mailbox.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
      maxBodyChars: z.number().int().min(1_000).max(200_000).default(50_000),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageId, maxBodyChars }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data: message } = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    return textResult({
      account,
      message: formatMessage(message, maxBodyChars),
    });
  }),
);

server.registerTool(
  "batch_get_messages",
  {
    title: "Read multiple Gmail messages",
    description:
      "Read up to 25 Gmail messages from one explicitly selected mailbox in a single request.",
    inputSchema: {
      account: accountSchema,
      messageIds: z.array(messageIdSchema).min(1).max(25),
      maxBodyCharsPerMessage: z
        .number()
        .int()
        .min(1_000)
        .max(100_000)
        .default(20_000),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageIds, maxBodyCharsPerMessage }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const messages = await Promise.all(
      messageIds.map(async (id) => {
        const { data: message } = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        return formatMessage(message, maxBodyCharsPerMessage);
      }),
    );
    return textResult({ account, messages });
  }),
);

server.registerTool(
  "get_thread",
  {
    title: "Read a Gmail thread",
    description:
      "Read messages in one Gmail thread from an explicitly selected mailbox, with bounded message bodies.",
    inputSchema: {
      account: accountSchema,
      threadId: threadIdSchema,
      maxMessages: z.number().int().min(1).max(100).default(20),
      maxBodyCharsPerMessage: z
        .number()
        .int()
        .min(1_000)
        .max(100_000)
        .default(20_000),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(
    async ({ account, threadId, maxMessages, maxBodyCharsPerMessage }) => {
      const { gmail } = await createAuthorizedGmail(account);
      const { data: thread } = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      const allMessages = thread.messages || [];
      const selectedMessages = allMessages.slice(-maxMessages);
      return textResult({
        account,
        id: thread.id,
        historyId: thread.historyId,
        totalMessages: allMessages.length,
        returnedMessages: selectedMessages.length,
        messages: selectedMessages.map((message) =>
          formatMessage(message, maxBodyCharsPerMessage),
        ),
      });
    },
  ),
);

server.registerTool(
  "save_attachment",
  {
    title: "Save a Gmail attachment",
    description:
      "Download one Gmail attachment to a temporary local file and return its absolute path.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
      attachmentId: z
        .string()
        .min(1)
        .describe("Attachment ID returned by get_message or get_thread."),
      filename: z.string().min(1).max(255).default("attachment"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageId, attachmentId, filename }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data } = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    if (!data.data) {
      throw new Error("Gmail returned no attachment data.");
    }
    const attachmentRoot = path.join(os.tmpdir(), "codex-gmail-attachments");
    await mkdir(attachmentRoot, { recursive: true });
    const attachmentDirectory = await mkdtemp(
      path.join(attachmentRoot, "attachment-"),
    );
    const outputPath = path.join(attachmentDirectory, safeFilename(filename));
    const content = Buffer.from(data.data, "base64url");
    await writeFile(outputPath, content, { mode: 0o600 });
    return textResult({
      status: "attachment_saved",
      account,
      messageId,
      attachmentId,
      filename: path.basename(outputPath),
      path: outputPath,
      size: content.length,
    });
  }),
);

server.registerTool(
  "list_labels",
  {
    title: "List Gmail labels",
    description:
      "List system and user labels for one explicitly selected mailbox so their IDs can be used in search and label tools.",
    inputSchema: {
      account: accountSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data } = await gmail.users.labels.list({ userId: "me" });
    const labels = (data.labels || []).map((label) => ({
      id: label.id,
      name: label.name,
      type: label.type,
      messageListVisibility: label.messageListVisibility,
      labelListVisibility: label.labelListVisibility,
    }));
    return textResult({ account, labels });
  }),
);

server.registerTool(
  "create_label",
  {
    title: "Create a Gmail label",
    description:
      "Create one user label in an explicitly selected Gmail mailbox.",
    inputSchema: {
      account: accountSchema,
      name: z.string().min(1).max(225),
      labelListVisibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .default("labelShow"),
      messageListVisibility: z.enum(["show", "hide"]).default("show"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(
    async ({
      account,
      name,
      labelListVisibility,
      messageListVisibility,
    }) => {
      const { gmail } = await createAuthorizedGmail(account);
      const { data: label } = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          labelListVisibility,
          messageListVisibility,
        },
      });
      return textResult({ status: "label_created", account, label });
    },
  ),
);

server.registerTool(
  "update_label",
  {
    title: "Update a Gmail label",
    description:
      "Rename or change visibility for one user label in an explicitly selected Gmail mailbox.",
    inputSchema: {
      account: accountSchema,
      labelId: labelIdSchema,
      name: z.string().min(1).max(225).optional(),
      labelListVisibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .optional(),
      messageListVisibility: z.enum(["show", "hide"]).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(
    async ({
      account,
      labelId,
      name,
      labelListVisibility,
      messageListVisibility,
    }) => {
      const requestBody = Object.fromEntries(
        Object.entries({
          name,
          labelListVisibility,
          messageListVisibility,
        }).filter(([, value]) => value !== undefined),
      );
      if (!Object.keys(requestBody).length) {
        throw new Error("Choose at least one label field to update.");
      }
      const { gmail } = await createAuthorizedGmail(account);
      const { data: label } = await gmail.users.labels.patch({
        userId: "me",
        id: labelId,
        requestBody,
      });
      return textResult({ status: "label_updated", account, label });
    },
  ),
);

server.registerTool(
  "delete_label",
  {
    title: "Delete a Gmail label",
    description:
      "Permanently delete one user label. This removes the label from messages but does not delete the messages.",
    inputSchema: {
      account: accountSchema,
      labelId: labelIdSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, labelId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    await gmail.users.labels.delete({
      userId: "me",
      id: labelId,
    });
    return textResult({ status: "label_deleted", account, labelId });
  }),
);

server.registerTool(
  "modify_message_labels",
  {
    title: "Modify Gmail message labels",
    description:
      "Add or remove system or user labels on up to 100 Gmail messages. Use list_labels first for user-label IDs.",
    inputSchema: {
      account: accountSchema,
      messageIds: z.array(messageIdSchema).min(1).max(100),
      addLabelIds: labelIdList,
      removeLabelIds: labelIdList,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageIds, addLabelIds, removeLabelIds }) => {
    if (!addLabelIds.length && !removeLabelIds.length) {
      throw new Error("Choose at least one label to add or remove.");
    }
    const { gmail } = await createAuthorizedGmail(account);
    await gmail.users.messages.batchModify({
      userId: "me",
      requestBody: {
        ids: messageIds,
        addLabelIds,
        removeLabelIds,
      },
    });
    return textResult({
      status: "labels_modified",
      account,
      messageIds,
      addLabelIds,
      removeLabelIds,
    });
  }),
);

const messageStateChanges = {
  archive: { addLabelIds: [], removeLabelIds: ["INBOX"] },
  move_to_inbox: { addLabelIds: ["INBOX"], removeLabelIds: [] },
  mark_read: { addLabelIds: [], removeLabelIds: ["UNREAD"] },
  mark_unread: { addLabelIds: ["UNREAD"], removeLabelIds: [] },
  star: { addLabelIds: ["STARRED"], removeLabelIds: [] },
  unstar: { addLabelIds: [], removeLabelIds: ["STARRED"] },
  mark_important: { addLabelIds: ["IMPORTANT"], removeLabelIds: [] },
  unmark_important: { addLabelIds: [], removeLabelIds: ["IMPORTANT"] },
};

server.registerTool(
  "update_message_state",
  {
    title: "Update Gmail message state",
    description:
      "Archive, restore to Inbox, mark read or unread, star or unstar, or change importance for one Gmail message.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
      action: z.enum(Object.keys(messageStateChanges)),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageId, action }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data: message } = await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: messageStateChanges[action],
    });
    return textResult({
      status: action,
      account,
      messageId: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
    });
  }),
);

server.registerTool(
  "trash_message",
  {
    title: "Move a Gmail message to Trash",
    description:
      "Move one Gmail message to Trash. This does not permanently delete it and can be reversed with untrash_message.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data: message } = await gmail.users.messages.trash({
      userId: "me",
      id: messageId,
    });
    return textResult({
      status: "moved_to_trash",
      account,
      messageId: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
    });
  }),
);

server.registerTool(
  "untrash_message",
  {
    title: "Restore a Gmail message from Trash",
    description:
      "Restore one Gmail message from Trash in an explicitly selected mailbox.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data: message } = await gmail.users.messages.untrash({
      userId: "me",
      id: messageId,
    });
    return textResult({
      status: "restored_from_trash",
      account,
      messageId: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
    });
  }),
);

server.registerTool(
  "permanently_delete_message",
  {
    title: "Permanently delete a Gmail message",
    description:
      "Immediately and permanently delete one Gmail message, bypassing Trash. This cannot be undone and requires explicit user approval for the exact message.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, messageId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    await gmail.users.messages.delete({
      userId: "me",
      id: messageId,
    });
    return textResult({
      status: "permanently_deleted",
      account,
      messageId,
    });
  }),
);

server.registerTool(
  "permanently_delete_thread",
  {
    title: "Permanently delete a Gmail thread",
    description:
      "Immediately and permanently delete an entire Gmail thread, bypassing Trash. This cannot be undone and requires explicit user approval for the exact thread.",
    inputSchema: {
      account: accountSchema,
      threadId: threadIdSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, threadId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    await gmail.users.threads.delete({
      userId: "me",
      id: threadId,
    });
    return textResult({
      status: "thread_permanently_deleted",
      account,
      threadId,
    });
  }),
);

server.registerTool(
  "list_drafts",
  {
    title: "List Gmail drafts",
    description:
      "List recent drafts from one explicitly selected mailbox with recipient and subject metadata.",
    inputSchema: {
      account: accountSchema,
      maxResults: z.number().int().min(1).max(100).default(20),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, maxResults }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data } = await gmail.users.drafts.list({
      userId: "me",
      maxResults,
    });
    const draftIds = data.drafts?.map((draft) => draft.id).filter(Boolean) || [];

    const drafts = await Promise.all(
      draftIds.map(async (id) => {
        const { data: draft } = await gmail.users.drafts.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["To", "Cc", "Bcc", "Subject", "Date"],
        });
        const headers = draft.message?.payload?.headers;
        return {
          id: draft.id,
          messageId: draft.message?.id,
          threadId: draft.message?.threadId,
          to: headerValue(headers, "To"),
          cc: headerValue(headers, "Cc"),
          bcc: headerValue(headers, "Bcc"),
          subject: headerValue(headers, "Subject"),
          date: headerValue(headers, "Date"),
        };
      }),
    );

    return textResult({ account, drafts });
  }),
);

server.registerTool(
  "get_draft",
  {
    title: "Get a Gmail draft",
    description:
      "Read one existing draft from an explicitly selected mailbox before review or sending.",
    inputSchema: {
      account: accountSchema,
      draftId: z.string().min(1),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, draftId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data: draft } = await gmail.users.drafts.get({
      userId: "me",
      id: draftId,
      format: "raw",
    });
    const raw = draft.message?.raw
      ? Buffer.from(draft.message.raw, "base64url").toString("utf8")
      : "";
    return textResult({
      account,
      id: draft.id,
      messageId: draft.message?.id,
      threadId: draft.message?.threadId,
      rawMessage: raw,
    });
  }),
);

server.registerTool(
  "delete_draft",
  {
    title: "Delete a Gmail draft",
    description:
      "Permanently delete one unsent Gmail draft by draft ID. This cannot be undone.",
    inputSchema: {
      account: accountSchema,
      draftId: z.string().min(1),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, draftId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    await gmail.users.drafts.delete({
      userId: "me",
      id: draftId,
    });
    return textResult({ status: "draft_deleted", account, draftId });
  }),
);

server.registerTool(
  "create_reply_draft",
  {
    title: "Create a Gmail reply draft",
    description:
      "Create an unsent reply or reply-all draft tied to an existing Gmail message and thread. This never sends the reply.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
      body: z.string().min(1).max(200_000),
      replyAll: z.boolean().default(false),
      bcc: optionalRecipientList,
      attachmentPaths: attachmentPathList,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(
    async ({
      account,
      messageId,
      body,
      replyAll,
      bcc,
      attachmentPaths,
    }) => {
      const { gmail } = await createAuthorizedGmail(account);
      const { data: original } = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders,
      });
      const envelope = buildReplyEnvelope({
        account,
        headers: original.payload?.headers,
        replyAll,
      });
      const raw = await buildRawMessageWithLocalAttachments({
        account,
        to: envelope.to,
        cc: envelope.cc,
        bcc,
        subject: envelope.subject,
        body,
        inReplyTo: envelope.inReplyTo,
        references: envelope.references,
        attachmentPaths,
      });
      const { data: draft } = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw,
            threadId: original.threadId,
          },
        },
      });
      return textResult({
        status: "reply_draft_created_not_sent",
        account,
        inReplyToMessageId: messageId,
        to: envelope.to,
        cc: envelope.cc,
        bcc: bcc || [],
        subject: envelope.subject,
        draftId: draft.id,
        messageId: draft.message?.id,
        threadId: draft.message?.threadId,
      });
    },
  ),
);

server.registerTool(
  "create_forward_draft",
  {
    title: "Create a Gmail forward draft",
    description:
      "Create an unsent forward draft for an existing Gmail message, optionally preserving its attachments.",
    inputSchema: {
      account: accountSchema,
      messageId: messageIdSchema,
      to: recipientList,
      cc: optionalRecipientList,
      bcc: optionalRecipientList,
      note: z.string().max(200_000).default(""),
      includeAttachments: z.boolean().default(true),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(
    async ({
      account,
      messageId,
      to,
      cc,
      bcc,
      note,
      includeAttachments,
    }) => {
      const { gmail } = await createAuthorizedGmail(account);
      const { data: original } = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      const originalSubject = headerValue(
        original.payload?.headers,
        "Subject",
      );
      const subject = /^fwd:/i.test(originalSubject)
        ? originalSubject
        : `Fwd: ${originalSubject || "(no subject)"}`;
      const attachments = includeAttachments
        ? await gmailAttachments(gmail, original)
        : [];
      const raw = await buildRawMessage({
        account,
        to,
        cc,
        bcc,
        subject,
        body: buildForwardBody(original, note),
        attachments,
      });
      const { data: draft } = await gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw } },
      });
      return textResult({
        status: "forward_draft_created_not_sent",
        account,
        forwardedMessageId: messageId,
        to,
        cc: cc || [],
        bcc: bcc || [],
        subject,
        includedAttachments: attachments.length,
        draftId: draft.id,
        messageId: draft.message?.id,
        threadId: draft.message?.threadId,
      });
    },
  ),
);

server.registerTool(
  "create_draft",
  {
    title: "Create a Gmail draft",
    description:
      "Create an unsent draft in one explicitly selected mailbox. This never sends the message.",
    inputSchema: draftInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async (input) => {
    const { gmail } = await createAuthorizedGmail(input.account);
    const raw = await buildRawMessageWithLocalAttachments(input);
    const { data: draft } = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });
    return textResult({
      status: "draft_created_not_sent",
      account: input.account,
      draftId: draft.id,
      messageId: draft.message?.id,
      threadId: draft.message?.threadId,
    });
  }),
);

server.registerTool(
  "update_draft",
  {
    title: "Update a Gmail draft",
    description:
      "Replace an existing unsent draft in one explicitly selected mailbox.",
    inputSchema: {
      draftId: z.string().min(1),
      ...draftInputSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  wrapTool(async ({ account, draftId, ...message }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const updatedMessage = { account, ...message };
    const raw = await buildRawMessageWithLocalAttachments(updatedMessage);
    const { data: draft } = await gmail.users.drafts.update({
      userId: "me",
      id: draftId,
      requestBody: { message: { raw } },
    });
    return textResult({
      status: "draft_updated_not_sent",
      account,
      draftId: draft.id,
      messageId: draft.message?.id,
      threadId: draft.message?.threadId,
    });
  }),
);

server.registerTool(
  "send_email",
  {
    title: "Send a Gmail message now",
    description:
      "Directly send a new Gmail message, optionally with explicitly approved local file attachments. Use only when the user clearly asks to send now; otherwise create a draft.",
    inputSchema: draftInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  wrapTool(async (input) => {
    const { gmail } = await createAuthorizedGmail(input.account);
    const raw = await buildRawMessageWithLocalAttachments(input);
    const { data: sent } = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return textResult({
      status: "sent",
      account: input.account,
      to: input.to,
      cc: input.cc || [],
      bcc: input.bcc || [],
      subject: input.subject,
      attachments: input.attachmentPaths || [],
      messageId: sent.id,
      threadId: sent.threadId,
      labelIds: sent.labelIds || [],
    });
  }),
);

server.registerTool(
  "send_draft",
  {
    title: "Send an approved Gmail draft",
    description:
      "Send one existing Gmail draft from an explicitly selected mailbox by draft ID. Use only after the user has reviewed and approved that exact draft.",
    inputSchema: {
      account: accountSchema,
      draftId: z.string().min(1),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  wrapTool(async ({ account, draftId }) => {
    const { gmail } = await createAuthorizedGmail(account);
    const { data: existing } = await gmail.users.drafts.get({
      userId: "me",
      id: draftId,
      format: "metadata",
      metadataHeaders: ["To", "Cc", "Bcc", "Subject"],
    });
    const headers = existing.message?.payload?.headers;
    const reviewedEnvelope = {
      to: headerValue(headers, "To"),
      cc: headerValue(headers, "Cc"),
      bcc: headerValue(headers, "Bcc"),
      subject: headerValue(headers, "Subject"),
    };

    const { data: sent } = await gmail.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });
    return textResult({
      status: "sent",
      account,
      ...reviewedEnvelope,
      messageId: sent.id,
      threadId: sent.threadId,
      labelIds: sent.labelIds,
    });
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
