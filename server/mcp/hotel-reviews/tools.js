const SERPAPI_URL = "https://serpapi.com/search.json";
const SERVER_INFO = { name: "hotel-reviews-mcp", version: "1.0.0" };

async function serp(params) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");
  const res = await fetch(`${SERPAPI_URL}?${new URLSearchParams({ api_key: key, hl: "en", ...params })}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  return data;
}

const ymd = (d) => d.toISOString().slice(0, 10);

// Accept either a property_token or a hotel name/destination, and return a token.
async function resolveHotel(args) {
  if (args.property_token) return { property_token: args.property_token, name: null };
  if (!args.hotel_query) throw new Error("Provide property_token or hotel_query");
  const now = Date.now();
  const data = await serp({
    engine: "google_hotels",
    q: args.hotel_query,
    check_in_date: ymd(new Date(now + 14 * 86400000)),
    check_out_date: ymd(new Date(now + 15 * 86400000)),
    currency: "INR",
    gl: "in",
  });
  // A specific hotel name returns that property directly; a broad query returns a list.
  if (data.property_token) return { property_token: data.property_token, name: data.name };
  const first = (data.properties || []).find((p) => p.property_token);
  if (!first) throw new Error(`No hotel found for "${args.hotel_query}"`);
  return { property_token: first.property_token, name: first.name };
}

function mapReview(r) {
  return {
    reviewer: r.user?.name,
    rating: r.rating,
    date: r.date,
    source: r.source,
    text: r.snippet,
    subratings: r.subratings,
    traveller_type_tags: r.hotel_highlights,
    photo_count: (r.images || []).length,
    owner_response: r.response?.snippet || null,
  };
}

const SORT = { most_helpful: 1, most_recent: 2, highest_rated: 3, lowest_rated: 4 };

async function getHotelReviews(args) {
  const hotel = await resolveHotel(args);
  const sortName = SORT[args.sort_by] ? args.sort_by : "most_helpful";
  const params = {
    engine: "google_hotels_reviews",
    property_token: hotel.property_token,
    sort_by: String(SORT[sortName]),
  };
  if (args.next_page_token) params.next_page_token = args.next_page_token;
  const data = await serp(params);

  const limit = Math.min(Math.max(args.limit || 10, 1), 20);
  const reviews = (data.reviews || []).slice(0, limit).map(mapReview);
  return {
    hotel: { name: hotel.name, property_token: hotel.property_token },
    sorted_by: sortName,
    reviews,
    returned: reviews.length,
    next_page_token: data.serpapi_pagination?.next_page_token || null,
  };
}

async function getReviewHighlights(args) {
  const hotel = await resolveHotel(args);
  const base = { engine: "google_hotels_reviews", property_token: hotel.property_token };
  const [top, worst, recent] = await Promise.all([
    serp({ ...base, sort_by: String(SORT.highest_rated) }),
    serp({ ...base, sort_by: String(SORT.lowest_rated) }),
    serp({ ...base, sort_by: String(SORT.most_recent) }),
  ]);
  const n = Math.min(Math.max(args.per_group || 3, 1), 6);
  const pick = (d) => (d.reviews || []).slice(0, n).map(mapReview);

  const sample = [...(top.reviews || []), ...(worst.reviews || []), ...(recent.reviews || [])];
  const recentRatings = (recent.reviews || []).map((r) => r.rating).filter((x) => typeof x === "number");
  const tags = {};
  for (const r of sample) for (const t of r.hotel_highlights || []) tags[t] = (tags[t] || 0) + 1;

  return {
    hotel: { name: hotel.name, property_token: hotel.property_token },
    recent_average_rating: recentRatings.length
      ? Math.round((recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length) * 10) / 10
      : null,
    recent_reviews_counted: recentRatings.length,
    best_reviews: pick(top),
    worst_reviews: pick(worst),
    most_recent_reviews: pick(recent),
    common_traveller_tags: tags,
    note: "recent_average_rating is computed from the most recent reviews only, not the hotel's overall score. Use best vs worst reviews to find strengths and recurring complaints.",
  };
}

const hotelIdProps = {
  property_token: {
    type: "string",
    description: "Google hotel property_token (from the hotel search server). Preferred when you have it.",
  },
  hotel_query: {
    type: "string",
    description: "Hotel name plus city, e.g. 'Radisson Blu Resort Goa Cavelossim Beach'. Used when no property_token is given.",
  },
};

const TOOLS = [
  {
    name: "get_hotel_reviews",
    description:
      "Get guest reviews for one hotel: rating, date, text, sub-ratings (rooms/service/location) and traveller tags. Sort by most helpful, most recent, highest rated or lowest rated. Provide property_token or hotel_query.",
    inputSchema: {
      type: "object",
      properties: {
        ...hotelIdProps,
        sort_by: {
          type: "string",
          enum: Object.keys(SORT),
          description: "most_helpful (default), most_recent, highest_rated, lowest_rated",
        },
        limit: { type: "integer", description: "Max reviews to return (1-20, default 10)" },
        next_page_token: { type: "string", description: "Token from a previous call to get the next page" },
      },
    },
    handler: getHotelReviews,
  },
  {
    name: "get_hotel_review_highlights",
    description:
      "Quick verdict material for one hotel: the best reviews, the worst reviews and the most recent reviews side by side, plus the recent average rating and common traveller tags. Use to judge whether a hotel is worth booking and what guests complain about. Provide property_token or hotel_query.",
    inputSchema: {
      type: "object",
      properties: {
        ...hotelIdProps,
        per_group: { type: "integer", description: "Reviews per group (1-6, default 3)" },
      },
    },
    handler: getReviewHighlights,
  },
];

module.exports = { SERVER_INFO, TOOLS };
