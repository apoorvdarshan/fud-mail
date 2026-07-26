import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { google } from "googleapis";
import {
  createOAuthClient,
  GMAIL_FULL_MAILBOX_SCOPE,
  requireSupportedEmail,
  saveTokensToKeychain,
} from "../src/google-auth.mjs";

const execFileAsync = promisify(execFile);
const account = requireSupportedEmail(process.argv[2]);
const state = randomBytes(32).toString("hex");
let redirectUri;

const callback = await new Promise((resolve, reject) => {
  const httpServer = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(
        request.url || "/",
        `http://${request.headers.host}`,
      );

      if (requestUrl.pathname !== "/oauth2callback") {
        response.writeHead(404).end("Not found");
        return;
      }

      if (requestUrl.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid OAuth state.");
        reject(new Error("Google OAuth state validation failed."));
        httpServer.close();
        return;
      }

      const oauthError = requestUrl.searchParams.get("error");
      if (oauthError) {
        response.writeHead(400).end(`Authorization failed: ${oauthError}`);
        reject(new Error(`Google authorization failed: ${oauthError}`));
        httpServer.close();
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        response.writeHead(400).end("Missing authorization code.");
        reject(new Error("Google returned no authorization code."));
        httpServer.close();
        return;
      }

      response
        .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Gmail authorization received. You can close this browser tab.");
      resolve({ code, redirectUri });
      httpServer.close();
    } catch (error) {
      reject(error);
      httpServer.close();
    }
  });

  httpServer.on("error", reject);
  httpServer.listen(0, "127.0.0.1", async () => {
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      reject(new Error("Unable to start the local OAuth callback server."));
      return;
    }

    redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
    const oauth2Client = await createOAuthClient({ redirectUri });
    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      login_hint: account,
      scope: [GMAIL_FULL_MAILBOX_SCOPE],
      state,
    });

    console.log(`Opening Google authorization for ${account}...`);
    console.log(`Authorization URL: ${authorizationUrl}`);
    if (process.env.GMAIL_MCP_NO_OPEN !== "1") {
      await execFileAsync("open", [authorizationUrl]);
    }
  });
});

const oauth2Client = await createOAuthClient({
  redirectUri: callback.redirectUri,
});
const { tokens } = await oauth2Client.getToken(callback.code);
oauth2Client.setCredentials(tokens);

const gmail = google.gmail({ version: "v1", auth: oauth2Client });
const { data: profile } = await gmail.users.getProfile({ userId: "me" });

if (profile.emailAddress?.toLowerCase() !== account.toLowerCase()) {
  throw new Error(
    `Authorized ${profile.emailAddress || "an unknown account"} instead of ${account}. Nothing was saved.`,
  );
}

await saveTokensToKeychain(account, tokens);
console.log(`Authorized ${profile.emailAddress}. OAuth token saved to macOS Keychain.`);
