const SERPAPI_URL = "https://serpapi.com/search.json";
const SERVER_INFO = { name: "tripadvisor-place-mcp", version: "1.0.0" };
// The India domain returns prices and price levels in INR.
const DOMAIN = "www.tripadvisor.in";

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

async function searchRaw(query, category) {
  const params = { engine: "tripadvisor", q: query };
  if (CATEGORY[category]) params.ssrc = CATEGORY[category];
  try {
    const data = await serp(params);
    return data.places || [];
  } catch (e) {
    if (/hasn't returned any results/i.test(e.message)) return [];
    throw e;
  }
}

function mapPlace(p) {
  return {
    place_id: p.place_id,
    name: p.title,
    type: p.place_type, // ATTRACTION / ACCOMMODATION / EATERY
    rating: p.rating ?? null,
    review_count: p.reviews ?? null,
    location: p.location,
    description: p.description ? p.description.replace(/\s+/g, " ").slice(0, 220) : undefined,
    top_review_theme: p.highlighted_review?.text,
    link: p.link,
  };
}

function checkCategory(c) {
  if (c !== undefined && !(c in CATEGORY)) throw new Error(`category must be one of: ${Object.keys(CATEGORY).join(", ")}`);
}

async function searchPlaces(args) {
  checkCategory(args.category);
  const places = (await searchRaw(args.query, args.category || "all")).map(mapPlace);
  const limit = Math.min(Math.max(args.limit || 10, 1), 30);
  return { query: args.query, category: args.category || "all", places: places.slice(0, limit), total_found: places.length };
}

async function findTopRated(args) {
  checkCategory(args.category);
  const minRating = args.min_rating ?? 4;
  const minReviews = args.min_reviews ?? 100;
  const all = (await searchRaw(args.query, args.category || "attractions")).map(mapPlace);
  const kept = all
    // Bookable tours (ATTRACTION_PRODUCT) crowd out real places unless asked for.
    .filter((p) => args.include_tours || p.type !== "ATTRACTION_PRODUCT")
    .filter((p) => (p.rating ?? 0) >= minRating && (p.review_count ?? 0) >= minReviews)
    .sort((a, b) => b.rating - a.rating || b.review_count - a.review_count);
  const limit = Math.min(Math.max(args.limit || 10, 1), 30);
  return {
    query: args.query,
    category: args.category || "attractions",
    filters: { min_rating: minRating, min_reviews: minReviews },
    places: kept.slice(0, limit),
    matched: kept.length,
    searched: all.length,
    note: "Sorted by rating, then review count. The review-count floor avoids places rated highly by only a handful of people.",
  };
}

const top = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : undefined);
const clean = (s, n = 300) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : s);

const nearbyList = (arr) =>
  top(arr, 5)?.map((x) => ({
    name: x.name,
    place_id: x.place_id,
    rating: x.rating,
    reviews: x.reviews,
    distance: x.distance,
    info: x.additional_info,
  }));

function mapReviews(list, n) {
  return top(list, n)?.map((r) => ({
    title: clean(r.title, 120),
    text: clean(r.snippet),
    rating: r.rating,
    date: r.date,
    trip_type: r.trip_type,
  }));
}

