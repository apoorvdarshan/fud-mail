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

// A failed save must not become an unhandled rejection or stop later saves.
const { EventEmitter } = await import("node:events");
const { persistTokenUpdates } = await import("../src/token-persistence.mjs");
const client = new EventEmitter();
const saved = [];
const warnings = [];
let releaseFirst;
const gate = new Promise(resolve => { releaseFirst = resolve; });
const drain = persistTokenUpdates(client, { refresh_token: "synthetic-refresh" }, async tokens => {
  saved.push(tokens);
  if (saved.length === 1) {
    await gate;
    throw new Error("synthetic-secret-in-command");
  }
}, message => warnings.push(message));
client.emit("tokens", { access_token: "synthetic-first" });
client.emit("tokens", { access_token: "synthetic-second" });
await Promise.resolve();
assert.equal(saved.length, 1);
releaseFirst();
await drain();
assert.deepEqual(saved, [
  { refresh_token: "synthetic-refresh", access_token: "synthetic-first" },
  { refresh_token: "synthetic-refresh", access_token: "synthetic-second" },
]);
assert.equal(warnings.length, 1);
assert.match(warnings[0], /Keychain/);
assert.doesNotMatch(warnings[0], /synthetic-/);
client.emit("tokens", { refresh_token: "synthetic-rotated" });
await drain();
assert.equal(saved[2].refresh_token, "synthetic-rotated");
assert.equal(saved[2].access_token, "synthetic-second");
// Exercise the real save wrapper with a fake security executable, never Keychain.
const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { spawnSync } = await import("node:child_process");
const fakeBin = await mkdtemp(join(tmpdir(), "gmail-keychain-test-"));
try {
  await writeFile(join(fakeBin, "security"), '#!/bin/sh\nprintf "%s\\n" "$@" >&2\nexit 1\n', { mode: 0o700 });
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { saveTokensToKeychain } from ${JSON.stringify(new URL("../src/google-auth.mjs", import.meta.url).href)};
    try {
      await saveTokensToKeychain("test@example.com", { access_token: "synthetic-sensitive-token" });
      process.exitCode = 1;
    } catch (error) { console.log(error.message); }
  `], {
    encoding: "utf8",
    env: { ...process.env, PATH: fakeBin, GMAIL_MCP_ACCOUNTS: "test@example.com" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Unable to save Gmail OAuth tokens/);
  assert.doesNotMatch(child.stdout + child.stderr, /synthetic-sensitive-token|add-generic-password/);
} finally {
  await rm(fakeBin, { recursive: true, force: true });
}
// Verify MIME composition after the Nodemailer security update; no sending.
const { default: MailComposer } = await import("nodemailer/lib/mail-composer/index.js");
const mime = await new MailComposer({
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Synthetic draft",
  text: "Synthetic body",
  attachments: [{ filename: "example.txt", content: "Synthetic attachment" }],
}).compile().build();
assert.match(mime.toString(), /Subject: Synthetic draft/);
assert.match(mime.toString(), /multipart\/mixed/);
assert.match(mime.toString(), /filename=example.txt/);
console.log("Unit tests passed.");
