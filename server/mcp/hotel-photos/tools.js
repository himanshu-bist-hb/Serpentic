const SERPAPI_URL = "https://serpapi.com/search.json";
const SERVER_INFO = { name: "hotel-photos-mcp", version: "1.0.0" };

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

function mapPhoto(p) {
  return {
    photo_url: p.photo_url,
    thumbnail_url: p.thumbnail_url,
    width: p.width,
    height: p.height,
    source: p.source, // Owner Submitted / Visitor Submitted
    posted_on: p.posted_on,
  };
}

async function getHotelPhotos(args) {
  const hotel = await resolveHotel(args);
  const data = await serp({ engine: "google_hotels_photos", property_token: hotel.property_token });

  const perCategory = Math.min(Math.max(args.photos_per_category || 4, 1), 20);
  let sections = data.sections || [];
  if (args.category) {
    const c = String(args.category).toLowerCase();
    sections = sections.filter((s) => (s.title || "").toLowerCase().includes(c));
    if (!sections.length) {
      const have = (data.sections || []).map((s) => s.title).join(", ");
      throw new Error(`No photo category matching "${args.category}". Available: ${have}`);
    }
  }
  const prefer = args.owner_photos_only ? "Owner Submitted" : null;

  const categories = sections.map((s) => {
    let photos = s.photos || [];
    if (prefer) photos = photos.filter((p) => p.source === prefer);
    return {
      category: s.title,
      total_photos_available: s.total,
      photos_checked: (s.photos || []).length,
      photos: photos.slice(0, perCategory).map(mapPhoto),
    };
  });

  return {
    hotel: { name: hotel.name, property_token: hotel.property_token },
    categories,
    note: "photo_url is the full-size image; thumbnail_url is a small preview. Only the first page of each category (photos_checked) is searched, so an empty owner_photos_only result means none among those, not that the hotel has none.",
  };
}

const TOOLS = [
  {
    name: "get_hotel_photos",
    description:
      "Get photos of one hotel grouped by category (At a glance, Bedroom, Bathroom, Exterior, Interior, Amenities, Food & Drink) with full-size and thumbnail URLs and whether the owner or a visitor posted them. Provide property_token or hotel_query. Optionally limit to one category.",
    inputSchema: {
      type: "object",
      properties: {
        property_token: {
          type: "string",
          description: "Google hotel property_token (from the hotel search server). Preferred when you have it.",
        },
        hotel_query: {
          type: "string",
          description: "Hotel name plus city, e.g. 'Radisson Blu Resort Goa Cavelossim Beach'. Used when no property_token is given.",
        },
        category: {
          type: "string",
          description: "Only this category, e.g. 'Bedroom', 'Exterior', 'Food' (case-insensitive match)",
        },
        photos_per_category: { type: "integer", description: "Photos per category (1-20, default 4)" },
        owner_photos_only: { type: "boolean", description: "Only photos posted by the hotel owner (usually higher quality)" },
      },
    },
    handler: getHotelPhotos,
  },
];

module.exports = { SERVER_INFO, TOOLS };
