const { exploreDestinations } = require("./explore");

const SERVER_INFO = { name: "travel-explore-mcp", version: "1.0.0" };

const props = {
  departure_id: {
    type: "string",
    description: "Home airport IATA code (e.g. DEL, BOM, BLR)",
  },
  outbound_date: {
    type: "string",
    description: "Departure date YYYY-MM-DD. Omit (and use month/travel_duration) for flexible dates.",
  },
  return_date: {
    type: "string",
    description: "Return date YYYY-MM-DD. With outbound_date only, a one-way search is made.",
  },
  month: {
    type: "integer",
    description: "Flexible mode only (no outbound_date): month number 1-12 to travel in",
  },
  travel_duration: {
    type: "integer",
    description: "Flexible mode only: 1 = weekend, 2 = one week, 3 = two weeks",
  },
  adults: { type: "integer", description: "Number of adults, default 1" },
  max_price: { type: "integer", description: "Max flight price per traveller (INR)" },
  stops: {
    type: "integer",
    description: "0 = any, 1 = nonstop only, 2 = 1 stop or fewer, 3 = 2 stops or fewer",
  },
  travel_class: {
    type: "integer",
    description: "1 = Economy (default), 2 = Premium economy, 3 = Business, 4 = First",
  },
  domestic_only: { type: "boolean", description: "Only destinations within India" },
  international_only: { type: "boolean", description: "Only destinations outside India" },
  country: { type: "string", description: "Only destinations in this country, e.g. 'Thailand'" },
  limit: { type: "integer", description: "Max destinations to return (1-30, default 10)" },
};

const required = ["departure_id"];

const TOOLS = [
  {
    name: "explore_destinations",
    description:
      "Discover where to travel from a home airport for given dates: returns destinations with flight price, hotel price per night, flight duration, stops and airline (all INR). Use exact dates, or flexible month/travel_duration. Optionally filter by budget, nonstop/stops, domestic/international or country.",
    inputSchema: {
      type: "object",
      properties: {
        ...props,
        sort_by: {
          type: "string",
          enum: ["flight_price", "total_cost", "duration"],
          description: "flight_price (default), total_cost (flight + hotel for the stay), or duration (shortest flight)",
        },
      },
      required,
    },
    handler: (a) => exploreDestinations(a),
  },
  {
    name: "find_best_value_destinations",
    description:
      "Find the best-value places to travel for given dates: same as explore_destinations but ranked by estimated total trip cost (round-trip flight + hotel for all nights), cheapest first. Needs outbound_date and return_date.",
    inputSchema: { type: "object", properties: props, required: [...required, "outbound_date", "return_date"] },
    handler: (a) => exploreDestinations({ ...a, sort_by: "total_cost" }),
  },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(args, tool) {
  const need = tool.inputSchema.required;
  const missing = need.filter((k) => !args[k]);
  if (missing.length) return `Missing required argument(s): ${missing.join(", ")}`;
  for (const k of ["outbound_date", "return_date"]) {
    if (args[k] && !DATE.test(args[k])) return `${k} must be YYYY-MM-DD`;
  }
  if (args.return_date && !args.outbound_date) return "return_date needs outbound_date";
  if (args.outbound_date && args.return_date && args.return_date <= args.outbound_date)
    return "return_date must be after outbound_date";
  if (args.month && (args.month < 1 || args.month > 12)) return "month must be 1-12";
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
