/**
 * One-time: get SPOTIFY_REFRESH_TOKEN (not shown in Spotify Dashboard).
 *
 * Dashboard gives you: Client ID + Client secret only.
 * This script opens Spotify login → you approve → prints refresh_token.
 *
 * 1. Copy scripts/.env.example → scripts/.env (fill CLIENT_ID + CLIENT_SECRET)
 * 2. Dashboard → your app → Settings → Redirect URIs → add:
 *      http://127.0.0.1:8888/callback
 * 3. Run: node scripts/get-refresh-token.mjs
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing scripts/.env — copy scripts/.env.example and add credentials.");
    process.exit(1);
  }
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = "user-read-currently-playing user-read-playback-state";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in scripts/.env");
  process.exit(1);
}

const authUrl = new URL("https://accounts.spotify.com/authorize");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES);

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting for callback on http://127.0.0.1:8888/callback …\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8888");
  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(error || "Missing authorization code");
    server.close();
    process.exit(1);
    return;
  }

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await tokenRes.json();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>Success</h1><p>You can close this tab and check the terminal.</p>");
  server.close();

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", data);
    process.exit(1);
  }

  console.log("─── Copy this value (refresh token) ───\n");
  console.log(data.refresh_token);
  console.log("\n─── Then set all three Worker secrets ───\n");
  console.log("  npx wrangler secret put SPOTIFY_CLIENT_ID");
  console.log("  npx wrangler secret put SPOTIFY_CLIENT_SECRET");
  console.log("  npx wrangler secret put SPOTIFY_REFRESH_TOKEN  ← paste the token above\n");
  process.exit(0);
});

server.listen(8888, () => {
  const open =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${open} "${authUrl}"`);
});
