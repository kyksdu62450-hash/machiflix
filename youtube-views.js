/* MACHIFLIX — lecture des vues mises en cache dans Supabase.
   Aucun appel YouTube n'est effectué depuis le navigateur.
   Si la table ou le réseau est indisponible, le catalogue continue de s'afficher.
*/
(function () {
  let cachedRows = null;
  let cachedAt = 0;
  const CACHE_TTL = 60 * 1000;

  async function loadViews() {
    if (cachedRows && Date.now() - cachedAt < CACHE_TTL) return cachedRows;
    if (typeof SUPABASE_URL !== "string" || typeof SUPABASE_KEY !== "string") {
      return cachedRows || new Map();
    }
    try {
      const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/youtube_views?select=machinima_id,views_count`;
      const response = await fetch(endpoint, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json"
        }
      });
      if (!response.ok) throw new Error(`Supabase ${response.status}`);
      const rows = await response.json();
      cachedRows = new Map((rows || []).map(row => [String(row.machinima_id), Number(row.views_count) || 0]));
      cachedAt = Date.now();
      return cachedRows;
    } catch (error) {
      console.warn("MACHIFLIX : vues mises en cache indisponibles; le catalogue reste affiché.", error);
      return cachedRows || new Map();
    }
  }

  async function syncYouTubeViews(movies) {
    const counts = await loadViews();
    return (movies || []).map(movie => {
      const key = String(movie.id ?? "");
      if (!counts.has(key)) return movie;
      return { ...movie, views: counts.get(key), views_source: "supabase_cache" };
    });
  }

  window.syncYouTubeViews = syncYouTubeViews;
})();
