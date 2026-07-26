import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const accounts = [
  ...new Set(
    process.argv
      .slice(2)
      .map((account) => account.trim().toLowerCase())
      .filter(Boolean),
  ),
];

if (!accounts.length) {
  throw new Error(
    "Provide at least one Gmail address: npm run configure -- user@example.com",
  );
}

for (const account of accounts) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
    throw new Error(`Invalid email address: ${account}`);
  }
}

const configDirectory =
  process.env.GMAIL_MCP_CONFIG_DIR ||
  path.join(os.homedir(), ".config", "multi-account-gmail-mcp");
const accountsFile =
  process.env.GMAIL_MCP_ACCOUNTS_FILE ||
  path.join(configDirectory, "accounts.json");

await mkdir(path.dirname(accountsFile), { recursive: true });
await writeFile(
  accountsFile,
  `${JSON.stringify({ accounts }, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(`Configured ${accounts.length} Gmail account(s) in ${accountsFile}.`);
for (const account of accounts) {
  console.log(`Next: npm run auth -- ${account}`);
}
