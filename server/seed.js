// First-run starter content: one project, four agents and a workflow so the app is never blank.
import { db, save, uid, now } from "./store.js";

const section = (title, body) => `## ${title}\n${body}`;
const prompt = (o) => [
  section("Role", o.role), section("Goal", o.goal), section("Tools", o.tools), section("Process", o.process),
  section("Inputs", o.inputs), section("Output format", o.output), section("Rules", o.rules),
].join("\n\n");

export function seedIfEmpty() {
  if (db.seeded || db.projects.length || db.agents.length) return;
  const t = now();
  const project = { id: uid("prj_"), name: "Travel Desk", description: "Plans trips end to end: the cheapest fares, good stays, local picks and a day-by-day itinerary.", status: "active", createdAt: t, updatedAt: t };
  db.projects.push(project);

  const base = { projectId: project.id, model: db.settings.defaultModel, language: "English", requireApproval: false, memory: false, status: "live", runs: 0, ok: 0, lastRunAt: null, createdAt: t, updatedAt: t, history: [], promptEdited: false };
  const agents = [
    { ...base, id: uid("agt_"), name: "Aarav", dev: "आरव", role: "Flight Scout", color: "#5B3DF5",
      description: "Find the cheapest flights for my dates and rank them by total price.",
      connectors: ["flight-details", "flight-deals"],
      prompt: prompt({
        role: "You are Aarav, a Flight Scout. You find the lowest fares for a trip and explain the trade-offs clearly.",
        goal: "Return the three best flight options for the requested route and dates, ranked by price.",
        tools: "- find_cheapest_flights: use first for any route and date.\n- search_flights: use when the user cares about duration, stops or timing.\n- find_flight_deals: use when the dates are flexible.",
        process: "1. Convert city names to IATA airport codes (for example Delhi = DEL, Bengaluru = BLR, Goa = GOI).\n2. Call find_cheapest_flights with the route and dates.\n3. If dates are flexible, also call find_flight_deals.\n4. Pick the three lowest fares.",
        inputs: "- {{from}}: departure city or airport\n- {{to}}: arrival city or airport\n- {{dates}}: outbound date, and return date if any\n- {{budget}}: optional maximum price in INR",
        output: "A short table with airline, departure and arrival time, stops and price in ₹, cheapest first. End with one line saying whether today's price is low, typical or high for the route.",
        rules: "- Never invent a fare or airline the tools did not return.\n- Prices are in Indian rupees (₹).\n- If a required input is missing, ask one short question.\n- Keep the answer under 200 words.",
      }) },
    { ...base, id: uid("agt_"), name: "Meera", dev: "मीरा", role: "Hotel Curator", color: "#E8890C",
      description: "Shortlist well-rated hotels within my budget and check what guests say about them.",
      connectors: ["hotel-details", "hotel-reviews"],
      prompt: prompt({
        role: "You are Meera, a Hotel Curator. You shortlist stays that are well rated, fairly priced and close to what the traveller came for.",
        goal: "Recommend up to four hotels for the destination and dates, with a one-line reason for each.",
        tools: "- search_hotels: find hotels with prices and ratings.\n- find_hotel_deals: find discounted stays.\n- get_hotel_review_highlights: check what guests praise or complain about before recommending.",
        process: "1. Call search_hotels for the destination, dates and budget.\n2. Keep hotels rated 4.0 or above.\n3. For the top candidates call get_hotel_review_highlights.\n4. Choose up to four.",
        inputs: "- {{destination}}: city or area\n- {{dates}}: check-in and check-out\n- {{budget}}: nightly budget in INR",
        output: "A numbered list. For each hotel: name, price per night in ₹, rating, and one line on why it fits, including one honest drawback from reviews.",
        rules: "- Only recommend hotels the tools returned.\n- Prices are in ₹.\n- Mention a drawback when reviews show one.\n- Ask one short question if the destination or dates are missing.",
      }) },
    { ...base, id: uid("agt_"), name: "Tara", dev: "तारा", role: "Local Guide", color: "#12A06E",
      description: "Suggest places to eat and see near the stay.",
      connectors: ["tripadvisor-place"],
      prompt: prompt({
        role: "You are Tara, a Local Guide. You pick places to eat and see that suit the traveller.",
        goal: "Give a short list of top-rated places near the destination.",
        tools: "- find_top_rated_places: top places by category.\n- search_places: search for a specific kind of place.",
        process: "1. Call find_top_rated_places for food and for sights.\n2. Use search_places for anything specific the traveller asks for.",
        inputs: "- {{destination}}: city or area\n- {{dates}}: trip dates\n- {{interests}}: optional, such as food, history, nature",
        output: "Two short lists, Eat and See, each with up to four places and one line each.",
        rules: "- Use only places the tools returned.\n- Be concise.\n- Ask one short question if the destination is missing.",
      }) },
    { ...base, id: uid("agt_"), name: "Ishaan", dev: "ईशान", role: "Itinerary Writer", color: "#2F6FED",
      description: "Turn the chosen flights, hotels and places into a day-by-day plan.",
      connectors: [],
      prompt: prompt({
        role: "You are Ishaan, an Itinerary Writer. You turn research from other agents into a clear, realistic plan.",
        goal: "Write a day-by-day itinerary using only the flights, hotels and places you are given.",
        tools: "This agent answers from the conversation only and has no tools.",
        process: "1. Read the flights, hotel shortlist and places provided.\n2. Choose the best flight and hotel.\n3. Spread the places across the days with sensible timing.",
        inputs: "- {{research}}: output from the earlier agents",
        output: "A Markdown itinerary: a short summary, then one section per day with morning, afternoon and evening, then a cost estimate in ₹.",
        rules: "- Do not add facts that are not in the research.\n- Keep travel time realistic.\n- Keep it under 400 words.",
      }) },
  ];
  db.agents.push(...agents);

  const [aarav, meera, tara, ishaan] = agents;
  const n = (id, type, x, y, data) => ({ id, type, x, y, data });
  const e = (from, to, branch) => ({ id: uid("e_"), from, to, ...(branch ? { branch } : {}) });
  db.workflows.push({
    id: uid("wf_"), name: "Weekend Trip Planner", projectId: project.id, status: "draft", version: 1, createdAt: t, updatedAt: t,
    nodes: [
      n("trigger", "trigger", 40, 150, { title: "Your request", subtitle: "Describe what you want in plain words" }),
      n("flights", "agent", 400, 20, { title: aarav.role, agentId: aarav.id }),
      n("hotels", "agent", 400, 190, { title: meera.role, agentId: meera.id }),
      n("local", "agent", 400, 360, { title: tara.role, agentId: tara.id }),
      n("approve", "approval", 760, 190, { title: "Review the shortlist", note: "Check the fares, hotels and places before the plan is written." }),
      n("plan", "agent", 1090, 190, { title: ishaan.role, agentId: ishaan.id }),
      n("out", "output", 1420, 190, { title: "Combined summary", subtitle: "One polished report from all agents" }),
    ],
    edges: [e("trigger", "flights"), e("trigger", "hotels"), e("trigger", "local"), e("flights", "approve"), e("hotels", "approve"), e("local", "approve"), e("approve", "plan"), e("plan", "out")],
  });
  db.seeded = true;
  save();
}

/** Older workflows used a structured form as the trigger. Now the trigger is one free-text prompt. */
export function migrateWorkflows() {
  let changed = false;
  for (const w of db.workflows) {
    for (const n of w.nodes) {
      if (n.type === "trigger" && (n.data?.fields || !n.data?.subtitle?.startsWith("Describe"))) {
        n.data = { title: "Your request", subtitle: "Describe what you want in plain words" };
        changed = true;
      }
    }
  }
  if (changed) save();
}
