import addressparser from "nodemailer/lib/addressparser/index.js";

const DEFAULT_BODY_LIMIT = 50_000;

export function headerValue(headers, name) {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value || ""
  );
}

export function parseAddresses(value) {
  if (!value) {
    return [];
  }
  return addressparser(value)
    .map((entry) => entry.address?.toLowerCase())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function decodeBody(data) {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function truncate(value, maxChars) {
  if (value.length <= maxChars) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, maxChars)}\n\n[Body truncated by Gmail plugin]`,
    truncated: true,
  };
}

function collectParts(part, collected) {
  if (!part) {
    return;
  }

  const mimeType = (part.mimeType || "").toLowerCase();
  const filename = part.filename || "";
  const attachmentId = part.body?.attachmentId;

  if (filename || attachmentId) {
    collected.attachments.push({
      filename,
      mimeType,
      attachmentId: attachmentId || null,
      size: part.body?.size || 0,
      inlineData: part.body?.data || null,
    });
  } else if (part.body?.data) {
    const decoded = decodeBody(part.body.data);
    if (mimeType === "text/html") {
      collected.html.push(decoded);
    } else if (mimeType === "text/plain" || mimeType.startsWith("text/")) {
      collected.text.push(decoded);
    }
  }

  for (const child of part.parts || []) {
    collectParts(child, collected);
  }
}

export function messageSummary(message) {
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    snippet: message.snippet || "",
    internalDate: message.internalDate || null,
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    cc: headerValue(headers, "Cc"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
    messageIdHeader: headerValue(headers, "Message-ID"),
  };
}

export function formatMessage(message, maxBodyChars = DEFAULT_BODY_LIMIT) {
  const collected = { text: [], html: [], attachments: [] };
  collectParts(message.payload, collected);
  const text = truncate(collected.text.join("\n\n"), maxBodyChars);
  const html = truncate(collected.html.join("\n\n"), maxBodyChars);
  const headers = message.payload?.headers;

  return {
    ...messageSummary(message),
    bcc: headerValue(headers, "Bcc"),
    replyTo: headerValue(headers, "Reply-To"),
    inReplyTo: headerValue(headers, "In-Reply-To"),
    references: headerValue(headers, "References"),
    body: {
      text: text.value,
      html: html.value,
      textTruncated: text.truncated,
      htmlTruncated: html.truncated,
    },
    attachments: collected.attachments.map(
      ({ inlineData: _inlineData, ...attachment }) => attachment,
    ),
  };
}

export function attachmentParts(message) {
  const collected = { text: [], html: [], attachments: [] };
  collectParts(message.payload, collected);
  return collected.attachments;
}

export function buildReplyEnvelope({ account, headers, replyAll }) {
  const accountAddress = account.toLowerCase();
  const replyToTargets = parseAddresses(headerValue(headers, "Reply-To"));
  const directReplyTargets = unique(
    replyToTargets.length
      ? replyToTargets
      : parseAddresses(headerValue(headers, "From")),
  ).filter((address) => address !== accountAddress);
  const originalRecipients = unique([
    ...parseAddresses(headerValue(headers, "To")),
    ...parseAddresses(headerValue(headers, "Cc")),
  ]).filter((address) => address !== accountAddress);
  const to = directReplyTargets.length
    ? [directReplyTargets[0]]
    : originalRecipients.slice(0, 1);

  if (!to.length) {
    throw new Error("Unable to determine a reply recipient from the original message.");
  }

  const cc = replyAll
    ? unique([...directReplyTargets.slice(1), ...originalRecipients]).filter(
        (address) => !to.includes(address),
      )
    : [];
  const originalSubject = headerValue(headers, "Subject");
  const subject = /^re:/i.test(originalSubject)
    ? originalSubject
    : `Re: ${originalSubject || "(no subject)"}`;
  const messageId = headerValue(headers, "Message-ID");
  const existingReferences = headerValue(headers, "References");

  return {
    to,
    cc,
    subject,
    inReplyTo: messageId || undefined,
    references: unique(
      `${existingReferences} ${messageId}`.trim().split(/\s+/),
    ).join(" "),
  };
}

export function buildForwardBody(message, note = "") {
  const formatted = formatMessage(message, 200_000);
  const originalBody =
    formatted.body.text || formatted.body.html || formatted.snippet || "";
  const forwarded = [
    "---------- Forwarded message ---------",
    `From: ${formatted.from}`,
    `Date: ${formatted.date}`,
    `Subject: ${formatted.subject}`,
    `To: ${formatted.to}`,
    formatted.cc ? `Cc: ${formatted.cc}` : null,
    "",
    originalBody,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return note.trim() ? `${note.trim()}\n\n${forwarded}` : forwarded;
}
