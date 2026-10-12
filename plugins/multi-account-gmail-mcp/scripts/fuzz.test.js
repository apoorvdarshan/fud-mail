import assert from "node:assert/strict";
import fc from "fast-check";
import { parseAddresses, formatMessage, buildReplyEnvelope } from "../src/message-utils.mjs";
const options = { numRuns: 1000, seed: 20261013 };
fc.assert(fc.property(fc.string({maxLength: 2048}), value => {
  const addresses = parseAddresses(value);
  assert.ok(addresses.every(a => typeof a === "string" && a === a.toLowerCase()));
}), options);
fc.assert(fc.property(fc.string({maxLength: 4096}), fc.integer({min: 0, max: 1024}), (body, limit) => {
  const result = formatMessage({ payload: { mimeType: "text/plain", body: { data: Buffer.from(body).toString("base64url") } } }, limit);
  const normalized = Buffer.from(body).toString("utf8");
  assert.equal(result.body.textTruncated, normalized.length > limit);
  assert.ok(result.body.text.startsWith(normalized.slice(0, limit)));
  assert.ok(result.body.text.length <= limit + 34);
}), options);
fc.assert(fc.property(fc.array(fc.integer({min: 0, max: 30}), {minLength: 1,maxLength: 30}), ids => {
  const recipients = ids.map(id => `person${id}@example.com`);
  const result = buildReplyEnvelope({ account: "owner@example.com", replyAll: true, headers: [
    {name: "From", value: "sender@example.com"},
    {name: "To", value: ["owner@example.com", ...recipients].join(", ")},
    {name: "Cc", value: recipients.join(", ")},
  ] });
  const all = [...result.to, ...result.cc];
  assert.ok(!all.includes("owner@example.com"));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(new Set(result.cc), new Set(recipients));
}), options);
console.log("Fuzz/property tests passed: 3000 generated cases.");
