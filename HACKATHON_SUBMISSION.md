# Chikitsa Hackathon Submission

## Inspiration

Healthcare planning often starts with a simple question: where are facilities missing? But for a government administrator, that question is not enough. A district with few visible facilities can mean two very different things: a real medical desert, or a data gap where facility records are incomplete, stale, or unreliable.

Chikitsa was inspired by that investment problem. Public health teams have limited budget. They need to know where to build, where to upgrade services, where to improve access, and where to verify the data before committing money.

In India, national and state programmes set the policy and funding frame, but district-level planning and accountability are where evidence becomes operational. Chikitsa helps a national or state planner scan districts, find standout possible medical deserts, and decide what government action is defensible.

The same pattern resonates outside India. A governor like Kathy Hochul should be able to understand why local leaders, including mayors like Zohran Mamdani, are asking for health funding: what does the local evidence show, what is missing, and what action should government investigate first?

## What it does

Chikitsa is a public-health planning app for finding likely real medical deserts across India.

A government administrator can:

- Open an India-wide district map
- Focus on a state
- Inspect raw facility pins over district boundaries
- Filter by ownership, facility type, and service evidence
- Turn on the Real deserts layer to see apparent shortage
- Select a standout district
- Use the district copilot agent to dig into the records
- Save confirmed evidence and the reviewed district state

The key output is not a generic score. It is an explainable action class:

- **Build:** high need, high scarcity, and enough Evidence Confidence to act
- **Verify:** apparent shortage, but facility evidence is too weak for immediate investment
- **Upgrade:** facilities exist, but services do not match local need
- **Improve access:** facilities exist, but geography or access remains weak
- **Investigate:** mixed signal that needs administrative review

Chikitsa helps planners turn many district reviews into a more defensible resource-allocation queue.

## How we built it

We built Chikitsa as a planner-facing geospatial analytics app on Databricks.

The app combines:

- NFHS-5 district health indicators from 2019-2021
- Discovered marketplace facility records
- Facility coordinates and district boundaries
- PIN and geography quality signals
- Cleaned website and service-category evidence
- Rule-based planning action classes
- A district copilot agent for evidence review

The landing experience is one smooth India map. District boundaries stay visible, facility GPS pins render on top, and planners can filter pins by ownership, facility type, or service evidence. The Real deserts toggle recolors districts by apparent shortage using district need and coordinate-based facility scarcity.

When a district is selected, the side panel becomes a decision audit. It shows the apparent shortage score, evidence-adjusted priority, coordinate facility count, evidence discount, ownership context, service evidence, NFHS population attributes, and the recommended action class.

The district copilot is a plain Python ReAct-style agent. The server retrieves deterministic Lakebase evidence first, then the agent can inspect that evidence, attempt public web context, and return a compact planning answer. The UI shows the agent trace so planners can see whether it checked Lakebase evidence, used web context, or prepared the final answer.

If the team agrees with a finding, they can save confirmed evidence. That writes an append-only Lakebase row with the answer, confidence delta, source context, planner notes, and chat history. It does not overwrite raw data; it creates an audit trail.

## Challenges we ran into

The biggest challenge was avoiding false certainty.

Marketplace facility counts are discovered records, not a complete provider inventory. A low facility count might mean real shortage, but it might also mean weak source coverage. NFHS-5 reflects 2019-2021 conditions, so it is useful district context but not current ground truth.

Another challenge was making the map honest. A choropleth can make a district look conclusively underserved even when the underlying facility data is thin. We designed the UI to show both the district signal and the raw facility pins, so planners can see the evidence behind the score.

The copilot also needed constraints. It should not invent policy or clinical guidance. It should explain retrieved evidence, uncertainty, caveats, and next verification steps.

Finally, public web search is harder than it looks. Generic web results are noisy, and official hospital sources should be ranked above directories or social pages. That shaped our future roadmap: better source tools and human-approved data repair.

## Accomplishments that we're proud of

We are proud that Chikitsa focuses on real government decisions instead of just another dashboard.

The app does not simply rank districts by shortage. It asks whether the shortage signal is reliable enough to act on. That distinction changes the answer:

- A district with high need and reliable evidence may be a Build candidate.
- A district with high need but weak facility evidence becomes Verify.
- A district with facilities but poor service match may become Upgrade.
- A district with facilities but poor geography may become Improve access.

We are also proud of the district workflow. A planner can start at India, focus on a state, inspect facility and service evidence, select a district, ask the copilot to investigate, and save confirmed evidence. That turns a map into an operational planning process.

## What we learned

We learned that public-health planning tools need to communicate evidence quality as clearly as they communicate need.

A low facility count is not always an instruction to build. Sometimes it is an instruction to verify. Making that distinction changes the workflow from "rank and act" to "rank, explain, verify, and choose the right next action."

We also learned that a useful copilot for government planning should be evidence-grounded and auditable. The valuable answer is not a long recommendation. It is a short explanation of action, evidence, caveat, and next step, with a trace showing how the agent reached it.

## What's next for Chikitsa

Next, we want to make the agent more useful and reduce manual verification over time.

The future state includes:

- Better public-source search for official hospital registries, facility websites, and government listings
- Source ranking so official government and hospital sources beat generic web directories
- More precise facility-to-district assignment using GPS point-in-polygon joins
- Stronger service availability extraction from official websites and facility pages
- Agent-suggested fixes for missing websites, missing services, suspicious coordinates, and ownership mismatches
- Human-in-the-loop approval before backend data changes are written
- Automatic refresh so confirmed fixes make the frontend evidence cleaner and more defensible

The long-term goal is a planning system where the agent helps fill data gaps, proposes backend corrections, and keeps the district evidence clean enough for governments to allocate resources with more confidence.

