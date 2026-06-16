# Agent Instructions

## Product Direction

Chikitsa is a public-health planning app for government health planners. It helps
separate likely healthcare deserts from possible data deserts so planners can choose
the right next action before committing budget.

The core thesis is: a district with few visible facilities might be underserved, or
the data might be incomplete. The app should make that uncertainty visible, explainable,
and actionable.

The app is planner-facing. It is not a citizen-facing facility finder and it does not
provide clinical advice.

## Current Demo Direction

The landing page should be a bold, full-page India map with all districts visible and
colored from available district scores.

The strongest map pattern is a before/after comparison:

- Left: apparent healthcare desert signal
- Right: evidence-adjusted planning priority
- Hover one district and highlight it on both maps
- Show a clear movement badge: Priority increased, Priority reduced, No material change,
  or Data not available
- On district click, show a decision-audit panel explaining the score, Evidence Confidence,
  movement, action class, and caveats

State boundaries may be shown for orientation, but they must not block district hover,
click, or zoom. Districts remain the primary analytical unit.

## Language To Use

Use **Evidence Confidence** or **facility-record reliability** for data-quality scores.
Do not claim the app measures public trust in hospitals, doctors, or residents.

Use **healthcare desert** for likely real shortages and **data desert** for places where
the shortage signal may be caused by weak facility evidence.

Use **apparent shortage**, **evidence-adjusted priority**, **planning priority**, and
**requires verification** when describing uncertain outputs.

Avoid calling the score a clinical risk score. If a risk-like concept is needed, call it
**planning priority** or **apparent access risk**.

## App Flow

Keep the demo focused:

- Landing map: India-wide district map with apparent desert signal and evidence-adjusted
  planning priority
- State or district drilldown: selected district evidence, movement explanation, and
  action class
- Evidence: ranking logic, score components, and source caveats
- Actions: follow-up queue for government investigation
- Copilot: evidence-grounded explanation of the selected action

The app should not feel Bihar-only. Bihar can remain the MVP validation story and example
state when examples are needed, especially Purnia, Katihar, Saharsa, Kishanganj, and
Jehanabad, but the UI and copy should support India-wide district analysis.

## Core Scores

Healthcare Desert Score measures apparent shortage using district health need and facility
scarcity from available records.

Evidence Confidence measures whether the shortage signal is reliable enough for planning.
Use available evidence signals unless richer FDR lineage fields are added:

- facility record completeness
- valid PIN format
- unambiguous PIN-to-district mapping
- plausible coordinates
- plausible capacity
- NFHS caution estimates and suppressed values
- external verification when available

Do not mix public/private ownership into Evidence Confidence. Treat ownership as context.

Low Evidence Confidence should not simply hide or lower a district. A high shortage signal
with low Evidence Confidence should usually become a **Verify** priority because it may be a
data desert rather than a confirmed healthcare desert.

## Action Classes

Action classes must be rule-based and explainable:

- **Build:** high need, high scarcity, high Evidence Confidence
- **Verify:** high need or scarcity, low Evidence Confidence
- **Upgrade:** facilities exist, but need remains high
- **Improve access:** facilities exist, but geography or access remains weak
- **Investigate:** mixed signal or governance/economic context needs review

The copilot should explain retrieved evidence and the rule result. It should not invent
policy beyond the action class, caveats, and verification steps.

## Data And Claims

Label NFHS-5 as 2019-2021 data. Do not imply it is current.

Treat marketplace facility counts as discovered records, not a complete provider inventory.

For reliable facility-to-district assignment, prefer facility latitude and longitude with
district or state boundary polygons from geoBoundaries or DataMeet India Maps, using
point-in-polygon joins. Use PIN-to-district lookup only as a fallback or first-pass proxy,
and always flag ambiguous PIN mappings. Do not rely on string-matching district names as the
primary join method.

Frame GDP, roads, urban/rural, expenditure, and constituency data as context or correlation.
Do not claim political causation or rank political parties.

When uncertain, prefer language like "apparent shortage", "possible data gap", "evidence
suggests", and "requires verification".