function mapDetails(r) {
  const base = { type: r.type, name: r.name, ranking: r.ranking };

  if (r.type === "hotel") {
    const offers = (r.prices?.offers || [])
      .filter((o) => typeof o.extracted_price === "number")
      .sort((a, b) => a.extracted_price - b.extracted_price);
    return {
      ...base,
      rating: r.rating,
      review_count: r.reviews,
      stars: r.hotel_stars,
      award: r.award ? `${r.award.type} ${r.award.year}` : null,
      address: r.address,
      gps_coordinates: r.gps_coordinates,
      walk_score: r.walk_score,
      price_range_per_night_inr: r.price_range,
      prices: r.prices
        ? {
            check_in: r.prices.check_in,
            check_out: r.prices.check_out,
            guests: r.prices.guests,
            cheapest_offers: offers.slice(0, 3).map((o) => ({
              provider: o.provider,
              price_inr: o.extracted_price,
              rooms_remaining: o.rooms_remaining >= 0 ? o.rooms_remaining : null,
            })),
            note: "Tripadvisor chooses these dates itself; use the hotel search server for specific dates.",
          }
        : undefined,
      subratings: r.subratings,
      review_distribution: r.review_distribution,
      reviews_summary: clean(r.reviews_summary, 600),
      review_highlights: top(r.reviews_highlights, 5)?.map((h) => ({
        category: h.category,
        value: h.value,
        summary: clean(h.summary, 250),
      })),
      style: top(r.hotel_style, 3)?.map((s) => s.tag),
      amenities: top(r.amenities, 15)?.map((a) => a.name),
      room_types: top(r.room_types, 6)?.map((a) => a.name),
      nearby_airports: top(r.nearby?.airports, 3)?.map((a) => ({
        name: a.name,
        distance_km: Math.round(a.distance * 10) / 10,
      })),
      recent_reviews: mapReviews(r.reviews_list, 3),
    };
  }

  if (r.type === "restaurant") {
    return {
      ...base,
      price_level: r.price_level,
      categories: top(r.categories, 6)?.map((c) => c.name),
      cuisines: r.cuisines,
      diets: r.diets,
      meal_types: r.meal_types,
      dining_options: top(r.dining_options, 8),
      address: r.address,
      phone: r.phone,
      website: r.website,
      open_now: r.operation_hours?.currently_open,
      hours: r.operation_hours?.hours,
      description: clean(r.description, 500),
      nearby_restaurants: nearbyList(r.nearby?.restaurants),
      nearby_attractions: nearbyList(r.nearby?.attractions),
    };
  }

  // attraction (and fallback for unknown types)
  const experiences = (r.attraction_listings || []).flatMap((g) => g.list || []);
  return {
    ...base,
    rating: r.rating,
    review_count: r.reviews,
    key_details: r.key_details,
    reviews_summary: clean(r.reviews_summary, 600),
    top_reviews: mapReviews(r.review_snippets, 3),
    recent_reviews: mapReviews(r.reviews_list, 3),
    bookable_experiences: top(experiences, 5)?.map((e) => ({
      name: e.name,
      place_id: e.place_id,
      rating: e.rating,
      reviews: e.reviews,
      type: e.type,
      duration: e.duration,
      price: e.price,
      free_cancellation: e.free_cancellation,
      link: e.link,
    })),
    nearby_restaurants: nearbyList(r.nearby?.restaurants),
    nearby_attractions: nearbyList(r.nearby?.attractions),
    nearby_hotels: nearbyList(r.nearby?.hotels),
  };
}

async function getPlaceDetails(args) {
  let placeId = args.place_id;
  let resolvedFrom = null;
  if (!placeId) {
    if (!args.query) throw new Error("Provide place_id or query");
    checkCategory(args.category);
    const first = (await searchRaw(args.query, args.category || "all"))[0];
    if (!first) throw new Error(`No Tripadvisor place found for "${args.query}"`);
    placeId = first.place_id;
    resolvedFrom = first.title;
  }
  const data = await serp({ engine: "tripadvisor_place", place_id: String(placeId) });
  if (!data.place_result) throw new Error("Tripadvisor returned no details for this place_id");
  return { place_id: String(placeId), resolved_from_query: resolvedFrom, ...mapDetails(data.place_result) };
}

const categoryProp = (def) => ({
  type: "string",
  enum: Object.keys(CATEGORY),
  description: `all, attractions, restaurants or hotels (default ${def})`,
});

const TOOLS = [
  {
    name: "search_places",
    description:
      "Search Tripadvisor for attractions, restaurants and hotels by name or destination (e.g. 'Baga Beach Goa', 'beaches in Goa', 'Goa'). Returns place_id, type, rating, review count and location. Use the place_id with get_place_details.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Place name or destination to search for" },
        category: categoryProp("all"),
        limit: { type: "integer", description: "Max places (1-30, default 10)" },
      },
      required: ["query"],
    },
    handler: searchPlaces,
  },
  {
    name: "find_top_rated_places",
    description:
      "Find the best-reviewed places in a destination: searches Tripadvisor, keeps places at or above a rating and review-count floor, and ranks by rating then popularity. Good for 'best things to do / places to stay / eat in X'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Destination or theme, e.g. 'Goa', 'beaches in Goa', 'forts in Rajasthan'" },
        category: categoryProp("attractions"),
        min_rating: { type: "number", description: "Minimum rating out of 5 (default 4)" },
        min_reviews: { type: "integer", description: "Minimum number of reviews (default 100)" },
        include_tours: { type: "boolean", description: "Also include bookable tours and experiences (excluded by default)" },
        limit: { type: "integer", description: "Max places (1-30, default 10)" },
      },
      required: ["query"],
    },
    handler: findTopRated,
  },
  {
    name: "get_place_details",
    description:
      "Get full Tripadvisor details for one place. Hotels: rating, ranking, award, stars, amenities, price offers (INR), review summary and sub-ratings. Restaurants: cuisines, price level, hours, contact, nearby. Attractions: rating, top reviews, bookable tours with prices, nearby places. Provide place_id (from search_places) or a query.",
    inputSchema: {
      type: "object",
      properties: {
        place_id: { type: "string", description: "Tripadvisor place_id from search_places" },
        query: { type: "string", description: "Place name to look up when no place_id is given (uses the top search match)" },
        category: categoryProp("all"),
      },
    },
    handler: getPlaceDetails,
  },
];

module.exports = { SERVER_INFO, TOOLS };
