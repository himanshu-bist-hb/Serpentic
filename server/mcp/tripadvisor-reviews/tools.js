const SERPAPI_URL = "https://serpapi.com/search.json";
const SERVER_INFO = { name: "tripadvisor-reviews-mcp", version: "1.0.0" };
const DOMAIN = "www.tripadvisor.in";

// Built on SerpApi's tripadvisor_place engine: its dedicated tripadvisor_reviews engine
// returned "no reviews" for every place and parameter combination we tried.

async function serp(params) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");
  const res = await fetch(
    `${SERPAPI_URL}?${new URLSearchParams({ api_key: key, tripadvisor_domain: DOMAIN, ...params })}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  return data;
}

const CATEGORY = { all: undefined, attractions: "A", restaurants: "r", hotels: "h" };

async function resolvePlace(args) {
  if (args.place_id) return { place_id: String(args.place_id), name: null };
  if (!args.query) throw new Error("Provide place_id or query");
  if (args.category !== undefined && !(args.category in CATEGORY))
    throw new Error(`category must be one of: ${Object.keys(CATEGORY).join(", ")}`);
  const params = { engine: "tripadvisor", q: args.query };
  if (CATEGORY[args.category]) params.ssrc = CATEGORY[args.category];
  let places = [];
  try {
    places = (await serp(params)).places || [];
  } catch (e) {
    if (!/hasn't returned any results/i.test(e.message)) throw e;
  }
  if (!places[0]) throw new Error(`No Tripadvisor place found for "${args.query}"`);
  return { place_id: String(places[0].place_id), name: places[0].title };
}

async function loadPlace(args) {
  const place = await resolvePlace(args);
  const data = await serp({ engine: "tripadvisor_place", place_id: place.place_id });
  const r = data.place_result;
  if (!r) throw new Error("Tripadvisor returned no details for this place_id");
  return { place, r };
}

const clean = (s, n = 500) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : s);

function mapReview(x) {
  return {
    title: clean(x.title, 140),
    text: clean(x.snippet),
    rating: x.rating,
    date: x.date,
    trip_date: x.trip_date,
    trip_type: x.trip_type, // FRIENDS / COUPLES / FAMILY / SOLO / BUSINESS
    reviewer_hometown: x.author?.hometown,
    link: x.link && x.link.length < 250 ? x.link : undefined,
  };
}

// Merge every review list Tripadvisor returns for the place and de-duplicate.
function collectReviews(r) {
  const seen = new Set();
  const out = [];
  for (const key of ["reviews_highlighted", "reviews_list", "review_snippets"]) {
    for (const x of r[key] || []) {
      const id = clean(x.snippet, 80) || x.title;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(mapReview(x));
    }
  }
  return out;
}

const ratedAvg = (list) => {
  const v = list.map((x) => x.rating).filter((n) => typeof n === "number");
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

function coverage(r, count) {
  if (r.type === "restaurant")
    return "Tripadvisor returns no review text for restaurants through this API. Use get_place_details on the places server for cuisines, price level and hours.";
  if (r.type === "hotel")
    return `Tripadvisor returned ${count} recent reviews for this hotel (not the full set). Use get_review_summary for the rating distribution and theme-level feedback across all reviews.`;
  return `Tripadvisor returned ${count} reviews for this place (a sample, not the full set).`;
}

async function getPlaceReviews(args) {
  const { place, r } = await loadPlace(args);
  let reviews = collectReviews(r);
  const sampleSize = reviews.length;

  if (args.min_rating) reviews = reviews.filter((x) => (x.rating ?? 0) >= args.min_rating);
  if (args.max_rating) reviews = reviews.filter((x) => (x.rating ?? 6) <= args.max_rating);
  if (args.trip_type) {
    const t = String(args.trip_type).toUpperCase();
    reviews = reviews.filter((x) => (x.trip_type || "").toUpperCase() === t);
  }
  reviews.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const limit = Math.min(Math.max(args.limit || 10, 1), 30);
  return {
    place: { place_id: place.place_id, name: r.name || place.name, type: r.type },
    overall_rating: r.rating ?? null,
    total_review_count: r.reviews ?? null,
    reviews: reviews.slice(0, limit),
    matched: reviews.length,
    sample_size: sampleSize,
    note: coverage(r, sampleSize),
  };
}

async function getReviewSummary(args) {
  const { place, r } = await loadPlace(args);
  const reviews = collectReviews(r);
  const head = { place_id: place.place_id, name: r.name || place.name, type: r.type };

  if (r.type === "hotel") {
    const dist = r.review_distribution || [];
    const total = dist.reduce((a, d) => a + (d.count || 0), 0);
    const pct = (names) =>
      total ? Math.round((dist.filter((d) => names.includes(d.rating)).reduce((a, d) => a + d.count, 0) / total) * 100) : null;
    return {
      ...head,
      overall_rating: r.rating,
      total_review_count: r.reviews,
      ranking: r.ranking,
      percent_positive: pct(["Excellent", "Good"]),
      percent_negative: pct(["Poor", "Terrible"]),
      review_distribution: dist,
      summary: clean(r.reviews_summary, 900),
      subratings: r.subratings,
      themes: (r.reviews_highlights || []).map((h) => ({
        category: h.category,
        verdict: h.value,
        summary: clean(h.summary, 300),
        guest_quotes: (h.reviews_quotes || []).slice(0, 2).map((q) => clean(q, 200)),
      })),
      recent_reviews: reviews.slice(0, 3),
      note: "Distribution and themes cover all reviews; recent_reviews is a small recent sample.",
    };
  }

  if (r.type === "restaurant") {
    return { ...head, available: false, note: coverage(r, 0) };
  }

  // Attraction: no distribution is returned, so describe the sample and surface both sides.
  const byRating = [...reviews].filter((x) => typeof x.rating === "number");
  const best = byRating.filter((x) => x.rating >= 4).slice(0, 3);
  const worst = byRating.filter((x) => x.rating <= 2).slice(0, 3);
  const tripTypes = {};
  for (const x of reviews) if (x.trip_type) tripTypes[x.trip_type] = (tripTypes[x.trip_type] || 0) + 1;
  return {
    ...head,
    overall_rating: r.rating,
    total_review_count: r.reviews,
    ranking: r.ranking,
    sample_size: reviews.length,
    sample_average_rating: ratedAvg(reviews),
    sample_rating_counts: byRating.reduce((a, x) => ((a[x.rating] = (a[x.rating] || 0) + 1), a), {}),
    visitor_types_in_sample: tripTypes,
    praise_examples: best,
    complaint_examples: worst,
    note: "Tripadvisor gives no rating distribution for attractions, so these figures describe the returned sample only. Read complaint_examples for recurring problems such as scams or crowding.",
  };
}

const idProps = {
  place_id: { type: "string", description: "Tripadvisor place_id (from the places server's search_places)" },
  query: { type: "string", description: "Place name to look up when no place_id is given (uses the top search match)" },
  category: {
    type: "string",
    enum: Object.keys(CATEGORY),
    description: "Narrow the name lookup: all, attractions, restaurants or hotels",
  },
};

const TOOLS = [
  {
    name: "get_place_reviews",
    description:
      "Get Tripadvisor guest reviews for a hotel or attraction (text, rating, date, trip type, reviewer hometown), newest first. Filter by rating range or trip type (FAMILY, COUPLES, FRIENDS, SOLO, BUSINESS). Returns a sample of recent reviews, not the full set. Provide place_id or query. Restaurants return no review text.",
    inputSchema: {
      type: "object",
      properties: {
        ...idProps,
        min_rating: { type: "integer", description: "Only reviews with at least this many stars (1-5)" },
        max_rating: { type: "integer", description: "Only reviews with at most this many stars (1-5), e.g. 2 for complaints" },
        trip_type: { type: "string", description: "FAMILY, COUPLES, FRIENDS, SOLO or BUSINESS" },
        limit: { type: "integer", description: "Max reviews (1-30, default 10)" },
      },
    },
    handler: getPlaceReviews,
  },
  {
    name: "get_review_summary",
    description:
      "Verdict material for one place. Hotels: rating distribution, % positive and negative across all reviews, an overall summary, sub-ratings (location, rooms, service...) and theme-by-theme feedback with guest quotes. Attractions: sample rating mix plus praise and complaint examples. Provide place_id or query.",
    inputSchema: { type: "object", properties: idProps },
    handler: getReviewSummary,
  },
];

module.exports = { SERVER_INFO, TOOLS };
