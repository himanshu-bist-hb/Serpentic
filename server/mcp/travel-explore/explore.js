const SERPAPI_URL = "https://serpapi.com/search.json";

function nightsBetween(a, b) {
  if (!a || !b) return null;
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n > 0 ? n : null;
}

function mapDestination(d, nights) {
  const hotel = typeof d.hotel_price === "number" ? d.hotel_price : null;
  const flight = typeof d.flight_price === "number" ? d.flight_price : null;
  const n = nights ?? nightsBetween(d.start_date, d.end_date);
  return {
    name: d.name,
    country: d.country,
    airport: d.destination_airport?.code || null,
    start_date: d.start_date,
    end_date: d.end_date,
    nights: n,
    flight_price: flight,
    hotel_price_per_night: hotel,
    // Rough trip cost: round-trip flight + hotel for every night, per traveller.
    estimated_trip_cost: flight !== null && hotel !== null && n ? flight + hotel * n : null,
    flight_duration_min: d.flight_duration,
    stops: d.number_of_stops,
    airline: d.airline,
    gps_coordinates: d.gps_coordinates,
    google_explore_link: d.link,
  };
}

const SORTERS = {
  flight_price: (a, b) => (a.flight_price ?? Infinity) - (b.flight_price ?? Infinity),
  total_cost: (a, b) => (a.estimated_trip_cost ?? Infinity) - (b.estimated_trip_cost ?? Infinity),
  duration: (a, b) => (a.flight_duration_min ?? Infinity) - (b.flight_duration_min ?? Infinity),
};

async function exploreDestinations(args) {
  const key = (globalThis.__serpKey && globalThis.__serpKey());
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");

  const params = new URLSearchParams({
    engine: "google_travel_explore",
    api_key: key,
    departure_id: String(args.departure_id).toUpperCase(),
    currency: "INR", // always INR
    gl: "in",
    hl: "en",
    adults: String(args.adults || 1),
    // 1 = round trip, 2 = one way
    type: args.outbound_date && !args.return_date ? "2" : "1",
  });
  if (args.outbound_date) params.set("outbound_date", args.outbound_date);
  if (args.return_date) params.set("return_date", args.return_date);
  // Flexible mode (no exact dates): travel_duration 1 = weekend, 2 = one week, 3 = two weeks
  if (!args.outbound_date && args.travel_duration) params.set("travel_duration", String(args.travel_duration));
  if (!args.outbound_date && args.month) params.set("month", String(args.month));
  if (args.max_price) params.set("max_price", String(args.max_price));
  if (args.stops !== undefined) params.set("stops", String(args.stops));
  if (args.travel_class) params.set("travel_class", String(args.travel_class));

  const res = await fetch(`${SERPAPI_URL}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  }

  const nights = nightsBetween(args.outbound_date, args.return_date);
  const raw = (data.destinations || []).map((d) => mapDestination(d, nights));
  // Google keeps over-budget / unavailable destinations in the list with no price: drop them.
  let list = raw.filter((d) => d.flight_price !== null);
  const unpriced_omitted = raw.length - list.length;
  // stops=1 re-prices but does not exclude connecting itineraries, so filter here.
  if (args.stops === 1) list = list.filter((d) => d.stops === 0);
  if (args.stops === 2) list = list.filter((d) => d.stops <= 1);
  if (args.stops === 3) list = list.filter((d) => d.stops <= 2);

  if (args.country) {
    const c = String(args.country).toLowerCase();
    list = list.filter((d) => (d.country || "").toLowerCase() === c);
  }
  if (args.domestic_only) list = list.filter((d) => (d.country || "") === "India");
  if (args.international_only) list = list.filter((d) => (d.country || "") !== "India");

  const sortKey = SORTERS[args.sort_by] ? args.sort_by : "flight_price";
  list.sort(SORTERS[sortKey]);

  const limit = Math.min(Math.max(args.limit || 10, 1), 30);
  return {
    search: {
      from: params.get("departure_id"),
      outbound_date: args.outbound_date || null,
      return_date: args.return_date || null,
      month: args.month || null,
      travel_duration: args.travel_duration || null,
      adults: Number(params.get("adults")),
      currency: "INR",
      sorted_by: sortKey,
    },
    note: "Prices are per traveller in INR. estimated_trip_cost = flight price + hotel price per night x nights (hotel price is Google's typical nightly rate).",
    destinations: list.slice(0, limit),
    total_found: list.length,
    unpriced_omitted,
  };
}

module.exports = { exploreDestinations };
