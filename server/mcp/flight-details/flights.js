const SERPAPI_URL = "https://serpapi.com/search.json";

const airport = (a) => (a ? { code: a.id, name: a.name, time: a.time } : null);

function mapLeg(l) {
  return {
    flight_number: l.flight_number,
    airline: l.airline,
    airplane: l.airplane,
    travel_class: l.travel_class,
    departs: airport(l.departure_airport),
    arrives: airport(l.arrival_airport),
    duration_min: l.duration,
    overnight: !!l.overnight,
    often_delayed: !!l.often_delayed_by_over_30_min,
    legroom: l.legroom,
    extensions: l.extensions,
  };
}

function mapFlightGroup(g) {
  const legs = g.flights || [];
  const first = legs[0] || {};
  const last = legs[legs.length - 1] || {};
  return {
    price: g.price,
    total_duration_min: g.total_duration,
    stops: Math.max(legs.length - 1, 0),
    type: g.type,
    airlines: [...new Set(legs.map((l) => l.airline).filter(Boolean))],
    departs: airport(first.departure_airport),
    arrives: airport(last.arrival_airport),
    layovers: (g.layovers || []).map((l) => ({
      airport: l.name,
      id: l.id,
      duration_min: l.duration,
      overnight: !!l.overnight,
    })),
    legs: legs.map(mapLeg),
    carbon_emissions: g.carbon_emissions,
    departure_token: g.departure_token,
    booking_token: g.booking_token,
  };
}

async function serpFlights(params) {
  const res = await fetch(`${SERPAPI_URL}?${params}`, { signal: AbortSignal.timeout(45000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  return data;
}

const groups = (data) =>
  [...(data.best_flights || []), ...(data.other_flights || [])].filter((g) => typeof g.price === "number");

// Where to actually buy the chosen itinerary, with the price each seller charges.
async function bookingOptions(base, token) {
  const p = new URLSearchParams(base);
  p.set("booking_token", token);
  const data = await serpFlights(p);
  return (data.booking_options || [])
    .map((o) => {
      const b = o.together || o;
      return { book_with: b.book_with, price: b.price, option_title: b.option_title, marketplace: b.marketplace };
    })
    .filter((o) => o.book_with)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .slice(0, 5);
}

async function searchFlights(args) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");

  const params = new URLSearchParams({
    engine: "google_flights",
    api_key: key,
    departure_id: String(args.departure_id).toUpperCase(),
    arrival_id: String(args.arrival_id).toUpperCase(),
    outbound_date: args.outbound_date,
    currency: "INR", // always INR
    hl: "en",
    adults: String(args.adults || 1),
    // 1 = round trip, 2 = one way
    type: args.return_date ? "1" : "2",
    // 2 = sort by price
    sort_by: args.sort_by ? String(args.sort_by) : "2",
  });
  if (args.return_date) params.set("return_date", args.return_date);
  if (args.max_price) params.set("max_price", String(args.max_price));
  if (args.stops !== undefined) params.set("stops", String(args.stops));
  if (args.travel_class) params.set("travel_class", String(args.travel_class));

  const data = await serpFlights(params);

  const all = groups(data).map(mapFlightGroup).sort((a, b) => a.price - b.price);

  const limit = Math.min(Math.max(args.limit || 5, 1), 20);
  const out = {
    search: {
      from: params.get("departure_id"),
      to: params.get("arrival_id"),
      outbound_date: args.outbound_date,
      return_date: args.return_date || null,
      currency: params.get("currency"),
      adults: Number(params.get("adults")),
    },
    cheapest: all[0] || null,
    cheapest_return: null,
    booking_options: [],
    flights: all.slice(0, limit),
    total_found: all.length,
    price_insights: data.price_insights
      ? {
          lowest_price: data.price_insights.lowest_price,
          price_level: data.price_insights.price_level,
          typical_price_range: data.price_insights.typical_price_range,
        }
      : null,
    google_flights_url: data.search_metadata?.google_flights_url || null,
    note: args.return_date
      ? "For round trips, 'price' is the TOTAL round-trip fare per the search (all passengers as searched). 'cheapest' is the outbound; 'cheapest_return' is the matching return flight."
      : "One-way fare.",
  };

  // Enrich only the cheapest option (2 extra API calls): return flight for round trips + where to book.
  const top = all[0];
  if (top) {
    const base = new URLSearchParams(params);
    try {
      let token = top.booking_token;
      if (args.return_date && top.departure_token) {
        const rp = new URLSearchParams(base);
        rp.set("departure_token", top.departure_token);
        const ret = groups(await serpFlights(rp)).map(mapFlightGroup).sort((a, b) => a.price - b.price)[0];
        if (ret) {
          out.cheapest_return = ret;
          token = ret.booking_token || token;
          out.cheapest.price = ret.price; // round-trip total once the return is chosen
        }
      }
      if (token) out.booking_options = await bookingOptions(base, token);
    } catch (e) {
      out.enrich_error = `Could not load return flight / booking options: ${e.message}`;
    }
  }
  for (const f of [out.cheapest, out.cheapest_return, ...out.flights]) if (f) { delete f.departure_token; delete f.booking_token; }
  return out;
}

module.exports = { searchFlights };
