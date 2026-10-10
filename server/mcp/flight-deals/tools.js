const SERPAPI_URL = "https://serpapi.com/search.json";
const SERVER_INFO = { name: "flight-deals-mcp", version: "1.0.0" };

function nightsBetween(a, b) {
  if (!a || !b) return null;
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n > 0 ? n : null;
}

function mapDeal(d) {
  const price = typeof d.price === "number" ? d.price : null;
  const avg = typeof d.average_price === "number" ? d.average_price : null;
  return {
    destination: d.name,
    country: d.country,
    from_airport: d.departure_airport_code,
    to_airport: d.arrival_airport_code,
    price,
    usual_price: avg,
    savings: price !== null && avg !== null ? avg - price : null,
    discount_percentage: d.discount_percentage ?? null,
    outbound_date: d.outbound_date,
    return_date: d.return_date,
    nights: nightsBetween(d.outbound_date, d.return_date),
    flight_duration_min: d.flight_duration,
    stops: d.stops,
    airline: d.airline,
    description: d.description,
    highlights: d.highlights,
    google_flights_link: d.flight_link,
  };
}

const SORTERS = {
  discount: (a, b) => (b.discount_percentage ?? -1) - (a.discount_percentage ?? -1),
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  savings: (a, b) => (b.savings ?? -1) - (a.savings ?? -1),
};

async function findFlightDeals(args) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");

  const params = new URLSearchParams({
    engine: "google_flights_deals",
    api_key: key,
    departure_id: String(args.departure_id).toUpperCase(),
    currency: "INR", // always INR
    gl: "in",
    hl: "en",
  });
  if (args.max_price) params.set("max_price", String(args.max_price));

  const res = await fetch(`${SERPAPI_URL}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  }

  let list = (data.deals || []).map(mapDeal);
  // Google ignores several filters server-side, so apply them here.
  if (args.min_discount) list = list.filter((d) => (d.discount_percentage ?? 0) >= args.min_discount);
  if (args.max_price) list = list.filter((d) => d.price !== null && d.price <= args.max_price);
  if (args.nonstop_only) list = list.filter((d) => d.stops === 0);
  if (args.domestic_only) list = list.filter((d) => d.country === "India");
  if (args.international_only) list = list.filter((d) => d.country !== "India");
  if (args.country) {
    const c = String(args.country).toLowerCase();
    list = list.filter((d) => (d.country || "").toLowerCase() === c);
  }
  if (args.depart_after) list = list.filter((d) => d.outbound_date >= args.depart_after);
  if (args.depart_before) list = list.filter((d) => d.outbound_date <= args.depart_before);

  const sortKey = SORTERS[args.sort_by] ? args.sort_by : "discount";
  list.sort(SORTERS[sortKey]);

  const limit = Math.min(Math.max(args.limit || 10, 1), 30);
  return {
    search: {
      from: params.get("departure_id"),
      currency: "INR",
      sorted_by: sortKey,
    },
    departure: data.departure_informations
      ? { airport: data.departure_informations.airport_name, city: data.departure_informations.city }
      : null,
    note: "Round-trip prices per traveller in INR. usual_price is Google's typical fare for the same route; discount_percentage compares against it.",
    deals: list.slice(0, limit),
    total_found: list.length,
    google_flights_deals_url: data.search_metadata?.google_flights_deals_url || null,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const TOOLS = [
  {
    name: "find_flight_deals",
    description:
      "Find currently discounted round-trip flights from a home airport. Returns destinations where the fare is well below Google's usual price, with price, usual price, discount %, travel dates, stops and airline (INR). Best for 'where is a cheap flight right now' and for flexible travellers. Dates are set by Google's deal, not chosen by the caller.",
    inputSchema: {
      type: "object",
      properties: {
        departure_id: { type: "string", description: "Home airport IATA code, e.g. DEL, BOM, BLR" },
        max_price: { type: "integer", description: "Max round-trip price per traveller (INR)" },
        min_discount: { type: "integer", description: "Minimum discount %, e.g. 30" },
        nonstop_only: { type: "boolean", description: "Only nonstop deals" },
        domestic_only: { type: "boolean", description: "Only destinations within India" },
        international_only: { type: "boolean", description: "Only destinations outside India" },
        country: { type: "string", description: "Only this destination country, e.g. 'Thailand'" },
        depart_after: { type: "string", description: "Only deals departing on/after this date, YYYY-MM-DD" },
        depart_before: { type: "string", description: "Only deals departing on/before this date, YYYY-MM-DD" },
        sort_by: {
          type: "string",
          enum: ["discount", "price", "savings"],
          description: "discount (default, biggest % off), price (cheapest), savings (biggest INR saved)",
        },
        limit: { type: "integer", description: "Max deals to return (1-30, default 10)" },
      },
      required: ["departure_id"],
    },
    handler: (a) => {
      for (const k of ["depart_after", "depart_before"]) {
        if (a[k] && !DATE.test(a[k])) throw new Error(`${k} must be YYYY-MM-DD`);
      }
      return findFlightDeals(a);
    },
  },
];

module.exports = { SERVER_INFO, TOOLS, findFlightDeals };
