const SERPAPI_URL = "https://serpapi.com/search.json";
const SERVER_INFO = { name: "google-news-mcp", version: "1.0.0" };

async function serp(params) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");
  const res = await fetch(`${SERPAPI_URL}?${new URLSearchParams({ api_key: key, ...params })}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  return data;
}

function mapArticle(a) {
  return {
    title: a.title,
    source: a.source?.name,
    published: a.iso_date || null,
    link: a.link,
    thumbnail: a.thumbnail || null,
  };
}

// Google groups related articles into clusters (`stories`); flatten, dedupe and sort.
function flatten(results) {
  const out = [];
  const seen = new Set();
  const add = (a) => {
    if (!a?.title || !a.link || seen.has(a.link)) return;
    seen.add(a.link);
    out.push(mapArticle(a));
  };
  for (const r of results || []) {
    if (r.stories) r.stories.forEach(add);
    else add(r);
  }
  return out;
}

async function fetchNews({ query, days, region }) {
  let data;
  try {
    data = await serp({
    engine: "google_news",
    // `when:Nd` limits recency inside the query (q cannot be combined with the `so` sort param)
    q: `${query} when:${days}d`,
    gl: (region || "in").toLowerCase(),
    hl: "en",
    });
  } catch (e) {
    // "No results" is a valid answer for niche subjects, not a failure.
    if (/hasn't returned any results/i.test(e.message)) return [];
    throw e;
  }
  const cutoff = Date.now() - days * 86400000;
  return flatten(data.news_results)
    .filter((a) => a.published && new Date(a.published).getTime() >= cutoff)
    .sort((a, b) => new Date(b.published) - new Date(a.published));
}

function clampDays(d, def) {
  return Math.min(Math.max(Number(d) || def, 1), 30);
}

async function searchTravelNews(args) {
  const days = clampDays(args.days, 7);
  const articles = await fetchNews({ query: args.query, days, region: args.region });
  const limit = Math.min(Math.max(args.limit || 10, 1), 30);
  return {
    query: args.query,
    window_days: days,
    articles: articles.slice(0, limit),
    total_found: articles.length,
    note: "Newest first. Headlines and links only; Google News does not return article text.",
  };
}

const CATEGORIES = {
  weather: /\b(flood|cyclone|storm|rain|monsoon|landslide|heatwave|fog|snow|blizzard|hurricane|typhoon|earthquake|tsunami|wildfire)\w*/i,
  strike_or_protest: /\b(strike|protest|bandh|shutdown|blockade|riot|unrest|curfew|agitation)\w*/i,
  transport_disruption: /\b(cancel|delay|diverted|grounded|suspend|disrupt|outage|stranded|runway|airport closed|train|derail|ferry)\w*/i,
  safety_or_health: /\b(advisory|warning|alert|outbreak|virus|dengue|covid|crime|attack|accident|crash|terror|conflict|war|ban)\w*/i,
};

// Aircraft "strike" incidents are not labour strikes: classify them as transport/safety.
const AIRCRAFT_STRIKE = /\b(tail|bird|lightning|runway)\s+strike/i;

function categorise(title) {
  const aircraft = AIRCRAFT_STRIKE.test(title);
  const text = aircraft ? title.replace(AIRCRAFT_STRIKE, "") : title;
  const tags = Object.entries(CATEGORIES)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k);
  if (aircraft) tags.push("transport_disruption");
  return [...new Set(tags)];
}

async function checkTravelDisruptions(args) {
  const days = clampDays(args.days, 7);
  const subject = args.subject;
  const keywords =
    "(delay OR cancelled OR strike OR protest OR flood OR cyclone OR closure OR advisory OR curfew OR outbreak OR disruption)";
  const articles = await fetchNews({ query: `"${subject}" ${keywords}`, days, region: args.region });

  // Keep only articles that actually mention the subject in the headline and match a risk category.
  const needle = String(subject).toLowerCase().split(/\s+/)[0];
  const flagged = articles
    .map((a) => ({ ...a, risk_types: categorise(a.title) }))
    .filter((a) => a.risk_types.length && a.title.toLowerCase().includes(needle));

  const counts = {};
  for (const a of flagged) for (const t of a.risk_types) counts[t] = (counts[t] || 0) + 1;

  const limit = Math.min(Math.max(args.limit || 8, 1), 20);
  return {
    subject,
    window_days: days,
    risk_signal: flagged.length === 0 ? "none_found" : flagged.length >= 5 ? "high" : "some",
    risk_counts: counts,
    articles: flagged.slice(0, limit),
    note: "risk_signal reflects how many recent headlines mention disruption for this subject, matched by keyword. 'none_found' means no matching headlines in the window, not a guarantee that travel is safe. Political rallies and protests are included, so check whether a protest actually affects travel. Verify with the airline or official sources before acting.",
  };
}

const region = {
  type: "string",
  description: "2-letter country code for the Google News edition, default 'in' (India)",
};

const TOOLS = [
  {
    name: "search_travel_news",
    description:
      "Search recent Google News headlines for a travel topic, destination, airline or event (e.g. 'Goa tourism', 'IndiGo', 'Manali landslide'). Returns newest-first articles from the last N days with source, date and link.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic, place, airline or event to search for" },
        days: { type: "integer", description: "How many past days to include (1-30, default 7)" },
        limit: { type: "integer", description: "Max articles (1-30, default 10)" },
        region,
      },
      required: ["query"],
    },
    handler: searchTravelNews,
  },
  {
    name: "check_travel_disruptions",
    description:
      "Check whether recent news reports disruption for a destination, airline or airport: weather, strikes/protests, flight/transport disruption, safety or health alerts. Returns a risk signal (none_found / some / high), counts by risk type and the matching headlines. Use before confirming a trip or to flag a risky travel leg.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Destination, airline or airport, e.g. 'Goa', 'IndiGo', 'Mumbai airport'" },
        days: { type: "integer", description: "How many past days to scan (1-30, default 7)" },
        limit: { type: "integer", description: "Max headlines (1-20, default 8)" },
        region,
      },
      required: ["subject"],
    },
    handler: checkTravelDisruptions,
  },
];

module.exports = { SERVER_INFO, TOOLS };
