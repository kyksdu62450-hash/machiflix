/* MACHIFLIX — compteur YouTube sans clé API ni table Supabase.
   Méthode non officielle et peu fiable : lecture des pages publiques via un proxy CORS.
   Le proxy peut être lent, indisponible ou limité. Cache local de 30 minutes.
*/
(function () {
  const CACHE_PREFIX = "machiflix_youtube_views_scrape_v1:";
  const CACHE_TTL = 30 * 60 * 1000;
  const PROXY = "https://api.allorigins.win/raw?url=";
  const MAX_PLAYLIST_VIDEOS = 30;

  function getCached(key) {
    try {
      const item = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || "null");
      if (item && Date.now() - item.savedAt < CACHE_TTL) return item.value;
    } catch (_) {}
    return null;
  }

  function setCached(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), value })); } catch (_) {}
  }

  function getYouTubeInfo(url) {
    if (!url) return { videoId: null, playlistId: null };
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (!(host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"))) {
        return { videoId: null, playlistId: null };
      }
      let videoId = parsed.searchParams.get("v");
      if (host === "youtu.be") videoId = parsed.pathname.split("/").filter(Boolean)[0] || null;
      if (!videoId && /^\/(shorts|embed)\//.test(parsed.pathname)) videoId = parsed.pathname.split("/")[2] || null;
      return { videoId, playlistId: parsed.searchParams.get("list") || null };
    } catch (_) { return { videoId: null, playlistId: null }; }
  }

  function isSeries(movie) {
    let genres = movie && movie.genre;
    if (typeof genres === "string") {
      try { genres = JSON.parse(genres); } catch (_) { genres = [genres]; }
    }
    if (!Array.isArray(genres)) genres = genres ? [genres] : [];
    return genres.some(g => String(g).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "serie");
  }

  async function fetchYouTubePage(url) {
    const response = await fetch(PROXY + encodeURIComponent(url), { cache: "no-store" });
    if (!response.ok) throw new Error("Le proxy YouTube ne répond pas.");
    return response.text();
  }

  async function getVideoViews(videoId) {
    const cached = getCached("video:" + videoId);
    if (cached !== null) return Number(cached) || 0;
    const html = await fetchYouTubePage("https://www.youtube.com/watch?v=" + encodeURIComponent(videoId));
    // Le champ viewCount apparaît normalement dans les données intégrées à la page YouTube.
    const matches = [...html.matchAll(/\"viewCount\"\s*:\s*\"(\d+)\"/g)];
    if (!matches.length) throw new Error("Nombre de vues introuvable pour cette vidéo.");
    const count = Number(matches[matches.length - 1][1]);
    setCached("video:" + videoId, count);
    return count;
  }

  async function getPlaylistViews(playlistId) {
    const cached = getCached("playlist-total:" + playlistId);
    if (cached !== null) return Number(cached) || 0;
    const html = await fetchYouTubePage("https://www.youtube.com/playlist?list=" + encodeURIComponent(playlistId));
    const ids = [...new Set([...html.matchAll(/\"videoId\"\s*:\s*\"([\w-]{11})\"/g)].map(m => m[1]))]
      .slice(0, MAX_PLAYLIST_VIDEOS);
    if (!ids.length) throw new Error("Vidéos de la playlist introuvables.");
    let total = 0;
    let successful = 0;
    // Limite volontaire : au plus 30 vidéos pour éviter trop de requêtes.
    for (const id of ids) {
      try { total += await getVideoViews(id); successful++; } catch (_) {}
    }
    if (!successful) throw new Error("Vues de la playlist indisponibles.");
    setCached("playlist-total:" + playlistId, total);
    return total;
  }

  async function syncYouTubeViews(movies) {
    return Promise.all((movies || []).map(async movie => {
      const info = getYouTubeInfo(movie.video_url || movie.video || movie.url);
      const usePlaylist = Boolean(info.playlistId && (!info.videoId || isSeries(movie)));
      try {
        if (usePlaylist && info.playlistId) {
          return { ...movie, views: await getPlaylistViews(info.playlistId), views_source: "youtube_approx" };
        }
        if (info.videoId) {
          return { ...movie, views: await getVideoViews(info.videoId), views_source: "youtube_approx" };
        }
      } catch (error) {
        console.warn("MACHIFLIX : vues YouTube indisponibles pour", movie.title || movie.name || "ce machinima", error.message);
      }
      return movie;
    }));
  }

  window.syncYouTubeViews = syncYouTubeViews;
})();
