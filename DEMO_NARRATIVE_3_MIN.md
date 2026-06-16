# Chikitsa 3-Minute Demo Narrative

## Core Story

Chikitsa helps government health planners find likely real medical deserts before committing public money.

The framing should be: national and state administrators set priorities and budgets, but the practical planning question becomes district-level: which districts need build, verify, upgrade, access improvement, or deeper investigation?

Chikitsa is not a patient facility finder. It is a planner-facing decision system that helps a government team move from an India-wide signal to a reviewed district decision.

## Demo Goal

Show a government administrator using Chikitsa to:

- Open India-wide district evidence
- Focus on a state
- Compare possible medical deserts across facility ownership, service availability, and Evidence Confidence
- Pick a standout district
- Use the district copilot agent to dig into the real records
- Save a confirmed district state
- Build a better resource-allocation queue across all reviewed districts

## Policy Framing

Use this carefully:

"In India, national and state programmes set the funding and policy frame, but a lot of health planning becomes operational at the district level. Chikitsa is built for that handoff: a state or national administrator can scan districts, identify where the evidence suggests a real medical desert, and decide what government action should happen next."

Avoid saying "all policy is created at the district level." That is too strong. Say "district-level planning and accountability" instead.

## Presenter Setup

- Open `/`.
- Start in national view.
- Keep **Real deserts** off for the first moment so the audience sees the full district map and facility pins.
- Turn **Real deserts** on when introducing the apparent medical desert signal.
- Use pin filters to show ownership and services.
- Choose one standout district. Churu is a strong example if Rajasthan is visible: the database shows high need, only one discovered private clinic, no public facility record, and no classified service evidence.
- Click the district, open the district audit panel, and ask the copilot a direct verification question.
- Use **Confirm latest evidence** to save the reviewed district state if the response is useful.

## Script

### 0:00-0:25 - The Government Investment Problem

"Imagine I am a government health administrator. I have limited money, and I need to decide where to invest: build, upgrade services, improve access, or verify the data first."

"A district with few visible facilities can mean two things: a real medical desert, or a data gap. Chikitsa is built to separate those before public money moves."

### 0:25-0:55 - Start With India, Then Focus On A State

Action: show the landing India map with all district boundaries visible.

"I start nationally. Every district is visible because district-level planning is where the evidence becomes actionable. I can zoom into the state I am responsible for, or compare states from a national view."

Action: zoom or click into a state.

"Now I inspect the raw facility pins. I can filter by ownership, facility type, and service evidence, so I can see whether a district has public facilities, private facilities, hospitals, clinics, or specific service mentions."

### 0:55-1:25 - Turn On Real Medical Desert Signal

Action: turn on **Real deserts**.

"Now I turn on Real deserts. This colors districts by apparent medical desert signal: district need plus coordinate-based facility scarcity."

Action: use filters.

"This is not yet a build recommendation. If a district looks underserved but the records are only private clinics, or service evidence is thin, it may still be a real shortage, but the first action should be verification."

### 1:25-1:55 - Pick A Standout District

Action: click a standout district, for example Churu if using Rajasthan.

"I select a standout district. Churu is a good example: the current database shows one discovered facility record, a private physiotherapy clinic in Ratangarh. There are no discovered public facility records and no classified service categories."

"At the same time, NFHS-5 shows district health burden: high child anaemia and low four-ANC coverage. So Churu looks like a possible medical desert, but because facility evidence is thin, the action is not 'build tomorrow.' It is 'verify first.'"

### 1:55-2:25 - Use The Copilot Agent To Dig Deeper

Action: use the district chatbot.

"Now I ask the district copilot: what should government verify first?"

"The server retrieves deterministic Lakebase evidence first: district scores, NFHS attributes, facility records, service summaries, and public facility details when present. Then the agent reasons over that evidence and returns action, evidence, caveat, and next step."

Action: show trace if available.

"The trace matters. I can see whether the agent checked Lakebase evidence, attempted web context, and prepared the final answer."

### 2:25-2:45 - Save The Reviewed District State

Action: use **Confirm latest evidence**.

"If the planning team agrees, we save the confirmed evidence. That writes an append-only record with the answer, confidence delta, source context, planner notes, and chat history."

"It does not overwrite raw data. It creates an audit trail from evidence to district action."

### 2:45-3:00 - Allocate Resources Across Reviewed Districts

"After the team repeats this district by district, government is no longer working from a flat ranking. It has a reviewed queue: Build here, Verify there, Upgrade services elsewhere, Improve access where geography is the barrier."

"For an American audience, the analogy is simple: a governor like Kathy Hochul should be able to see why city leaders, including mayors like Zohran Mamdani, are asking for funding. The question becomes: what does the local evidence show, what is missing, and what action is defensible?"

## Future State

"Today, the copilot helps planners review evidence and save confirmed findings. The future state is a stronger agent with better tools."

- Better public-source search for official hospital registries, facility websites, and government listings
- Source ranking so official government and hospital sources beat generic web directories
- Agent-suggested data fixes for missing websites, missing services, suspicious coordinates, and ownership mismatches
- Human-in-the-loop approval before backend data changes are written
- Automatic refresh so once a data gap is fixed, the frontend shows cleaner evidence without manual UI work

The long-term direction is less manual verification over time. The agent should help fill data gaps, propose backend corrections, and keep the frontend evidence clean and defensible.

## Backup Short Version

"Chikitsa helps government planners find real medical deserts, not just districts with weak data. I start from an India-wide district map, focus on my state, inspect facility pins and service evidence, then turn on the Real deserts layer. When I select a standout district, the audit panel shows whether the shortage signal is strong enough to act on or whether the first action should be verification. The copilot digs into the district evidence, shows its tool trace, and returns a compact planning recommendation. If the team agrees, we save a confirmed district state. After reviewing all districts, the government has a defensible allocation queue: build here, verify there, upgrade services elsewhere, and improve access where geography is the barrier."

## Language Guardrails

- Say **medical desert** or **healthcare desert** only after explaining the evidence.
- Say **possible medical desert** before verification.
- Say **Evidence Confidence** or **facility-record reliability**, not public trust.
- Say **planning priority**, not clinical risk.
- Say NFHS-5 is **2019-2021 data**.
- Say marketplace facilities are **discovered records**, not a complete inventory.
- Say **requires verification** when the evidence is weak.
- Do not claim political causation.
- Do not say the app decides policy automatically.
