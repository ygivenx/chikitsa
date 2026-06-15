# Chikitsa Hackathon Plan

## Problem

Public health investment can be misallocated when planners treat data gaps as
facility gaps.

Indian health planners often have to decide where to build, upgrade, or verify
facilities using registries that are incomplete and inconsistent. When a district
shows few facilities, the planner cannot immediately tell whether the district
has few facilities or whether the available data only records few facilities.

Chikitsa helps answer the question that comes before funding decisions: where can
we trust the evidence enough to act?

## Product Thesis

Chikitsa is an evidence-aware prioritization system for government health
planners. It separates likely healthcare deserts from possible data deserts and
turns that distinction into explainable government actions.

The app is planner-facing. It is not a citizen-facing facility finder and it does
not provide clinical advice.

## Data Sources

The current MVP uses:

- FDR healthcare facility records
- India Post PIN Code Directory
- NFHS-5 district health indicators
- Optional government context such as GDP, roads, urban or rural classification,
  and administrative responsibility

NFHS-5 is 2019-2021 data. Facility records are discovered records, not a complete
provider inventory.

For reliable location assignment, facility latitude and longitude should be
joined to district or state boundary polygons from geoBoundaries or DataMeet
India Maps using point-in-polygon logic. PIN-to-district lookup is acceptable as
a first-pass proxy or fallback, but ambiguous PIN mappings must be flagged.
String-matching district names is not reliable enough to be the primary join
method.

## Core Scores

**Healthcare Desert Score** measures apparent shortage.

Inputs include district health need and facility scarcity. Health need can use
NFHS indicators such as child anaemia, child underweight, low ANC coverage, and
low health insurance coverage. Facility scarcity should use discovered facility
records and access proxies where available.

**Evidence Confidence** measures whether the shortage signal is reliable.

Inputs should be limited to available evidence signals:

- Facility record completeness
- Valid PIN format
- Unambiguous PIN-to-district mapping
- Plausible coordinates
- Plausible capacity
- NFHS caution estimates and suppressed values

Do not call this measured public trust. It is a data-confidence score for
planners.

## Action Classification

The main output is a rule-based district action class:

- **Build:** high need, high scarcity, high evidence confidence
- **Verify:** high need or scarcity, low evidence confidence
- **Upgrade:** facilities exist, but need remains high
- **Improve access:** facilities exist, but geography or access remains weak
- **Investigate:** mixed signal or governance and economic context needs review

## Hackathon MVP

Use Bihar as the focused demonstration because the current evidence already
highlights Purnia, Katihar, Saharsa, Kishanganj, and Jehanabad.

The demo flow:

1. Open with the simple India healthcare desert map from available data.
2. Zoom the story into the Bihar decision brief.
3. Show the district action shortlist.
4. Explain how need, scarcity, and evidence confidence affect ranking.
5. Select a district and explain why its action class was assigned.
6. Add government context only as supporting correlation or responsibility.
7. Ask the copilot: "What intervention should the government investigate first?"
8. Return evidence, uncertainty, and next verification steps.

## Copilot Role

The copilot should explain deterministic evidence retrieved by the app. It should
not generate unsupported policy, execute arbitrary SQL, or provide clinical
advice.

The best copilot question is: "Why did this district receive this action class?"

## Reliability Requirements

To make the system defensible:

- Keep district joins canonical and avoid raw PIN fanout
- Use point-in-polygon joins for reliable facility geography when coordinates and
  boundary polygons are available
- Treat suppressed NFHS values as missing, not zero
- Downweight or flag caution estimates
- Show missing-data warnings alongside scores
- Keep action rules transparent and auditable
- Validate top districts with spot checks before demo

## What We Do Not Claim

- We do not measure public trust in health facilities
- We do not claim facility records are a complete provider inventory
- We do not provide medical advice
- We do not prove political causation
- We do not treat inferred geography as exact unless verified

## Differentiator

Chikitsa is not another health dashboard. Existing maps answer where health need
is high. Chikitsa asks whether the evidence is reliable enough to build, verify,
upgrade, improve access, or investigate.
