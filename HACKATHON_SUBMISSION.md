# Chikitsa

**Finding real medical deserts before public money moves.**

_A Databricks-powered public-health planning app for evidence-aware government investment._

**Live demo:** [Chikitsa Databricks App](https://chikitsa-copilot-7474650186235074.aws.databricksapps.com)

Chikitsa helps government administrators move from an India-wide map to a district-level investment decision: **Build, Verify, Upgrade, Improve access, or Investigate**.

The core idea is simple: a district with few visible healthcare facilities may be truly underserved, or the data may be incomplete. Those two cases require different government actions. **Chikitsa makes that uncertainty visible.**

## Inspiration

Healthcare planning often starts with one question:

**Where are facilities missing?**

For a government administrator, that is not enough. A district with few visible facilities can mean:

- A **real medical desert**, where people likely lack access to care
- A **data gap**, where facility records are incomplete, stale, or unreliable

If those two cases are confused, governments can misallocate scarce budget. They may build in the wrong place, miss a district that needs urgent investment, or spend months debating records that were never reliable enough to support a decision.

**Chikitsa was built for that decision point.**

In India, national and state programmes set the policy and funding frame, but district-level planning and accountability are where evidence becomes operational. Chikitsa gives national and state planners a way to scan districts, find standout possible medical deserts, and decide what action is defensible before committing resources.

The pattern is globally relevant. A governor like Kathy Hochul should be able to understand why local leaders, including mayors like Zohran Mamdani, are asking for health funding. The decision should come down to evidence: **what does the local data show, what is missing, and what should government investigate first?**

## What It Does

Chikitsa turns fragmented health facility and population evidence into an explainable government planning workflow.

A planner can:

- Open an India-wide district map
- Focus on a state
- Inspect discovered facility GPS pins over district boundaries
- Filter facilities by ownership, facility type, and service evidence
- Toggle **Real deserts** to see apparent shortage
- Select a standout district
- Ask the district copilot agent to investigate the evidence
- Save confirmed evidence and the reviewed district state

The main output is not a black-box score. It is an action class a planner can defend:

- **Build** when need is high, scarcity is high, and Evidence Confidence is strong
- **Verify** when apparent shortage is high but the facility evidence is too weak for immediate investment
- **Upgrade** when facilities exist but services do not match local need
- **Improve access** when facilities exist but geography or access remains weak
- **Investigate** when the signal is mixed or needs administrative review

This turns district review into a **resource-allocation queue** instead of a flat ranking.

## Demo Flow

1. **Start with India:** one smooth district map with facility GPS pins layered over district boundaries.
2. **Focus on a state:** zoom into a state and inspect ownership, facility types, and service evidence.
3. **Turn on Real deserts:** recolor districts by apparent medical desert signal.
4. **Select a standout district:** open a decision audit with score, evidence, services, and action class.
5. **Ask the district copilot:** use an evidence-grounded agent with a visible trace.
6. **Save confirmed evidence:** write an append-only Lakebase record with notes and chat history.
7. **Review all districts:** build a defensible queue for resource allocation.

## How We Built It

We built Chikitsa as a full-stack Databricks app with a Lakebase-backed planning workflow.

The app combines:

- **NFHS-5 district health indicators** from 2019-2021
- **Discovered marketplace facility records**
- **Facility coordinates and district boundaries**
- **PIN and geography quality signals**
- **Cleaned website and service-category evidence**
- **Rule-based planning action classes**
- **A district copilot agent for evidence review**
- **Append-only confirmed evidence write-back**

The landing map is designed to keep the evidence visible. District boundaries stay visible, facility GPS pins render on top, and the planner can filter pins by ownership, facility type, and services. The **Real deserts** toggle recolors districts by apparent shortage, while the **Confirmed** toggle highlights districts with planner-reviewed evidence.

The district copilot is intentionally constrained. The server retrieves deterministic Lakebase evidence first. The Python ReAct agent can inspect that evidence, attempt public web context, and return a short answer. The UI shows the agent trace so the user can see whether the agent checked Lakebase, searched public context, or prepared the final answer.

Confirmed findings are stored as auditable Lakebase rows. They do not overwrite raw data; they preserve the planning decision trail.

## Challenges We Ran Into

### Avoiding false certainty

The biggest challenge was making the app honest. Marketplace facility counts are discovered records, not a complete provider inventory. A low facility count may indicate a real shortage, but it may also indicate weak source coverage.

NFHS-5 is also 2019-2021 data. It is valuable district context, but it should not be presented as current ground truth.

### Designing a trustworthy map

A choropleth can make a district look conclusively underserved even when the underlying facility data is thin. We designed Chikitsa to show both:

- The district-level shortage signal
- The raw facility pins and service evidence behind that signal

That lets planners ask the right question: **is this a real medical desert, or do we need to verify the evidence first?**

### Keeping the copilot grounded

The copilot needed strict boundaries. It should not invent policy, provide clinical guidance, or generate unsupported recommendations. It should explain retrieved evidence, uncertainty, caveats, and verification steps.

### Public web evidence is noisy

Generic web results are inconsistent. Official hospital sources should outrank directories, social pages, and aggregator listings. This became one of the clearest future-state priorities: better source tools and human-approved data repair.

## Accomplishments We're Proud Of

We are proud that Chikitsa focuses on real government decisions, not just visualization.

The app does not simply rank districts by shortage. It asks whether the shortage signal is reliable enough to act on. That changes the outcome:

- High need plus reliable evidence can become **Build**
- High need plus weak facility evidence becomes **Verify**
- Facilities with poor service match become **Upgrade**
- Facilities with poor geographic access become **Improve access**

We are also proud of the district workflow:

**Map -> Filter -> Select -> Investigate -> Confirm -> Allocate**

That workflow turns a map into an operational planning process. It gives a government team an audit trail from raw evidence to action class.

## What We Learned

We learned that public-health planning tools need to communicate evidence quality as clearly as they communicate need.

A low facility count is not always an instruction to build. Sometimes it is an instruction to verify.

That distinction changes the workflow from **rank and act** to **rank, explain, verify, and choose the right next action**.

We also learned that the best planning copilot is not the one that writes the longest answer. It is the one that gives a compact, evidence-grounded explanation with a visible trace and a clear next step.

## What's Next

The next step is to make the agent stronger and reduce manual verification over time.

Future work includes:

- Better public-source search for official hospital registries, facility websites, and government listings
- Source ranking so official government and hospital sources beat generic web directories
- More precise facility-to-district assignment using GPS point-in-polygon joins
- Stronger service availability extraction from official websites and facility pages
- Agent-suggested fixes for missing websites, missing services, suspicious coordinates, and ownership mismatches
- Human-in-the-loop approval before backend data changes are written
- Automatic refresh so confirmed fixes make frontend evidence cleaner and more defensible

The long-term goal is a planning system where the agent helps fill data gaps, proposes backend corrections, and keeps district evidence clean enough for governments to allocate resources with confidence.

## Built With

- Databricks Apps
- Databricks Lakebase
- Databricks Model Serving
- React
- TypeScript
- Python
- ECharts
- NFHS-5 public health indicators
- India healthcare facility and geography datasets
