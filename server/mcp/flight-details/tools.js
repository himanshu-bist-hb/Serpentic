const { searchFlights } = require("./flights");

const SERVER_INFO = { name: "flight-details-mcp", version: "1.0.0" };

const commonProps = {
  departure_id: {
    type: "string",
    description: "Departure airport IATA code (e.g. DEL) or comma-separated codes",
  },
  arrival_id: {
    type: "string",
    description: "Arrival airport IATA code (e.g. GOI) or comma-separated codes",
  },
  outbound_date: { type: "string", description: "Departure date, YYYY-MM-DD" },
  return_date: {
    type: "string",
    description: "Return date YYYY-MM-DD. Omit for a one-way search.",
  },
  adults: { type: "integer", description: "Number of adult passengers, default 1" },
  max_price: { type: "integer", description: "Only return flights at or below this price (INR)" },
  stops: {
    type: "integer",
    description: "0 = any, 1 = nonstop only, 2 = 1 stop or fewer, 3 = 2 stops or fewer",
  },
  travel_class: {
    type: "integer",
    description: "1 = Economy (default), 2 = Premium economy, 3 = Business, 4 = First",
  },
  limit: { type: "integer", description: "Max flights to return (1-20, default 5)" },
};

const required = ["departure_id", "arrival_id", "outbound_date"];

const TOOLS = [
  {
    name: "find_cheapest_flights",
    description:
      "Find the most affordable flights between two airports on a date (one-way, or round trip if return_date is given). Results are sorted by price ascending, with the cheapest highlighted and Google's price insights (is this price low/typical/high).",
    inputSchema: { type: "object", properties: commonProps, required },
    handler: (a) => searchFlights({ ...a, sort_by: 2 }),
  },
  {
    name: "search_flights",
    description:
      "Search flights with full details (airlines, stops, layovers, duration, legs). Use find_cheapest_flights when the goal is the lowest price.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProps,
        sort_by: {
          type: "integer",
          description:
            "1 = Top flights (default Google ranking), 2 = Price, 3 = Departure time, 4 = Arrival time, 5 = Duration",
        },
      },
      required,
    },
    handler: (a) => searchFlights({ ...a, sort_by: a.sort_by || 1 }),
  },
];

function validate(args) {
  const missing = required.filter((k) => !args[k]);
  if (missing.length) return `Missing required argument(s): ${missing.join(", ")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.outbound_date)) return "outbound_date must be YYYY-MM-DD";
  if (args.return_date && !/^\d{4}-\d{2}-\d{2}$/.test(args.return_date))
    return "return_date must be YYYY-MM-DD";
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

// Also expose the flight-deals tool here so one endpoint covers all flight lookups.
const deals = require("../flight-deals/tools");

module.exports = { SERVER_INFO, TOOLS: [...TOOLS, ...deals.TOOLS] };
