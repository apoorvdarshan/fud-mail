import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(scriptsDir, "..");
const serverPath = path.join(pluginDir, "src", "server.mjs");
const testAccounts = [
  "primary@example.com",
  "work@example.org",
  "other@example.net",
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: pluginDir,
  env: {
    ...process.env,
    GMAIL_MCP_ACCOUNTS: testAccounts.join(","),
  },
  stderr: "pipe",
});
const client = new Client({
  name: "multi-account-gmail-mcp-smoke-test",
  version: "0.1.0",
});

await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map((tool) => tool.name).sort();

assert.deepEqual(names, [
  "batch_get_messages",
  "create_draft",
  "create_forward_draft",
  "create_label",
  "create_reply_draft",
  "delete_draft",
  "delete_label",
  "get_draft",
  "get_message",
  "get_profile",
  "get_thread",
  "list_drafts",
  "list_labels",
  "modify_message_labels",
  "permanently_delete_message",
  "permanently_delete_thread",
  "save_attachment",
  "search_messages",
  "send_draft",
  "send_email",
  "trash_message",
  "untrash_message",
  "update_draft",
  "update_label",
  "update_message_state",
]);

const sendTool = tools.find((tool) => tool.name === "send_draft");
assert.equal(sendTool.annotations?.readOnlyHint, false);
assert.equal(sendTool.annotations?.openWorldHint, true);
assert.deepEqual(sendTool.inputSchema.properties.account.enum, testAccounts);
assert.ok(sendTool.inputSchema.required.includes("account"));

const searchTool = tools.find((tool) => tool.name === "search_messages");
assert.equal(searchTool.annotations?.readOnlyHint, true);

const trashTool = tools.find((tool) => tool.name === "trash_message");
assert.equal(trashTool.annotations?.destructiveHint, true);

const permanentDeleteTool = tools.find(
  (tool) => tool.name === "permanently_delete_message",
);
assert.equal(permanentDeleteTool.annotations?.destructiveHint, true);

const directSendTool = tools.find((tool) => tool.name === "send_email");
assert.equal(directSendTool.annotations?.openWorldHint, true);

await client.close();
console.log(`Smoke test passed with ${tools.length} tools.`);
