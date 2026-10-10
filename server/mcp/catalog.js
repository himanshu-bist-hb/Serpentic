// 20 everyday SerpApi MCP servers. Each entry: { key, name, engine, desc, tools: [...] }.
// Results are "slimmed" (thumbnails, SerpApi links and long text removed) so they stay cheap for the LLM.

const SERPAPI_URL = "https://serpapi.com/search.json";

async function serp(params) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured");
  const q = new URLSearchParams({ api_key: key });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const res = await fetch(`${SERPAPI_URL}?${q}`, { signal: AbortSignal.timeout(45000) });
  const data = await res.json().catch(() => ({}));
  // SerpApi reports "no results" as an error; treat it as an empty result instead.
  if (data.error && /hasn't returned any results|no results/i.test(data.error)) return {};
  if (!res.ok || data.error) throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  return data;
}

const DROP = /^(thumbnail|thumbnails|favicon|serpapi_.*|.*_thumbnail|search_metadata|search_parameters|pagination|serpapi_pagination)$/;
function slim(v, max = 400) {
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…" : v;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => slim(x, max));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!DROP.test(k)) out[k] = slim(x, max);
    return out;
  }
  return v;
}
const lim = (a, n, d = 8) => Math.min(Math.max(parseInt(a?.limit ?? d, 10) || d, 1), n);
const first = (...xs) => xs.find((x) => Array.isArray(x) && x.length) || [];
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
const hasData = (o) => Object.keys(o).length > 0;

const S = (description) => ({ type: "string", description });
const I = (description) => ({ type: "integer", description });
const LIMIT = I("Max results to return (default 8)");
const tool = (name, description, properties, required, handler) => ({
  name, description, inputSchema: { type: "object", properties, required }, handler,
});

