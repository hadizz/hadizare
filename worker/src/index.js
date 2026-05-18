let cachedToken = null;
let tokenExpiresAt = 0;

// Public read-only API — allow any origin (file://, localhost, hadizare.com)
function corsHeaders(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  const requested = request?.headers?.get("Access-Control-Request-Headers");
  if (requested) {
    headers["Access-Control-Allow-Headers"] = requested;
  }
  return headers;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30",
      ...extraHeaders,
    },
  });
}

async function getAccessToken(env) {
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Spotify credentials are not configured");
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Token refresh failed");
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

function formatNowPlaying(payload) {
  if (!payload?.item) {
    return { isPlaying: false };
  }

  const { item, is_playing: isPlaying } = payload;
  const artists = (item.artists ?? []).map((a) => a.name).join(", ");

  return {
    isPlaying: Boolean(isPlaying),
    title: item.name,
    artist: artists,
    album: item.album?.name ?? "",
    albumImageUrl: item.album?.images?.[0]?.url ?? null,
    songUrl: item.external_urls?.spotify ?? null,
  };
}

async function fetchNowPlaying(env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (res.status === 204) {
    return { isPlaying: false };
  }

  if (res.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    throw new Error("Spotify token expired");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Spotify API error (${res.status})`);
  }

  return formatNowPlaying(await res.json());
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Max-Age": "86400" },
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    try {
      const data = await fetchNowPlaying(env);
      return json(data, 200, cors);
    } catch (err) {
      return json({ error: err.message, isPlaying: false }, 503, cors);
    }
  },
};
