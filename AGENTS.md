# Agent Instructions

## Product Direction

Chikitsa is a Bihar-first public-health planning app for government health planners.
It helps separate real healthcare deserts from possible data deserts so planners can
choose the right next action before committing budget.

The core thesis is: a district with few visible facilities might be underserved, or
the data might be incomplete. The app should make that uncertainty explicit.

## Language To Use

Use **Evidence Confidence** or **facility-record reliability** for data-quality
scores. Do not claim the app measures public trust in hospitals or doctors.

Use **healthcare desert** for likely real shortages and **data desert** for places
where the shortage signal may be caused by weak facility evidence.

The app is planner-facing. It is not a citizen-facing facility finder and it does
not provide clinical advice.

## App Flow

Keep the demo focused:

- Brief: Bihar decision brief and action shortlist
- Map: first-pass India healthcare desert signal from available district scores
- Evidence: ranking logic and score explanation
- Actions: follow-up queue for government investigation
- Copilot: evidence-grounded explanation of the selected action

The Bihar MVP should stay centered on Purnia, Katihar, Saharsa, Kishanganj, and
Jehanabad when examples are needed.

## Core Scores

Healthcare Desert Score measures apparent shortage using district health need and
facility scarcity.

Evidence Confidence measures whether the shortage signal is reliable. Use only
available evidence signals unless richer FDR lineage fields are added:

- facility record completeness
- valid PIN format
- unambiguous PIN-to-district mapping
- plausible coordinates
- plausible capacity
- NFHS caution estimates and suppressed values

Do not mix public/private ownership into Evidence Confidence. Treat ownership as
context.

## Action Classes

Action classes must be rule-based and explainable:

- **Build:** high need, high scarcity, high evidence confidence
- **Verify:** high need or scarcity, low evidence confidence
- **Upgrade:** facilities exist, but need remains high
- **Improve access:** facilities exist, but geography or access remains weak
- **Investigate:** mixed signal or governance/economic context needs review

The copilot should explain the retrieved evidence and rule result. It should not
invent policy beyond the action class and verification steps.

## Data And Claims

Label NFHS-5 as 2019-2021 data. Do not imply it is current.

Treat marketplace facility counts as discovered records, not a complete provider
inventory.

For reliable facility-to-district assignment, prefer facility latitude and
longitude with district or state boundary polygons from geoBoundaries or DataMeet
India Maps, using point-in-polygon joins. Use PIN-to-district lookup only as a
fallback or first-pass proxy, and always flag ambiguous PIN mappings. Do not rely
on string-matching district names as the primary join method.

Frame GDP, roads, urban/rural, expenditure, and constituency data as context or
correlation. Do not claim political causation or rank political parties.

When uncertain, prefer language like "apparent shortage", "possible data gap",
"evidence suggests", and "requires verification".