const SERVERS = [
  {
    key: "web-search", name: "Google Search", engine: "google",
    desc: "Web search with answer boxes, knowledge panels and related questions.",
    tools: [
      tool("search_web", "Search Google. Returns organic results, an instant answer if Google shows one, the knowledge panel and related questions.",
        { q: S("Search query"), location: S("Optional location, e.g. 'Delhi, India'"), gl: S("Country code, default 'in'"), hl: S("Language code, default 'en'"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google", q: a.q, location: a.location, gl: a.gl || "in", hl: a.hl || "en" });
          return compact({
            answer: slim(d.answer_box), knowledge_graph: slim(d.knowledge_graph),
            results: slim(first(d.organic_results).slice(0, lim(a, 20)).map(({ title, link, snippet, displayed_link, date }) => ({ title, link, snippet, displayed_link, date }))),
            related_questions: slim((d.related_questions || []).slice(0, 5).map(({ question, snippet }) => ({ question, snippet }))),
          });
        }),
    ],
  },
  {
    key: "duckduckgo-search", name: "DuckDuckGo Search", engine: "duckduckgo",
    desc: "Privacy-friendly web search as a second opinion to Google.",
    tools: [
      tool("search_duckduckgo", "Search the web with DuckDuckGo.", { q: S("Search query"), kl: S("Region-language, e.g. 'in-en' or 'us-en'"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "duckduckgo", q: a.q, kl: a.kl || "in-en" });
          return { results: slim(first(d.organic_results).slice(0, lim(a, 20)).map(({ title, link, snippet }) => ({ title, link, snippet }))) };
        }),
    ],
  },
  {
    key: "google-autocomplete", name: "Google Autocomplete", engine: "google_autocomplete",
    desc: "Search suggestions: what people type after your keyword.",
    tools: [
      tool("suggest_queries", "Get Google autocomplete suggestions for a partial query. Useful for keyword ideas.", { q: S("Partial query"), gl: S("Country code, default 'in'") }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_autocomplete", q: a.q, gl: a.gl || "in" });
          return { suggestions: (d.suggestions || []).map((s) => s.value).filter(Boolean) };
        }),
    ],
  },
  {
    key: "google-maps", name: "Google Maps", engine: "google_maps",
    desc: "Find places near a location, with ratings, hours and reviews.",
    tools: [
      tool("search_places", "Search Google Maps for businesses and places (for example 'biryani near Connaught Place'). Returns rating, address, phone, hours, and ids for reviews.",
        { q: S("What to find, include the area"), ll: S("Optional map centre like '@28.6139,77.2090,14z'"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_maps", type: "search", q: a.q, ll: a.ll, hl: "en", gl: "in" });
          const one = d.place_results ? [d.place_results] : [];
          const pick = ({ title, rating, reviews, type, address, phone, hours, price, website, data_id, place_id, gps_coordinates }) => ({ title, rating, reviews, type, address, phone, hours, price, website, data_id, place_id, gps_coordinates });
          return { places: slim([...one, ...(d.local_results || [])].slice(0, lim(a, 20)).map(pick)) };
        }),
      tool("get_place_reviews", "Get recent Google Maps reviews for a place using its data_id from search_places.",
        { data_id: S("data_id from search_places"), limit: LIMIT }, ["data_id"],
        async (a) => {
          const d = await serp({ engine: "google_maps_reviews", data_id: a.data_id, hl: "en" });
          return compact({
            place: slim(d.place_info),
            reviews: slim((d.reviews || []).slice(0, lim(a, 20)).map((r) => ({ user: r.user?.name, rating: r.rating, date: r.date, text: r.snippet || r.extracted_snippet?.original }))),
          });
        }),
    ],
  },
  {
    key: "google-finance", name: "Google Finance", engine: "google_finance",
    desc: "Stock, index, crypto and currency quotes plus market movers.",
    tools: [
      tool("get_quote", "Get a quote for a ticker in Google Finance format, for example 'RELIANCE:NSE', 'GOOGL:NASDAQ', 'BTC-USD' or 'USD-INR'.",
        { q: S("Ticker like 'TCS:NSE'") }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_finance", q: a.q, hl: "en" });
          return compact({ summary: slim(d.summary), key_stats: slim(d.key_stats), about: slim(d.knowledge_graph?.about) });
        }),
      tool("get_market_movers", "Market overview lists. trend: indexes, most-active, gainers, losers, climbers, cryptocurrencies or currencies.",
        { trend: S("One of indexes, most-active, gainers, losers, climbers, cryptocurrencies, currencies"), limit: LIMIT }, ["trend"],
        async (a) => {
          const d = await serp({ engine: "google_finance_markets", trend: a.trend, hl: "en" });
          const n = lim(a, 20, 10);
          const out = {};
          for (const [k, v] of Object.entries(d.markets || {})) out[k] = Array.isArray(v) ? slim(v.slice(0, n)) : slim(v);
          return out;
        }),
    ],
  },
  {
    key: "google-shopping", name: "Google Shopping", engine: "google_shopping",
    desc: "Compare product prices and sellers across stores.",
    tools: [
      tool("search_products", "Search Google Shopping for a product. Returns title, price, seller, rating and delivery. Prices default to India.",
        { q: S("Product search"), gl: S("Country code, default 'in'"), min_price: I("Minimum price"), max_price: I("Maximum price"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_shopping", q: a.q, gl: a.gl || "in", hl: "en", min_price: a.min_price, max_price: a.max_price });
          return { products: slim(first(d.shopping_results).slice(0, lim(a, 30, 10)).map(({ title, price, extracted_price, source, rating, reviews, delivery, product_link, link, tag }) => ({ title, price, extracted_price, source, rating, reviews, delivery, tag, link: product_link || link }))) };
        }),
    ],
  },
  {
    key: "google-jobs", name: "Google Jobs", engine: "google_jobs",
    desc: "Job listings from across the web with company, location and apply links.",
    tools: [
      tool("search_jobs", "Search job postings, for example 'product designer Bengaluru'.",
        { q: S("Role and optionally city"), location: S("Optional location"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_jobs", q: a.q, location: a.location, gl: "in", hl: "en" });
          return { jobs: slim((d.jobs_results || []).slice(0, lim(a, 20)).map((j) => ({ title: j.title, company: j.company_name, location: j.location, via: j.via, posted: j.detected_extensions?.posted_at, type: j.detected_extensions?.schedule_type, salary: j.detected_extensions?.salary, description: j.description, apply: j.apply_options?.[0]?.link || j.share_link })), 350) };
        }),
    ],
  },
  {
    key: "google-scholar", name: "Google Scholar", engine: "google_scholar",
    desc: "Academic papers with citation counts.",
    tools: [
      tool("search_papers", "Search scholarly articles. Returns title, authors/publication, snippet and number of citations.",
        { q: S("Topic or title"), from_year: I("Only papers from this year onward"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_scholar", q: a.q, as_ylo: a.from_year, hl: "en" });
          return { papers: slim(first(d.organic_results).slice(0, lim(a, 20)).map((p) => ({ title: p.title, link: p.link, publication: p.publication_info?.summary, snippet: p.snippet, cited_by: p.inline_links?.cited_by?.total, pdf: p.resources?.[0]?.link }))) };
        }),
    ],
  },
  {
    key: "google-trends", name: "Google Trends", engine: "google_trends",
    desc: "Interest over time and what is trending right now.",
    tools: [
      tool("get_interest_over_time", "Search interest over time for up to 5 comma-separated terms (relative 0-100).",
        { q: S("Terms, comma separated"), geo: S("Region code, default 'IN'"), date: S("Range like 'today 12-m', 'today 3-m', 'today 5-y'") }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_trends", q: a.q, data_type: "TIMESERIES", geo: a.geo || "IN", date: a.date || "today 12-m" });
          const rows = d.interest_over_time?.timeline_data || [];
          return { averages: slim(d.interest_over_time?.averages), points: rows.length, timeline: slim(rows.filter((_, i) => i % Math.ceil(rows.length / 24 || 1) === 0).map((r) => ({ date: r.date, values: r.values?.map((v) => ({ query: v.query, value: v.extracted_value ?? v.value })) }))) };
        }),
      tool("get_trending_now", "Searches trending right now in a country.", { geo: S("Region code, default 'IN'"), limit: LIMIT }, [],
        async (a) => {
          const d = await serp({ engine: "google_trends_trending_now", geo: a.geo || "IN", hl: "en" });
          return { trending: slim((d.trending_searches || []).slice(0, lim(a, 30, 15)).map((t) => ({ query: t.query, search_volume: t.search_volume, increase: t.increase_percentage, categories: t.categories?.map((c) => c.name) }))) };
        }),
    ],
  },
  {
    key: "google-events", name: "Google Events", engine: "google_events",
    desc: "Concerts, shows, meetups and things to do in a city.",
    tools: [
      tool("search_events", "Find events, for example 'concerts in Mumbai this weekend'.", { q: S("Events query including place"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_events", q: a.q, hl: "en", gl: "in" });
          return { events: slim((d.events_results || []).slice(0, lim(a, 20)).map((e) => ({ title: e.title, when: e.date?.when, start: e.date?.start_date, address: e.address?.join?.(", "), venue: e.venue?.name, link: e.link, description: e.description }))) };
        }),
    ],
  },
  {
    key: "google-images", name: "Google Images", engine: "google_images",
    desc: "Image search with source pages and original image links.",
    tools: [
      tool("search_images", "Search Google Images. Returns title, source and the original image URL.", { q: S("Search query"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_images", q: a.q, hl: "en", gl: "in" });
          return { images: (d.images_results || []).slice(0, lim(a, 30)).map((i) => ({ title: i.title, source: i.source, page: i.link, image: i.original })) };
        }),
    ],
  },
  {
    key: "youtube-search", name: "YouTube", engine: "youtube",
    desc: "Search videos and read a video's details.",
    tools: [
      tool("search_videos", "Search YouTube videos. Returns title, channel, views, length and link.", { query: S("Search query"), limit: LIMIT }, ["query"],
        async (a) => {
          const d = await serp({ engine: "youtube", search_query: a.query, gl: "in", hl: "en" });
          return { videos: slim(first(d.video_results).slice(0, lim(a, 20)).map((v) => ({ title: v.title, channel: v.channel?.name, views: v.views, published: v.published_date, length: v.length, link: v.link, description: v.description }))) };
        }),
      tool("get_video_details", "Get a YouTube video's title, channel, stats and description by video id (the v= part of the URL).", { video_id: S("YouTube video id") }, ["video_id"],
        async (a) => {
          const d = await serp({ engine: "youtube_video", v: a.video_id });
          return slim(compact({ title: d.title, channel: d.channel?.name, views: d.extracted_views ?? d.views, likes: d.extracted_likes ?? d.likes, published: d.published_date, description: d.description?.content || d.description, chapters: d.chapters?.slice?.(0, 12), related: d.related_videos?.slice?.(0, 5).map((v) => ({ title: v.title, link: v.link })) }), 900);
        }),
    ],
  },
  {
    key: "youtube-transcript", name: "YouTube Transcript", engine: "youtube_video_transcript",
    desc: "Full transcript of a YouTube video for summaries.",
    tools: [
      tool("get_transcript", "Get the transcript text of a YouTube video by id. Long transcripts are cut at about 20,000 characters.", { video_id: S("YouTube video id"), language_code: S("Language, default 'en'") }, ["video_id"],
        async (a) => {
          const d = await serp({ engine: "youtube_video_transcript", v: a.video_id, language_code: a.language_code || "en" });
          const text = (d.transcript || []).map((t) => t.snippet).join(" ");
          return { characters: text.length, transcript: text.length > 20000 ? text.slice(0, 20000) + "…" : text };
        }),
    ],
  },
  {
    key: "amazon", name: "Amazon", engine: "amazon",
    desc: "Search Amazon and read product details. Defaults to amazon.in.",
    tools: [
      tool("search_amazon", "Search Amazon products.", { k: S("Search keywords"), amazon_domain: S("Default 'amazon.in'"), limit: LIMIT }, ["k"],
        async (a) => {
          const d = await serp({ engine: "amazon", k: a.k, amazon_domain: a.amazon_domain || "amazon.in" });
          return { products: slim(first(d.organic_results).slice(0, lim(a, 30, 10)).map((p) => ({ title: p.title, asin: p.asin, price: p.price, rating: p.rating, reviews: p.reviews, prime: p.prime, link: p.link_clean || p.link }))) };
        }),
      tool("get_amazon_product", "Get an Amazon product's details by ASIN.", { asin: S("Product ASIN"), amazon_domain: S("Default 'amazon.in'") }, ["asin"],
        async (a) => {
          const d = await serp({ engine: "amazon_product", asin: a.asin, amazon_domain: a.amazon_domain || "amazon.in" });
          return slim(compact({ product: d.product_results, about: d.about_item, details: d.product_details, reviews: d.reviews_information?.summary }), 600);
        }),
    ],
  },
  {
    key: "ebay", name: "eBay", engine: "ebay",
    desc: "Search eBay listings with price, condition and seller.",
    tools: [
      tool("search_ebay", "Search eBay listings.", { query: S("Search keywords"), ebay_domain: S("Default 'ebay.com'"), limit: LIMIT }, ["query"],
        async (a) => {
          const d = await serp({ engine: "ebay", _nkw: a.query, ebay_domain: a.ebay_domain || "ebay.com" });
          return { listings: slim(first(d.organic_results).slice(0, lim(a, 30, 10)).map((p) => ({ title: p.title, price: p.price?.raw || p.price, condition: p.condition, shipping: p.shipping, seller: p.seller?.username, location: p.location, link: p.link }))) };
        }),
    ],
  },
  {
    key: "walmart", name: "Walmart", engine: "walmart",
    desc: "Search Walmart products with prices and ratings.",
    tools: [
      tool("search_walmart", "Search Walmart products.", { query: S("Search keywords"), limit: LIMIT }, ["query"],
        async (a) => {
          const d = await serp({ engine: "walmart", query: a.query });
          return { products: slim(first(d.organic_results).slice(0, lim(a, 30, 10)).map((p) => ({ title: p.title, id: p.us_item_id, price: p.primary_offer?.offer_price, rating: p.rating, reviews: p.reviews, seller: p.seller_name, link: p.product_page_url }))) };
        }),
    ],
  },
  {
    key: "yelp", name: "Yelp", engine: "yelp",
    desc: "Local businesses with ratings, categories and price level.",
    tools: [
      tool("search_yelp", "Search Yelp for businesses, for example find_desc 'sushi' in find_loc 'San Francisco, CA'.", { find_desc: S("What to find"), find_loc: S("Location"), limit: LIMIT }, ["find_desc", "find_loc"],
        async (a) => {
          const d = await serp({ engine: "yelp", find_desc: a.find_desc, find_loc: a.find_loc });
          return { businesses: slim(first(d.organic_results).slice(0, lim(a, 30, 10)).map((b) => ({ name: b.title, rating: b.rating, reviews: b.reviews, price: b.price, categories: b.categories?.map((c) => c.title || c), neighborhoods: b.neighborhoods, phone: b.phone, snippet: b.snippet, link: b.link }))) };
        }),
    ],
  },
  {
    key: "google-play", name: "Google Play", engine: "google_play",
    desc: "Android apps and games search.",
    tools: [
      tool("search_android_apps", "Search Google Play. store: apps (default), games, movies or books.", { q: S("Search query"), store: S("apps, games, movies or books"), limit: LIMIT }, ["q"],
        async (a) => {
          const d = await serp({ engine: "google_play", q: a.q, store: a.store || "apps", gl: "in", hl: "en" });
          const items = (d.organic_results || []).flatMap((s) => s.items || [s]);
          return { results: slim(items.slice(0, lim(a, 30, 10)).map((p) => ({ title: p.title, developer: p.author || p.developer, rating: p.rating, category: p.category, price: p.price, id: p.product_id, link: p.link }))) };
        }),
    ],
  },
  {
    key: "apple-app-store", name: "Apple App Store", engine: "apple_app_store",
    desc: "iPhone and iPad apps search.",
    tools: [
      tool("search_ios_apps", "Search the Apple App Store.", { term: S("Search term"), country: S("Country code, default 'in'"), limit: LIMIT }, ["term"],
        async (a) => {
          const d = await serp({ engine: "apple_app_store", term: a.term, country: a.country || "in", lang: "en-us" });
          return { apps: slim(first(d.organic_results).slice(0, lim(a, 30, 10)).map((p) => ({ title: p.title, id: p.id, developer: p.developer?.name || p.developer, rating: p.rating?.[0]?.rating, ratings_count: p.rating?.[0]?.count, price: p.price, category: p.genres?.[0]?.name || p.category, link: p.link }))) };
        }),
    ],
  },
  {
    key: "airbnb", name: "Airbnb", engine: "airbnb",
    desc: "Stays with price per night, rating and capacity.",
    tools: [
      tool("search_stays", "Search Airbnb stays in a place for given dates.", { query: S("Place, e.g. 'Goa, India'"), check_in_date: S("YYYY-MM-DD"), check_out_date: S("YYYY-MM-DD"), adults: I("Number of adults"), currency: S("Default 'INR'"), limit: LIMIT }, ["query", "check_in_date", "check_out_date"],
        async (a) => {
          const d = await serp({ engine: "airbnb", query: a.query, check_in_date: a.check_in_date, check_out_date: a.check_out_date, adults: a.adults, currency: a.currency || "INR" });
          return { stays: slim((d.properties || []).slice(0, lim(a, 30, 10)).map((p) => ({ title: p.title, rating: p.rating, reviews: p.reviews, price: p.price?.formatted || p.price?.total || p.price, bedrooms: p.bedrooms, beds: p.beds, superhost: p.superhost, link: p.link }))) };
        }),
    ],
  },
];

// MCP-module shape used by the in-process runner and the HTTP endpoints.
const modules = Object.fromEntries(SERVERS.map((s) => [s.key, { SERVER_INFO: { name: `${s.key}-mcp`, version: "1.0.0" }, TOOLS: s.tools }]));

module.exports = { SERVERS, modules, serp, hasData };
