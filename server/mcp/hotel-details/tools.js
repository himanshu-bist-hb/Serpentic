const { searchHotels } = require("./hotels");

const SERVER_INFO = { name: "hotel-details-mcp", version: "1.0.0" };

const props = {
  query: {
    type: "string",
    description: "Where to stay, e.g. 'hotels in Goa' or 'Candolim Goa' or a hotel name",
  },
  check_in_date: { type: "string", description: "Check-in date, YYYY-MM-DD" },
  check_out_date: { type: "string", description: "Check-out date, YYYY-MM-DD" },
  adults: { type: "integer", description: "Number of adults, default 2" },
  children: { type: "integer", description: "Number of children, default 0" },
  min_price: { type: "integer", description: "Minimum price per night (INR)" },
  max_price: { type: "integer", description: "Maximum price per night (INR)" },
  rating: {
    type: "integer",
    description: "Minimum guest rating: 7 = 3.5+, 8 = 4.0+, 9 = 4.5+",
  },
  hotel_class: {
    type: "string",
    description: "Star class, comma-separated, e.g. '3,4' for 3 and 4 star",
  },
  free_cancellation: { type: "boolean", description: "Only hotels with free cancellation" },
  limit: { type: "integer", description: "Max hotels to return (1-20, default 5)" },
};

const required = ["query", "check_in_date", "check_out_date"];

const TOOLS = [
  {
    name: "find_hotel_deals",
    description:
      "Find hotels with deals and the lowest prices for a destination and dates. Prices are in INR. Returns only hotels that Google flags as a deal (with discount text) and, separately, the cheapest hotel overall.",
    inputSchema: { type: "object", properties: props, required },
    handler: (a) => searchHotels({ ...a, sort_by: 3, only_deals: true }),
  },
  {
    name: "search_hotels",
    description:
      "Search hotels for a destination and dates with price per night, total price, rating, class, amenities and nearby places (prices in INR). Use find_hotel_deals when the goal is discounted or cheapest stays.",
    inputSchema: {
      type: "object",
      properties: {
        ...props,
        sort_by: {
          type: "integer",
          description: "3 = Lowest price (default), 8 = Highest rating, 13 = Most reviewed",
        },
      },
      required,
    },
    handler: (a) => searchHotels(a),
  },
];

function validate(args) {
  const missing = required.filter((k) => !args[k]);
  if (missing.length) return `Missing required argument(s): ${missing.join(", ")}`;
  for (const k of ["check_in_date", "check_out_date"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args[k])) return `${k} must be YYYY-MM-DD`;
  }
  if (args.check_out_date <= args.check_in_date) return "check_out_date must be after check_in_date";
  return null;
}

// Validate inputs inside each handler (the shared core only checks required fields).
for (const t of TOOLS) {
  const run = t.handler;
  t.handler = (a) => {
    const problem = ((a, t) => validate(a, t))(a, t);
    if (problem) throw new Error(problem);
    return run(a);
  };
}

module.exports = { SERVER_INFO, TOOLS };
