import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { google } from "googleapis";
import { persistTokenUpdates } from "./token-persistence.mjs";

const execFileAsync = promisify(execFile);

export const GMAIL_FULL_MAILBOX_SCOPE = "https://mail.google.com/";

const KEYCHAIN_SERVICE =
  process.env.GMAIL_MCP_KEYCHAIN_SERVICE ||
  "multi-account-gmail-mcp-google-oauth";
const CONFIG_DIR =
  process.env.GMAIL_MCP_CONFIG_DIR ||
  path.join(os.homedir(), ".config", "multi-account-gmail-mcp");
const CLIENT_FILE =
  process.env.GMAIL_MCP_OAUTH_CLIENT_FILE ||
  path.join(CONFIG_DIR, "client_secret.json");
const ACCOUNTS_FILE =
  process.env.GMAIL_MCP_ACCOUNTS_FILE ||
  path.join(CONFIG_DIR, "accounts.json");

function normalizeAccounts(accounts) {
  return [
    ...new Set(
      accounts
        .map((account) => String(account).trim().toLowerCase())
        .filter((account) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)),
    ),
  ];
}

function loadSupportedEmails() {
  const environmentAccounts = process.env.GMAIL_MCP_ACCOUNTS;
  if (environmentAccounts) {
    const accounts = normalizeAccounts(environmentAccounts.split(","));
    if (accounts.length) {
      return accounts;
    }
  }

  try {
    const document = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    const configuredAccounts = Array.isArray(document)
      ? document
      : document.accounts;
    const accounts = normalizeAccounts(
      Array.isArray(configuredAccounts) ? configuredAccounts : [],
    );
    if (accounts.length) {
      return accounts;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(
        `Unable to read Gmail account configuration at ${ACCOUNTS_FILE}: ${error.message}`,
      );
    }
  }

  throw new Error(
    `No Gmail accounts are configured. Run npm run configure -- user@example.com first, or set GMAIL_MCP_ACCOUNTS.`,
  );
}

export const SUPPORTED_EMAILS = loadSupportedEmails();

function credentialsFromDocument(document) {
  const credentials = document.installed || document.web;
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error(
      `OAuth client file ${CLIENT_FILE} does not contain installed or web client credentials.`,
    );
  }
  return credentials;
}

export async function loadClientCredentials() {
  let raw;
  try {
    raw = await readFile(CLIENT_FILE, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Missing OAuth client file at ${CLIENT_FILE}. Download a Google Desktop OAuth client JSON there first.`,
      );
    }
    throw error;
  }

  return credentialsFromDocument(JSON.parse(raw));
}

export function requireSupportedEmail(account) {
  const normalized = String(account || "").toLowerCase();
  const supported = SUPPORTED_EMAILS.find(
    (email) => email.toLowerCase() === normalized,
  );
  if (!supported) {
    throw new Error(
      `Unsupported mail account: ${account || "(missing)"}. Choose one of: ${SUPPORTED_EMAILS.join(", ")}.`,
    );
  }
  return supported;
}

export async function loadTokensFromKeychain(account) {
  const expectedEmail = requireSupportedEmail(account);
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a",
      expectedEmail,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ]);
    return JSON.parse(stdout.trim());
  } catch (error) {
    if (error?.code === 44 || error?.stderr?.includes("could not be found")) {
      throw new Error(
        `No OAuth token is stored for ${expectedEmail}. Run npm run auth -- ${expectedEmail} first.`,
      );
    }
    throw new Error(
      `Unable to read the Gmail OAuth token from macOS Keychain: ${error.message}`,
    );
  }
}

export async function saveTokensToKeychain(account, tokens) {
  const expectedEmail = requireSupportedEmail(account);
  try {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-a",
      expectedEmail,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      JSON.stringify(tokens),
    ]);
  } catch {
    // execFile errors can contain the command arguments, including tokens.
    throw new Error("Unable to save Gmail OAuth tokens to macOS Keychain. Check Keychain access and authorize again if needed.");
  }
}

export async function createOAuthClient({ redirectUri } = {}) {
  const credentials = await loadClientCredentials();
  const client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    redirectUri,
  );
  return client;
}

export async function createAuthorizedGmail(account) {
  const expectedEmail = requireSupportedEmail(account);
  const oauth2Client = await createOAuthClient();
  const currentTokens = await loadTokensFromKeychain(expectedEmail);
  oauth2Client.setCredentials(currentTokens);

  persistTokenUpdates(oauth2Client, currentTokens, (tokens) =>
    saveTokensToKeychain(expectedEmail, tokens),
  );

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const { data: profile } = await gmail.users.getProfile({ userId: "me" });

  if (profile.emailAddress?.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error(
      `Mail is authenticated as ${profile.emailAddress || "an unknown account"}, not ${expectedEmail}.`,
    );
  }

  return { gmail, profile };
}
