// Serialize writes so an older refresh cannot overwrite a newer one.
export function persistTokenUpdates(client, initialTokens, save, report = console.error) {
  let tokens = { ...initialTokens };
  let pending = Promise.resolve();
  client.on("tokens", (update) => {
    tokens = { ...tokens, ...update };
    const snapshot = { ...tokens };
    pending = pending.then(() => save(snapshot)).catch(() => {
      // Never log the underlying error: Keychain command arguments contain tokens.
      report("[gmail-mcp] Refreshed OAuth tokens could not be saved to macOS Keychain. Check Keychain access; authorize again if access expires. The current session may continue with in-memory credentials.");
    });
  });
  return () => pending;
}
