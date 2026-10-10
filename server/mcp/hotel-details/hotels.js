const SERPAPI_URL = "https://serpapi.com/search.json";

function mapProperty(p) {
  return {
    name: p.name,
    type: p.type,
    hotel_class: p.hotel_class,
    overall_rating: p.overall_rating,
    reviews: p.reviews,
    location_rating: p.location_rating,
    price_per_night: p.rate_per_night?.extracted_lowest ?? null,
    price_per_night_before_taxes: p.rate_per_night?.extracted_before_taxes_fees ?? null,
    total_price: p.total_rate?.extracted_lowest ?? null,
    total_price_before_taxes: p.total_rate?.extracted_before_taxes_fees ?? null,
    deal: p.deal || null,
    deal_description: p.deal_description || null,
    check_in_time: p.check_in_time,
    check_out_time: p.check_out_time,
    amenities: (p.amenities || []).slice(0, 12),
    nearby_places: (p.nearby_places || []).slice(0, 3).map((n) => ({
      name: n.name,
      transportations: n.transportations,
    })),
    gps_coordinates: p.gps_coordinates,
    link: p.link,
    property_token: p.property_token,
  };
}

async function searchHotels(args) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");

  const params = new URLSearchParams({
    engine: "google_hotels",
    api_key: key,
    q: args.query,
    check_in_date: args.check_in_date,
    check_out_date: args.check_out_date,
    currency: "INR", // always INR
    gl: "in",
    hl: "en",
    adults: String(args.adults || 2),
    sort_by: String(args.sort_by || 3), // 3 = lowest price
  });
  if (args.children) params.set("children", String(args.children));
  if (args.min_price) params.set("min_price", String(args.min_price));
  if (args.max_price) params.set("max_price", String(args.max_price));
  if (args.rating) params.set("rating", String(args.rating));
  if (args.hotel_class) params.set("hotel_class", String(args.hotel_class));
  if (args.free_cancellation) params.set("free_cancellation", "true");

  const res = await fetch(`${SERPAPI_URL}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  }

  const all = (data.properties || []).map(mapProperty);
  const priced = all
    .filter((h) => typeof h.price_per_night === "number")
    .sort((a, b) => a.price_per_night - b.price_per_night);
  const deals = all.filter((h) => h.deal);

  const limit = Math.min(Math.max(args.limit || 5, 1), 20);
  const list = args.only_deals ? deals : all;
  return {
    search: {
      query: args.query,
      check_in_date: args.check_in_date,
      check_out_date: args.check_out_date,
      adults: Number(params.get("adults")),
      currency: "INR",
    },
    cheapest: priced[0] || null,
    hotels: list.slice(0, limit),
    total_found: all.length,
    deals_found: deals.length,
    google_hotels_url: data.search_metadata?.google_hotels_url || null,
  };
}

module.exports = { searchHotels };
