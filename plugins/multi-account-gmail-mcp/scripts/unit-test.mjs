import assert from "node:assert/strict";
import {
  attachmentParts,
  buildForwardBody,
  buildReplyEnvelope,
  formatMessage,
  parseAddresses,
} from "../src/message-utils.mjs";

assert.deepEqual(
  parseAddresses("A Person <a@example.com>, b@example.com"),
  ["a@example.com", "b@example.com"],
);

const headers = [
  { name: "From", value: "Sender <sender@example.com>" },
  { name: "Reply-To", value: "replies@example.com" },
  {
    name: "To",
    value: "owner@example.com, teammate@example.com",
  },
  { name: "Cc", value: "observer@example.com" },
  { name: "Subject", value: "Status update" },
  { name: "Message-ID", value: "<message-1@example.com>" },
  { name: "References", value: "<older@example.com>" },
];

assert.deepEqual(
  buildReplyEnvelope({
    account: "owner@example.com",
    headers,
    replyAll: true,
  }),
  {
    to: ["replies@example.com"],
    cc: ["teammate@example.com", "observer@example.com"],
    subject: "Re: Status update",
    inReplyTo: "<message-1@example.com>",
    references: "<older@example.com> <message-1@example.com>",
  },
);

const formatted = formatMessage(
  {
    id: "message-1",
    threadId: "thread-1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Plain body",
    internalDate: "123456789",
    payload: {
      mimeType: "multipart/alternative",
      headers,
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("Plain body").toString("base64url") },
        },
        {
          mimeType: "text/html",
          body: { data: Buffer.from("<p>HTML body</p>").toString("base64url") },
        },
        {
          mimeType: "application/pdf",
          filename: "report.pdf",
          body: { attachmentId: "attachment-1", size: 42 },
        },
      ],
    },
  },
  50_000,
);

assert.equal(formatted.body.text, "Plain body");
assert.equal(formatted.body.html, "<p>HTML body</p>");
assert.equal(formatted.attachments[0].filename, "report.pdf");
assert.equal(formatted.attachments[0].attachmentId, "attachment-1");
assert.equal("inlineData" in formatted.attachments[0], false);

const fixtureMessage = {
  id: "message-1",
  payload: {
    headers,
    parts: [
      {
        mimeType: "text/plain",
        body: { data: Buffer.from("Original body").toString("base64url") },
      },
      {
        mimeType: "application/pdf",
        filename: "report.pdf",
        body: {
          attachmentId: "attachment-1",
          data: Buffer.from("PDF").toString("base64url"),
          size: 3,
        },
      },
    ],
  },
};

assert.equal(
  attachmentParts(fixtureMessage)[0].inlineData,
  Buffer.from("PDF").toString("base64url"),
);
assert.match(buildForwardBody(fixtureMessage, "For your review"), /Original body/);
assert.match(
  buildForwardBody(fixtureMessage, "For your review"),
  /For your review\n\n---------- Forwarded message ---------/,
);

console.log("Unit tests passed.");
