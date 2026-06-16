import { useEffect, useMemo, useState } from 'react';
import { Button, Skeleton, Textarea } from '@databricks/appkit-ui/react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import DOMPurify from 'dompurify';
import { ArrowLeft, Bot, Info, Send } from 'lucide-react';
import { marked } from 'marked';
import { fetchJson } from '../lib/api';
import { actionDescriptions, actionLabels } from '../lib/chikitsa-copy';
import type {
  CopilotResponse,
  DistrictContextResponse,
  DistrictEvidenceOverride,
  DistrictEvidenceOverrideSummary,
  DistrictPriority,
  StateFacility,
} from '../lib/chikitsa-types';

interface DistrictBoundaryGeoJson {
  type: 'FeatureCollection';
  features: DistrictBoundaryFeature[];
}

interface IndiaAdm1GeoJson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      shapeName?: unknown;
    };
    geometry: unknown;
  }>;
}

interface DistrictBoundaryFeature {
  type: 'Feature';
  properties: {
    districtName: string;
    districtKey: string;
    stateName: string;
    stateKey: string;
    districtUid?: string;
  };
  geometry: unknown;
}

interface LoadedDistrictMap {
  boundary: DistrictBoundaryGeoJson;
  districts: DistrictPriority[];
}

interface CoordinateAccessSummary {
  facilityCount: number;
  publicCount: number;
  privateCount: number;
  unknownCount: number;
  weightedAccessPoints: number;
  nearestFacilityDistanceKm: number | null;
}

type MapParams = {
  name: string;
  componentType?: string;
  data?: {
    facility?: StateFacility;
    pinLabel?: string;
  };
};

type LonLat = [number, number];
type PinColorMode = 'ownership' | 'facility_type' | 'service';
type DistrictChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};
type AgentTraceStep = NonNullable<CopilotResponse['trust']['agentTrace']>[number];

const defaultDistrictQuestion = (district: DistrictPriority) =>
  `For ${district.district_name}, summarize discovered hospitals, NFHS population-survey attributes, service evidence, uncertainty, and the recommended planning action.`;

const districtQuestionTemplates = [
  'What should government verify first in this district?',
  'Which hospital/service evidence is strongest and weakest?',
  'Do the discovered services match the NFHS health burden?',
] as const;

const boundaryFiles = [
  'andaman_nicobar_islands',
  'andhra_pradesh',
  'arunachal_pradesh',
  'assam',
  'bihar',
  'chandigarh',
  'chhattisgarh',
  'dadra_and_nagar_haveli_daman_and_diu',
  'goa',
  'gujarat',
  'haryana',
  'himachal_pradesh',
  'jammu_kashmir',
  'jharkhand',
  'karnataka',
  'kerala',
  'ladakh',
  'lakshadweep',
  'madhya_pradesh',
  'maharastra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'nct_of_delhi',
  'odisha',
  'puducherry',
  'punjab',
  'rajasthan',
  'sikkim',
  'tamil_nadu',
  'telangana',
  'tripura',
  'uttar_pradesh',
  'uttarakhand',
  'west_bengal',
] as const;

const mapName = 'india-districts';

const stateKeyAliases: Record<string, string> = {};

const stateNameAliases: Record<string, string> = {
  Maharastra: 'Maharashtra',
};

const pinModeLabels: Record<PinColorMode, string> = {
  ownership: 'Ownership',
  facility_type: 'Facility type',
  service: 'Services',
};

const metricDescriptions = {
  coordinateDesert:
    'Apparent shortage score from NFHS need and GPS facility scarcity after assigning pins to district polygons.',
  evidenceAdjusted:
    'Planning priority after discounting the shortage signal where source evidence is weaker.',
  coordinateFacilities: 'Discovered GPS facility records located inside the selected district boundary.',
  evidenceDiscount: 'How much Evidence Confidence reduced the apparent shortage signal.',
  publicPrivate: 'Ownership mix in discovered coordinate records. Ownership is context, not Evidence Confidence.',
  nearestKm: 'Straight-line distance from district center to nearest discovered coordinate facility.',
  facilityRecords: 'Discovered facility records for this district; not a complete provider registry.',
  cleanWebsites: 'Facility records with usable website evidence after cleaning obvious placeholders.',
  serviceBreadth: 'Average number of text-derived service categories per discovered facility record.',
} as const;

const metricDetails = {
  coordinateDesert:
    'Higher means stronger apparent shortage. Formula: NFHS health-need score multiplied by coordinate scarcity from discovered facility pins and nearest-distance penalty.',
  evidenceAdjusted:
    'The coordinate desert score after applying Evidence Confidence. Lower than Coordinate desert means the system is discounting the signal because evidence needs verification.',
  coordinateFacilities:
    'Count of discovered facility records with plausible GPS coordinates that fall inside this district polygon. This is not a complete registry.',
  evidenceDiscount:
    'Difference between Coordinate desert and Evidence-adjusted. A larger discount means the apparent shortage is more likely to need verification before action.',
} as const;

const metricCardClass = {
  coordinateDesert: 'border-rose-200 bg-rose-50 text-rose-950',
  evidenceAdjusted: 'border-sky-200 bg-sky-50 text-sky-950',
  coordinateFacilities: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  evidenceDiscount: 'border-amber-200 bg-amber-50 text-amber-950',
  public: 'border-sky-200 bg-sky-50 text-sky-950',
  private: 'border-orange-200 bg-orange-50 text-orange-950',
  nearest: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  websites: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-50',
  services: 'border-violet-300/25 bg-violet-300/10 text-violet-50',
  facilitiesDark: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-50',
  ownershipDark: 'border-orange-300/25 bg-orange-300/10 text-orange-50',
} as const;

function actionColorClass(action: keyof typeof actionLabels) {
  if (action === 'build') return 'border-rose-300 bg-rose-100 text-rose-950';
  if (action === 'verify') return 'border-amber-300 bg-amber-100 text-amber-950';
  if (action === 'upgrade') return 'border-violet-300 bg-violet-100 text-violet-950';
  if (action === 'improve_access') return 'border-sky-300 bg-sky-100 text-sky-950';
  return 'border-slate-300 bg-slate-100 text-slate-800';
}

function MetricInfo({ label, detail }: { label: string; detail: string }) {
  return (
    <span className="group relative -top-2 ml-1 inline-flex align-super">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current/30 bg-white/40 text-[10px] opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/30"
        aria-label={`${label} details`}
      >
        <Info className="h-2.5 w-2.5" />
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-normal leading-5 text-slate-700 opacity-0 shadow-xl transition-opacity group-focus-within:block group-focus-within:opacity-100 group-hover:block group-hover:opacity-100">
        <span className="block font-semibold text-slate-950">{label}</span>
        <span className="mt-1 block">{detail}</span>
      </span>
    </span>
  );
}

function MapToggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`group inline-flex min-w-[190px] items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left shadow-sm transition-all ${
        checked
          ? 'border-slate-950 bg-slate-950 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
      }`}
      onClick={onChange}
    >
      <span>
        <span className="block text-xs font-semibold">{label}</span>
        <span className={`mt-0.5 block text-[11px] ${checked ? 'text-slate-300' : 'text-slate-500'}`}>
          {description}
        </span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-emerald-300 bg-emerald-400' : 'border-slate-300 bg-slate-200'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

const pinPalette = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#4f46e5',
  '#be123c',
  '#65a30d',
  '#7c3aed',
];

function districtUid(stateKey: string, districtKey: string) {
  return `${stateKey}::${districtKey}`;
}

function canonicalStateKey(stateKey: string) {
  return stateKeyAliases[stateKey] ?? stateKey;
}

function canonicalStateName(stateName: string) {
  return stateNameAliases[stateName] ?? stateName;
}

function baseDesertScore(district: DistrictPriority) {
  return district.desert_score || district.facility_scarcity_score || 0;
}

function evidenceMultiplier(district: DistrictPriority) {
  return 0.65 + (district.evidence_trust_score / 100) * 0.35;
}

function coordinateScarcityScore(access: CoordinateAccessSummary) {
  const countScarcity = 100 - Math.min(access.weightedAccessPoints * 8, 100);
  const distancePenalty =
    access.nearestFacilityDistanceKm === null
      ? 100
      : Math.max(0, Math.min(100, ((access.nearestFacilityDistanceKm - 10) / 40) * 100));

  return Number((countScarcity * 0.75 + distancePenalty * 0.25).toFixed(1));
}

function baseDesertScoreForAccess(district: DistrictPriority, access?: CoordinateAccessSummary) {
  if (!access) return baseDesertScore(district);
  return Number(((district.health_need_score * coordinateScarcityScore(access)) / 100).toFixed(1));
}

function adjustedDesertScore(district: DistrictPriority, access?: CoordinateAccessSummary) {
  return Number((baseDesertScoreForAccess(district, access) * evidenceMultiplier(district)).toFixed(1));
}

function scoreDelta(district: DistrictPriority, access?: CoordinateAccessSummary) {
  return adjustedDesertScore(district, access) - baseDesertScoreForAccess(district, access);
}

function formatNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : 'N/A';
}

function formatPercent(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : 'N/A';
}

function serviceLabel(key: string) {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function firstServiceCategory(facility: StateFacility) {
  const categories = facility.service_categories
    ?.split(',')
    .map((category) => category.trim())
    .filter(Boolean);
  return categories?.[0] ?? 'no_service_evidence';
}

function pinGroup(facility: StateFacility, mode: PinColorMode) {
  if (mode === 'ownership') return facility.operator_type ?? 'unknown';
  if (mode === 'facility_type') return facility.facility_type ?? 'unknown_type';
  return firstServiceCategory(facility);
}

function pinColor(group: string) {
  if (group === 'public') return '#0ea5e9';
  if (group === 'private') return '#f97316';
  if (group === 'unknown') return '#64748b';

  let hash = 0;
  for (const character of group) hash = (hash * 31 + character.charCodeAt(0)) % pinPalette.length;
  return pinPalette[hash];
}

function pinLabel(group: string) {
  if (group === 'public') return 'Public';
  if (group === 'private') return 'Private';
  if (group === 'unknown') return 'Unknown';
  if (group === 'no_service_evidence') return 'No service evidence';
  if (group === 'unknown_type') return 'Unknown type';
  return serviceLabel(group);
}

function renderMarkdown(content: string) {
  const html = marked.parse(content, {
    async: false,
    breaks: false,
    gfm: true,
  });
  return DOMPurify.sanitize(html);
}

function traceToolLabel(tool?: string) {
  if (tool === 'evidence_lookup') return 'Checking Lakebase evidence';
  if (tool === 'web_search') return 'Searching public web context';
  if (tool === 'finish') return 'Preparing final answer';
  return 'Planning next step';
}

function traceToolClass(tool?: string) {
  if (tool === 'web_search') return 'border-sky-300/25 bg-sky-300/10 text-sky-100';
  if (tool === 'evidence_lookup') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100';
  if (tool === 'finish') return 'border-violet-300/25 bg-violet-300/10 text-violet-100';
  return 'border-white/10 bg-white/[0.06] text-slate-200';
}

function addMapFeatureUids(boundary: DistrictBoundaryGeoJson, stateBoundary: IndiaAdm1GeoJson): DistrictBoundaryGeoJson {
  const districtFeatures = boundary.features.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      stateName: canonicalStateName(feature.properties.stateName),
      stateKey: canonicalStateKey(feature.properties.stateKey),
      districtUid: districtUid(canonicalStateKey(feature.properties.stateKey), feature.properties.districtKey),
    },
  }));
  const stateOutlineFeatures: DistrictBoundaryFeature[] = stateBoundary.features.map((feature, index) => {
    const rawShapeName = feature.properties.shapeName;
    const shapeName = typeof rawShapeName === 'string' ? rawShapeName : `State ${index + 1}`;

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        districtName: shapeName,
        districtKey: `state-outline-${index}`,
        stateName: shapeName,
        stateKey: 'state-outline',
        districtUid: `state-outline::${index}`,
      },
    };
  });

  return {
    type: 'FeatureCollection',
    features: [...districtFeatures, ...stateOutlineFeatures],
  };
}

function buildDistrictLookup(districts: DistrictPriority[]) {
  const lookup = new Map<string, DistrictPriority>();

  districts.forEach((district) => {
    lookup.set(districtUid(district.state_key, district.district_key), district);
    if (district.district_geo_key) {
      lookup.set(districtUid(district.state_key, district.district_geo_key), district);
    }
  });

  return lookup;
}

function buildEvidenceSummaryLookup(rows: DistrictEvidenceOverrideSummary[]) {
  const lookup = new Map<string, DistrictEvidenceOverrideSummary>();

  rows.forEach((row) => {
    lookup.set(districtUid(row.state_key, row.district_key), {
      ...row,
      confirmed_count: Number(row.confirmed_count) || 0,
      confidence_delta_total: Number(row.confidence_delta_total) || 0,
    });
  });

  return lookup;
}

async function fetchEvidenceOverrideSummaries() {
  const rows = await fetchJson<DistrictEvidenceOverrideSummary[]>('/api/evidence-overrides/summary');
  return buildEvidenceSummaryLookup(rows);
}

function toFiniteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function walkPositions(geometry: unknown, visit: (position: LonLat) => void) {
  if (!geometry || typeof geometry !== 'object') return;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };

  function walk(value: unknown) {
    if (!Array.isArray(value)) return;
    const lon = toFiniteNumber(value[0]);
    const lat = toFiniteNumber(value[1]);
    if (lon !== null && lat !== null && value.length >= 2 && typeof value[0] !== 'object') {
      visit([lon, lat]);
      return;
    }
    value.forEach(walk);
  }

  walk(candidate.coordinates);
}

function geometryCentroid(geometry: unknown): LonLat | null {
  const positions: LonLat[] = [];
  walkPositions(geometry, (position) => positions.push(position));
  if (positions.length === 0) return null;

  const bounds = positions.reduce(
    (current, [lon, lat]) => ({
      minLon: Math.min(current.minLon, lon),
      maxLon: Math.max(current.maxLon, lon),
      minLat: Math.min(current.minLat, lat),
      maxLat: Math.max(current.maxLat, lat),
    }),
    { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
  );

  return [(bounds.minLon + bounds.maxLon) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function pointInRing(point: LonLat, ring: unknown) {
  if (!Array.isArray(ring) || ring.length < 4) return false;

  let inside = false;
  const [x, y] = point;
  const ringCoordinates = ring as unknown[];
  for (let i = 0, j = ringCoordinates.length - 1; i < ringCoordinates.length; j = i, i += 1) {
    const current = ringCoordinates[i];
    const previous = ringCoordinates[j];
    if (!Array.isArray(current) || !Array.isArray(previous)) continue;
    const xi = toFiniteNumber(current[0]);
    const yi = toFiniteNumber(current[1]);
    const xj = toFiniteNumber(previous[0]);
    const yj = toFiniteNumber(previous[1]);
    if (xi === null || yi === null || xj === null || yj === null) continue;

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygonCoordinates(point: LonLat, polygon: unknown) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  if (!pointInRing(point, polygon[0])) return false;

  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

function pointInGeometry(point: LonLat, geometry: unknown) {
  if (!geometry || typeof geometry !== 'object') return false;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type === 'Polygon') return pointInPolygonCoordinates(point, candidate.coordinates);
  if (candidate.type === 'MultiPolygon' && Array.isArray(candidate.coordinates)) {
    return candidate.coordinates.some((polygon) => pointInPolygonCoordinates(point, polygon));
  }
  return false;
}

function distanceKm(left: LonLat, right: LonLat) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(right[1] - left[1]);
  const dLon = toRadians(right[0] - left[0]);
  const lat1 = toRadians(left[1]);
  const lat2 = toRadians(right[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function emptyAccessSummary(): CoordinateAccessSummary {
  return {
    facilityCount: 0,
    publicCount: 0,
    privateCount: 0,
    unknownCount: 0,
    weightedAccessPoints: 0,
    nearestFacilityDistanceKm: null,
  };
}

function accessWeight(operatorType: StateFacility['operator_type']) {
  if (operatorType === 'public') return 1;
  if (operatorType === 'private') return 0.35;
  return 0.5;
}

function buildCoordinateAccess(features: DistrictBoundaryFeature[], facilities: StateFacility[]) {
  const accessByUid = new Map<string, CoordinateAccessSummary>();
  const centroidsByUid = new Map<string, LonLat>();
  const facilityPoints = facilities
    .map((facility) => {
      const lon = toFiniteNumber(facility.longitude);
      const lat = toFiniteNumber(facility.latitude);
      return lon === null || lat === null ? null : { facility, point: [lon, lat] as LonLat };
    })
    .filter((item): item is { facility: StateFacility; point: LonLat } => item !== null);

  features.forEach((feature) => {
    const uid = feature.properties.districtUid ?? districtUid(feature.properties.stateKey, feature.properties.districtKey);
    accessByUid.set(uid, emptyAccessSummary());
    const centroid = geometryCentroid(feature.geometry);
    if (centroid) centroidsByUid.set(uid, centroid);
  });

  facilityPoints.forEach(({ facility, point }) => {
    const feature = features.find((candidate) => pointInGeometry(point, candidate.geometry));
    if (!feature) return;

    const uid = feature.properties.districtUid ?? districtUid(feature.properties.stateKey, feature.properties.districtKey);
    const summary = accessByUid.get(uid) ?? emptyAccessSummary();
    summary.facilityCount += 1;
    summary.weightedAccessPoints += accessWeight(facility.operator_type);
    if (facility.operator_type === 'public') summary.publicCount += 1;
    else if (facility.operator_type === 'private') summary.privateCount += 1;
    else summary.unknownCount += 1;
    accessByUid.set(uid, summary);
  });

  accessByUid.forEach((summary, uid) => {
    const centroid = centroidsByUid.get(uid);
    if (!centroid || facilityPoints.length === 0) return;
    const nearest = facilityPoints.reduce(
      (current, { point }) => Math.min(current, distanceKm(centroid, point)),
      Infinity
    );
    summary.weightedAccessPoints = Number(summary.weightedAccessPoints.toFixed(2));
    summary.nearestFacilityDistanceKm = Number.isFinite(nearest) ? Number(nearest.toFixed(1)) : null;
  });

  return accessByUid;
}

function changeLabel(district: DistrictPriority | null, access?: CoordinateAccessSummary) {
  if (!district) return 'Data not available';
  const delta = scoreDelta(district, access);
  if (delta >= 1) return 'Priority increased';
  if (delta <= -1) return 'Priority reduced';
  return 'No material change';
}

function changeBadgeClass(district: DistrictPriority | null, access?: CoordinateAccessSummary) {
  if (!district) return 'border border-slate-300 bg-slate-100 text-slate-600';
  const delta = scoreDelta(district, access);
  if (delta >= 1) return 'border border-rose-300 bg-rose-100 text-rose-900';
  if (delta <= -1) return 'border border-sky-300 bg-sky-100 text-sky-900';
  return 'border border-slate-300 bg-slate-100 text-slate-700';
}

function changeReasons(district: DistrictPriority, access?: CoordinateAccessSummary) {
  const reasons: string[] = [];

  if (access) {
    reasons.push(
      `${access.facilityCount} coordinate-validated facility points fall inside this district polygon after spatial assignment.`
    );
    if (access.nearestFacilityDistanceKm !== null) {
      reasons.push(`Nearest coordinate-validated facility to the district center is ${access.nearestFacilityDistanceKm} km.`);
    }
  } else if (district.facility_count <= 2) {
    reasons.push('Coordinate access is still loading; fallback facility count comes from limited marketplace records.');
  }
  if ((district.t_pin_unambiguous ?? 100) < 75) {
    reasons.push('PIN match confidence is low or postal mappings are ambiguous.');
  }
  if ((district.t_geocoding ?? 100) < 75 || (district.geocoded_facility_count ?? district.facility_count) < district.facility_count) {
    reasons.push('Coordinates are missing or incomplete for some facilities.');
  }
  if (district.evidence_trust_score < 60) {
    reasons.push('Evidence trust is low enough to materially affect the score.');
  }
  if (district.contains_suppressed_value || district.contains_caution_estimate) {
    reasons.push('Some NFHS indicators are suppressed or caution estimates.');
  } else {
    reasons.push('NFHS indicators are available for the district.');
  }

  return reasons;
}

export function OverviewPage() {
  const [loadedMap, setLoadedMap] = useState<LoadedDistrictMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
  const [focusedStateKey, setFocusedStateKey] = useState<string | null>(null);
  const [registeredMapName, setRegisteredMapName] = useState(mapName);
  const [coordinateAccessByUid, setCoordinateAccessByUid] = useState<Map<string, CoordinateAccessSummary>>(new Map());
  const [coordinateAccessStatus, setCoordinateAccessStatus] = useState<'loading' | 'ready' | 'partial' | 'failed'>('loading');
  const [facilitiesByState, setFacilitiesByState] = useState<Map<string, StateFacility[]>>(new Map());
  const [showRealDeserts, setShowRealDeserts] = useState(false);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [confirmedSummaryByUid, setConfirmedSummaryByUid] = useState<Map<string, DistrictEvidenceOverrideSummary>>(
    new Map()
  );
  const [pinColorMode, setPinColorMode] = useState<PinColorMode>('ownership');
  const [activePinGroups, setActivePinGroups] = useState<string[]>([]);
  const [districtContext, setDistrictContext] = useState<DistrictContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<DistrictChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [agentTrace, setAgentTrace] = useState<AgentTraceStep[]>([]);
  const [lastCopilotFinding, setLastCopilotFinding] = useState<{
    question: string;
    answer: string;
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  } | null>(null);
  const [confirmDelta, setConfirmDelta] = useState('5');
  const [confirmSourceUrl, setConfirmSourceUrl] = useState('');
  const [confirmSourceTitle, setConfirmSourceTitle] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadNationalDistrictMap() {
      const [boundaries, stateBoundary] = await Promise.all([
        Promise.all(
          boundaryFiles.map((file) => fetchJson<DistrictBoundaryGeoJson>(`/state-district-boundaries/${file}.json`))
        ),
        fetchJson<IndiaAdm1GeoJson>('/india-adm1.json'),
      ]);
      const districtBoundary = {
        type: 'FeatureCollection' as const,
        features: boundaries.flatMap((boundary) => boundary.features),
      };
      const mergedBoundary = addMapFeatureUids(districtBoundary, stateBoundary);
      const stateKeys = Array.from(new Set(mergedBoundary.features.map((feature) => feature.properties.stateKey)));
      const districtRows = await Promise.all(
        stateKeys
          .filter((stateKey) => stateKey !== 'state-outline')
          .map((stateKey) =>
            fetchJson<DistrictPriority[]>(`/api/districts?state=${encodeURIComponent(stateKey)}&limit=200`)
          )
      );

      if (cancelled) return;
      echarts.registerMap(mapName, mergedBoundary as unknown as Parameters<typeof echarts.registerMap>[1]);
      const districts = districtRows.flat();
      setLoadedMap({ boundary: mergedBoundary, districts });
    }

    void loadNationalDistrictMap().catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : 'Failed to load national district map.');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchEvidenceOverrideSummaries()
      .then((lookup) => {
        if (!cancelled) setConfirmedSummaryByUid(lookup);
      })
      .catch(() => {
        if (!cancelled) setConfirmedSummaryByUid(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const districtByUid = useMemo(
    () => buildDistrictLookup(loadedMap?.districts ?? []),
    [loadedMap?.districts]
  );
  const visibleBoundary = useMemo<DistrictBoundaryGeoJson | null>(() => {
    if (!loadedMap) return null;
    if (!focusedStateKey) return loadedMap.boundary;

    return {
      type: 'FeatureCollection',
      features: loadedMap.boundary.features.filter((feature) => feature.properties.stateKey === focusedStateKey),
    };
  }, [focusedStateKey, loadedMap]);
  const activeMapName = focusedStateKey ? `${mapName}-${focusedStateKey}` : mapName;
  const chartMapName = activeMapName === mapName || registeredMapName === activeMapName ? activeMapName : mapName;
  const focusedStateName =
    focusedStateKey && loadedMap
      ? loadedMap.districts.find((district) => district.state_key === focusedStateKey)?.state_name
      : null;
  const activeUid = hoveredUid ?? selectedUid;
  const selectedDistrict = selectedUid ? districtByUid.get(selectedUid) ?? null : null;
  const selectedCoordinateAccess = selectedUid ? coordinateAccessByUid.get(selectedUid) : undefined;
  const selectedConfirmedSummary = selectedUid ? confirmedSummaryByUid.get(selectedUid) : undefined;
  const confirmedVisibleDistrictCount = useMemo(() => {
    if (!visibleBoundary) return 0;
    return visibleBoundary.features.filter((feature) => {
      if (feature.properties.stateKey === 'state-outline') return false;
      const uid = feature.properties.districtUid ?? districtUid(feature.properties.stateKey, feature.properties.districtKey);
      return confirmedSummaryByUid.has(uid);
    }).length;
  }, [confirmedSummaryByUid, visibleBoundary]);
  const visibleFacilities = useMemo(() => {
    if (focusedStateKey) return facilitiesByState.get(focusedStateKey) ?? [];
    return Array.from(facilitiesByState.values()).flat();
  }, [facilitiesByState, focusedStateKey]);
  const filteredFacilities = useMemo(() => {
    if (activePinGroups.length === 0) return visibleFacilities;
    const activeGroups = new Set(activePinGroups);
    return visibleFacilities.filter((facility) => activeGroups.has(pinGroup(facility, pinColorMode)));
  }, [activePinGroups, pinColorMode, visibleFacilities]);
  const facilityPinData = useMemo(
    () =>
      filteredFacilities.map((facility) => {
        const group = pinGroup(facility, pinColorMode);
        return {
          name: facility.name || 'Unnamed facility',
          coord: [facility.longitude, facility.latitude],
          value: [facility.longitude, facility.latitude],
          facility,
          pinLabel: pinLabel(group),
          itemStyle: {
            color: pinColor(group),
            borderColor: '#ffffff',
            borderWidth: 1.5,
          },
        };
      }),
    [filteredFacilities, pinColorMode]
  );
  const pinLegend = useMemo(() => {
    const groups = new Map<string, number>();
    visibleFacilities.forEach((facility) => {
      const group = pinGroup(facility, pinColorMode);
      groups.set(group, (groups.get(group) ?? 0) + 1);
    });

    return Array.from(groups.entries())
      .sort(([, left], [, right]) => right - left)
      .map(([group, count]) => ({
        group,
        count,
        label: pinLabel(group),
        color: pinColor(group),
      }));
  }, [pinColorMode, visibleFacilities]);
  const serviceHighlights = useMemo(() => {
    const summary = districtContext?.serviceSummary;
    if (!summary) return [];

    return [
      ['maternal_child', summary.service_maternal_child_count],
      ['emergency_critical', summary.service_emergency_critical_count],
      ['diagnostics', summary.service_diagnostics_count],
      ['diabetes_endocrine', summary.service_diabetes_endocrine_count],
      ['surgery_orthopedic', summary.service_surgery_orthopedic_count],
      ['cardiac', summary.service_cardiac_count],
      ['renal', summary.service_renal_count],
      ['oncology', summary.service_oncology_count],
    ]
      .filter(([, count]) => Number(count) > 0)
      .sort(([, left], [, right]) => Number(right) - Number(left))
      .slice(0, 4);
  }, [districtContext]);
  const populationAttributes = useMemo(() => {
    const profile = districtContext?.healthProfile;
    if (!profile) return [];

    return [
      ['Households surveyed', formatNumber(profile.households_surveyed)],
      ['Women interviewed', formatNumber(profile.women_interviewed)],
      ['Men interviewed', formatNumber(profile.men_interviewed)],
      ['Institutional births', formatPercent(profile.institutional_birth_pct)],
      ['Four ANC visits', formatPercent(profile.four_anc_visits_pct)],
      ['Health insurance', formatPercent(profile.health_insurance_pct)],
      ['Child anaemia', formatPercent(profile.child_anaemia_pct)],
      ['Child underweight', formatPercent(profile.child_underweight_pct)],
    ];
  }, [districtContext]);

  useEffect(() => {
    if (!visibleBoundary) return;

    echarts.registerMap(activeMapName, visibleBoundary as unknown as Parameters<typeof echarts.registerMap>[1]);
    setRegisteredMapName(activeMapName);
  }, [activeMapName, visibleBoundary]);

  useEffect(() => {
    setActivePinGroups([]);
  }, [focusedStateKey, pinColorMode]);

  useEffect(() => {
    if (!loadedMap) return;

    let cancelled = false;
    const districtFeaturesByState = loadedMap.boundary.features.reduce((byState, feature) => {
      if (feature.properties.stateKey === 'state-outline') return byState;
      const features = byState.get(feature.properties.stateKey) ?? [];
      features.push(feature);
      byState.set(feature.properties.stateKey, features);
      return byState;
    }, new Map<string, DistrictBoundaryFeature[]>());

    async function loadCoordinateAccess() {
      const nextAccess = new Map<string, CoordinateAccessSummary>();
      const nextFacilities = new Map<string, StateFacility[]>();
      const states = Array.from(districtFeaturesByState.entries());
      let failedStates = 0;

      for (const [stateKey, features] of states) {
        if (cancelled) return;
        try {
          const facilities = await fetchJson<StateFacility[]>(
            `/api/map/state/${encodeURIComponent(stateKey)}/facilities?limit=20000`
          );
          nextFacilities.set(stateKey, facilities);
          buildCoordinateAccess(features, facilities).forEach((summary, uid) => {
            nextAccess.set(uid, summary);
          });
          setCoordinateAccessByUid(new Map(nextAccess));
          setFacilitiesByState(new Map(nextFacilities));
        } catch {
          failedStates += 1;
        }
      }

      if (!cancelled) {
        setCoordinateAccessByUid(nextAccess);
        setFacilitiesByState(nextFacilities);
        setCoordinateAccessStatus(failedStates === 0 ? 'ready' : nextAccess.size > 0 ? 'partial' : 'failed');
      }
    }

    setCoordinateAccessStatus('loading');
    setFacilitiesByState(new Map());
    void loadCoordinateAccess();

    return () => {
      cancelled = true;
    };
  }, [loadedMap]);

  useEffect(() => {
    if (!selectedDistrict) {
      setDistrictContext(null);
      setChatQuestion('');
      setChatMessages([]);
      setAgentTrace([]);
      setLastCopilotFinding(null);
      return;
    }

    let cancelled = false;
    setContextLoading(true);
    setContextError(null);
    setDistrictContext(null);
    setChatMessages([]);
    setChatError(null);
    setAgentTrace([]);
    setLastCopilotFinding(null);
    setConfirmDelta('5');
    setConfirmSourceUrl('');
    setConfirmSourceTitle('');
    setConfirmNotes('');
    setConfirmMessage(null);
    setConfirmError(null);
    setChatQuestion(defaultDistrictQuestion(selectedDistrict));

    const params = new URLSearchParams({
      state: selectedDistrict.state_key,
      district: selectedDistrict.district_key,
    });

    void fetchJson<DistrictContextResponse>(`/api/district-context?${params.toString()}`)
      .then((context) => {
        if (!cancelled) setDistrictContext(context);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setContextError(reason instanceof Error ? reason.message : 'Failed to load district context.');
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDistrict]);

  async function askDistrictCopilot(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedDistrict || chatQuestion.trim().length < 8) return;

    const question = chatQuestion.trim();
    const userMessage: DistrictChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: question,
    };
    const nextUserMessages = [...chatMessages, userMessage];
    setChatMessages(nextUserMessages);
    setChatQuestion('');
    setChatLoading(true);
    setChatError(null);
    setAgentTrace([]);
    setConfirmMessage(null);
    setConfirmError(null);

    try {
      const result = await fetchJson<CopilotResponse>('/api/copilot/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          state: selectedDistrict.state_key,
          district: selectedDistrict.district_key,
        }),
      });
      const assistantMessage: DistrictChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: result.answer,
      };
      const nextMessages = [...nextUserMessages, assistantMessage];
      setChatMessages(nextMessages);
      setLastCopilotFinding({
        question,
        answer: result.answer,
        chatHistory: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      setAgentTrace(result.trust.agentTrace ?? []);
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : 'District copilot failed.');
      setChatQuestion(question);
    } finally {
      setChatLoading(false);
    }
  }

  async function confirmLatestEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedDistrict || !lastCopilotFinding) return;

    const parsedDelta = Number(confirmDelta);
    if (!Number.isFinite(parsedDelta) || parsedDelta < -25 || parsedDelta > 25) {
      setConfirmError('Evidence Confidence adjustment must be between -25 and 25.');
      return;
    }

    setConfirmSaving(true);
    setConfirmMessage(null);
    setConfirmError(null);

    try {
      const summary =
        lastCopilotFinding.answer.length > 3900
          ? `${lastCopilotFinding.answer.slice(0, 3900)}...`
          : lastCopilotFinding.answer;
      const notes = [`Question: ${lastCopilotFinding.question}`, confirmNotes.trim()].filter(Boolean).join('\n\n');
      const chatHistory = lastCopilotFinding.chatHistory.slice(-12).map((message) => ({
        ...message,
        content: message.content.length > 3900 ? `${message.content.slice(0, 3900)}...` : message.content,
      }));
      const created = await fetchJson<DistrictEvidenceOverride>('/api/evidence-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state_key: selectedDistrict.state_key,
          district_key: selectedDistrict.district_key,
          evidence_type: 'copilot_web_verification',
          source_url: confirmSourceUrl.trim(),
          source_title: confirmSourceTitle.trim() || 'District copilot confirmed evidence',
          summary,
          confidence_delta: parsedDelta,
          notes: notes.length > 1900 ? `${notes.slice(0, 1900)}...` : notes,
          chat_history: chatHistory,
        }),
      });

      setDistrictContext((current) =>
        current
          ? {
              ...current,
              evidenceOverrides: [created, ...current.evidenceOverrides.filter((item) => item.id !== created.id)],
            }
          : current
      );
      setConfirmedSummaryByUid(await fetchEvidenceOverrideSummaries());
      setConfirmMessage('Confirmed evidence saved to Lakebase with chat history.');
      setConfirmSourceUrl('');
      setConfirmSourceTitle('');
      setConfirmNotes('');
    } catch (reason) {
      setConfirmError(reason instanceof Error ? reason.message : 'Failed to confirm evidence.');
    } finally {
      setConfirmSaving(false);
    }
  }

  function returnToCountryView() {
    setFocusedStateKey(null);
    setSelectedUid(null);
    setHoveredUid(null);
  }

  function togglePinGroup(group: string) {
    setActivePinGroups((current) =>
      current.includes(group) ? current.filter((item) => item !== group) : [...current, group]
    );
  }

  const createChartOption = () => {
    if (!loadedMap || !visibleBoundary) return {};

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: MapParams) => {
          const facility = params.data?.facility;
          if (facility) {
            return [
              `<strong>${facility.name || 'Unnamed facility'}</strong>`,
              params.data?.pinLabel ?? 'Facility',
              `${facility.facility_type ?? 'facility'} · ${facility.operator_type ?? 'unknown'}`,
              [facility.city, facility.pincode].filter(Boolean).join(' · ') || 'Location fields unavailable',
              `Website: ${facility.website_quality ?? 'unknown'}`,
              `Services: ${facility.service_categories || 'not classified'}`,
            ].join('<br/>');
          }

          const district = districtByUid.get(params.name);
          const feature = visibleBoundary.features.find((item) => item.properties.districtUid === params.name);
          const districtName = district?.district_name ?? feature?.properties.districtName ?? 'District';
          const stateName = district?.state_name ?? feature?.properties.stateName ?? 'India';
          const confirmed = confirmedSummaryByUid.get(params.name);

          if (!district) {
            return [`<strong>${districtName}</strong>`, stateName, 'Data not available'].join('<br/>');
          }

          const access = coordinateAccessByUid.get(params.name);
          return [
            `<strong>${district.district_name}</strong>`,
            district.state_name,
            confirmed
              ? `Confirmed evidence: ${confirmed.confirmed_count} row(s), delta ${confirmed.confidence_delta_total >= 0 ? '+' : ''}${confirmed.confidence_delta_total}`
              : 'Confirmed evidence: none yet',
            `Coordinate desert signal: ${baseDesertScoreForAccess(district, access)}`,
            `Evidence-adjusted signal: ${adjustedDesertScore(district, access)}`,
            access
              ? `Coordinate facilities: ${access.facilityCount} (${access.publicCount} public, ${access.privateCount} private)`
              : 'Coordinate access: loading or unavailable',
            access?.nearestFacilityDistanceKm !== null && access?.nearestFacilityDistanceKm !== undefined
              ? `Nearest facility from district center: ${access.nearestFacilityDistanceKm} km`
              : 'Nearest facility distance: N/A',
            `Evidence discount: ${Math.abs(scoreDelta(district, access)).toFixed(1)}`,
            `Evidence trust: ${district.evidence_trust_score}`,
          ].join('<br/>');
        },
      },
      visualMap: {
        show: showRealDeserts,
        seriesIndex: 0,
        min: 0,
        max: 75,
        left: 16,
        bottom: 18,
        text: ['Higher', 'Lower'],
        calculable: false,
        itemHeight: 130,
        inRange: {
          color: ['#f8efd8', '#f2bf63', '#df6b3c', '#9f1239'],
        },
        textStyle: {
          color: '#6b6256',
          fontSize: 10,
        },
      },
      series: [
        {
          name: 'District boundaries',
          type: 'map',
          map: chartMapName,
          nameProperty: 'districtUid',
          roam: true,
          scaleLimit: {
            min: 1,
            max: 24,
          },
          selectedMode: false,
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              color: '#111827',
              formatter: (params: MapParams) => {
                const district = districtByUid.get(params.name);
                const feature = visibleBoundary.features.find((item) => item.properties.districtUid === params.name);
                return district?.district_name ?? feature?.properties.districtName ?? '';
              },
              fontWeight: 650,
            },
            itemStyle: {
              areaColor: '#f59e0b',
              borderColor: '#0f172a',
              borderWidth: 1.2,
            },
          },
          itemStyle: {
            borderColor: '#ffffff',
            borderWidth: 0.5,
            areaColor: showRealDeserts ? '#f5efe3' : '#f8fafc',
          },
          data: visibleBoundary.features.map((feature) => {
            const uid = feature.properties.districtUid ?? districtUid(feature.properties.stateKey, feature.properties.districtKey);
            const district = districtByUid.get(uid);
            const isStateOutline = feature.properties.stateKey === 'state-outline';
            const isActive = activeUid === uid;
            const access = coordinateAccessByUid.get(uid);
            const confirmed = confirmedSummaryByUid.get(uid);
            const isFilteredOut = confirmedOnly && !isStateOutline && !confirmed;

            return {
              name: uid,
              value: showRealDeserts && district && !isFilteredOut ? baseDesertScoreForAccess(district, access) : null,
              silent: isStateOutline ? true : undefined,
              tooltip: isStateOutline ? { show: false } : undefined,
              emphasis: isStateOutline ? { disabled: true } : undefined,
              itemStyle: isStateOutline
                ? {
                    areaColor: 'rgba(255,255,255,0)',
                    borderColor: '#475569',
                    borderWidth: 1.15,
                  }
                : district
                  ? isFilteredOut
                    ? {
                        areaColor: '#f1f5f9',
                        borderColor: '#e2e8f0',
                        opacity: 0.35,
                      }
                    : isActive
                    ? {
                        borderColor: '#0f172a',
                        borderWidth: 2.25,
                      }
                    : confirmed
                      ? {
                          areaColor: showRealDeserts ? undefined : '#ecfdf5',
                          borderColor: '#059669',
                          borderWidth: 1.2,
                        }
                    : showRealDeserts
                      ? undefined
                      : {
                          areaColor: '#f8fafc',
                          borderColor: '#cbd5e1',
                        }
                  : {
                      areaColor: '#e5e7eb',
                      borderColor: '#f1f5f9',
                    },
            };
          }),
          markPoint: {
            symbol: 'circle',
            symbolSize: showRealDeserts ? 7 : 8,
            label: {
              show: false,
            },
            emphasis: {
              scale: 1.6,
              label: {
                show: false,
              },
            },
            data: facilityPinData,
          },
        },
      ],
    };
  };

  const chartEvents = {
    mouseover: (params: MapParams) => {
      if (districtByUid.has(params.name)) setHoveredUid(params.name);
    },
    mouseout: () => setHoveredUid(null),
    click: (params: MapParams) => {
      const district = districtByUid.get(params.name);
      if (!district) return;

      setSelectedUid(params.name);
      setFocusedStateKey(district.state_key);
    },
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        <p className="font-semibold">India district map is not ready</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (!loadedMap) {
    return <Skeleton className="h-[calc(100vh-9rem)] min-h-[680px] rounded-2xl" />;
  }

  const mapScopeLabel = focusedStateName ? `${focusedStateName} state view` : 'Country view';
  const coordinateStatusLabel =
    coordinateAccessStatus === 'ready'
      ? 'Coordinate access layer ready'
      : coordinateAccessStatus === 'partial'
        ? 'Coordinate access partially loaded'
        : coordinateAccessStatus === 'failed'
          ? 'Coordinate access unavailable'
          : 'Coordinate access loading';
  const panelGridClass = focusedStateKey
    ? 'xl:grid-cols-[minmax(0,1fr)_minmax(520px,34vw)]'
    : 'xl:grid-cols-[minmax(0,1fr)_380px]';

  return (
    <div className="min-h-[calc(100vh-2rem)] overflow-hidden rounded-[1.5rem] border bg-slate-950 shadow-2xl">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.22),transparent_34rem),linear-gradient(135deg,#020617,#0f172a_58%,#172554)] px-5 py-5 text-white md:px-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">
                Evidence review
              </span>
              <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100">
                Planning support
              </span>
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              India coordinate-based healthcare desert map
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
              Compare coordinate-derived medical desert signal with evidence-adjusted priority. Facility points are
              assigned to district polygons, then discounted where the underlying evidence needs verification first.
            </p>
          </div>
          <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2 xl:min-w-[410px]">
            {[
              'NFHS-5 2019-2021',
              'Marketplace facility snapshot',
              coordinateStatusLabel,
              mapScopeLabel,
            ].map((label) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 backdrop-blur">
                <span className="font-medium text-slate-100">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className={`grid gap-4 bg-slate-100 p-4 ${panelGridClass}`}>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {focusedStateName ? 'State drill-down' : 'National comparison'}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-950">
                {focusedStateName
                  ? `${focusedStateName}: districts expanded for closer review`
                  : `${loadedMap.districts.length.toLocaleString()} districts scored across India`}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Showing {filteredFacilities.length.toLocaleString()} of {visibleFacilities.length.toLocaleString()} coordinate
                hospital/facility pins.
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Confirmed evidence exists for {confirmedVisibleDistrictCount.toLocaleString()} district
                {confirmedVisibleDistrictCount === 1 ? '' : 's'} in this view.
              </p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                Pins are discovered records. Turn on Real deserts to color districts by the coordinate-derived shortage
                signal; use Confirmed to focus on districts with planner-approved evidence rows.
              </p>
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <MapToggle
                  checked={showRealDeserts}
                  label="Real deserts"
                  description={showRealDeserts ? 'Districts colored by shortage' : 'Pins and boundaries view'}
                  onChange={() => setShowRealDeserts((current) => !current)}
                />
                <MapToggle
                  checked={confirmedOnly}
                  label="Confirmed"
                  description={confirmedOnly ? 'Only planner-confirmed districts' : 'Show all districts'}
                  onChange={() => setConfirmedOnly((current) => !current)}
                />
                {focusedStateKey && (
                  <Button type="button" variant="outline" onClick={returnToCountryView}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to country
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap justify-start gap-1.5 md:justify-end">
                {(Object.keys(pinModeLabels) as PinColorMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      pinColorMode === mode
                        ? 'border-slate-950 bg-slate-950 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                    }`}
                    onClick={() => setPinColorMode(mode)}
                  >
                    {pinModeLabels[mode]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {pinLegend.length > 0 && (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">
                  Click {pinModeLabels[pinColorMode].toLowerCase()} chips to filter pins
                </p>
                {activePinGroups.length > 0 && (
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-500 hover:text-slate-900"
                    onClick={() => setActivePinGroups([])}
                  >
                    Reset filters
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
              {pinLegend.map((item) => (
                <button
                  key={item.group}
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all ${
                    activePinGroups.includes(item.group)
                      ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                      : activePinGroups.length > 0
                        ? 'border-slate-200 bg-white text-slate-400 opacity-60 hover:opacity-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
                  }`}
                  onClick={() => togglePinGroup(item.group)}
                  aria-pressed={activePinGroups.includes(item.group)}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className={activePinGroups.includes(item.group) ? 'font-medium text-white' : 'font-medium'}>
                    {item.label}
                  </span>
                  <span>{item.count.toLocaleString()}</span>
                </button>
              ))}
              </div>
            </div>
          )}
          <ReactECharts
            key={activeMapName}
            option={createChartOption()}
            className="h-[calc(100vh-14rem)] min-h-[620px] rounded-2xl border border-slate-200 bg-slate-50"
            style={{ height: 'calc(100vh - 14rem)', minHeight: 620 }}
            onEvents={chartEvents}
            notMerge
          />
        </section>

        <aside className="max-h-[calc(100vh-10rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
          {selectedDistrict ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Decision audit</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                    {selectedDistrict.district_name}
                  </h2>
                  <p className="text-sm text-slate-600">{selectedDistrict.state_name}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${changeBadgeClass(
                    selectedDistrict,
                    selectedCoordinateAccess
                  )}`}
                >
                  {changeLabel(selectedDistrict, selectedCoordinateAccess)}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className={`rounded-2xl border p-3 ${metricCardClass.coordinateDesert}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">Coordinate desert</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {baseDesertScoreForAccess(selectedDistrict, selectedCoordinateAccess)}
                    <MetricInfo label="Coordinate desert" detail={metricDetails.coordinateDesert} />
                  </p>
                  <p className="mt-1 text-[11px] leading-4 opacity-75">{metricDescriptions.coordinateDesert}</p>
                </div>
                <div className={`rounded-2xl border p-3 ${metricCardClass.evidenceAdjusted}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">Evidence-adjusted</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {adjustedDesertScore(selectedDistrict, selectedCoordinateAccess)}
                    <MetricInfo label="Evidence-adjusted" detail={metricDetails.evidenceAdjusted} />
                  </p>
                  <p className="mt-1 text-[11px] leading-4 opacity-75">{metricDescriptions.evidenceAdjusted}</p>
                </div>
                <div className={`rounded-2xl border p-3 ${metricCardClass.coordinateFacilities}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">Coordinate facilities</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {selectedCoordinateAccess ? selectedCoordinateAccess.facilityCount : '...'}
                    <MetricInfo label="Coordinate facilities" detail={metricDetails.coordinateFacilities} />
                  </p>
                  <p className="mt-1 text-[11px] leading-4 opacity-75">{metricDescriptions.coordinateFacilities}</p>
                </div>
                <div className={`rounded-2xl border p-3 ${metricCardClass.evidenceDiscount}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">Evidence discount</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {Math.abs(scoreDelta(selectedDistrict, selectedCoordinateAccess)).toFixed(1)}
                    <MetricInfo label="Evidence discount" detail={metricDetails.evidenceDiscount} />
                  </p>
                  <p className="mt-1 text-[11px] leading-4 opacity-75">{metricDescriptions.evidenceDiscount}</p>
                </div>
              </div>

              {selectedCoordinateAccess && (
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <div className={`rounded-xl border px-3 py-2 ${metricCardClass.public}`}>
                    <span className="font-semibold">{selectedCoordinateAccess.publicCount}</span> public
                    <p className="mt-1 leading-4 opacity-75">{metricDescriptions.publicPrivate}</p>
                  </div>
                  <div className={`rounded-xl border px-3 py-2 ${metricCardClass.private}`}>
                    <span className="font-semibold">{selectedCoordinateAccess.privateCount}</span> private
                    <p className="mt-1 leading-4 opacity-75">{metricDescriptions.publicPrivate}</p>
                  </div>
                  <div className={`rounded-xl border px-3 py-2 ${metricCardClass.nearest}`}>
                    <span className="font-semibold">
                      {selectedCoordinateAccess.nearestFacilityDistanceKm ?? 'N/A'}
                    </span>{' '}
                    km nearest
                    <p className="mt-1 leading-4 opacity-75">{metricDescriptions.nearestKm}</p>
                  </div>
                </div>
              )}

              <div className="mt-5">
                <p className="text-sm font-semibold text-slate-950">Why the score was adjusted</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {changeReasons(selectedDistrict, selectedCoordinateAccess).map((reason) => (
                    <li key={reason} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              <div
                className={`mt-5 rounded-2xl border p-3 text-sm leading-6 ${actionColorClass(
                  selectedDistrict.recommended_action
                )}`}
              >
                <strong>Action:</strong> {actionLabels[selectedDistrict.recommended_action]}. Treat this as planning
                support, then verify source records before operational use.
                <p className="mt-2 text-xs leading-5 opacity-80">
                  {actionDescriptions[selectedDistrict.recommended_action]}
                </p>
                <div className="mt-3 border-t border-current/20 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">Action guide</p>
                  <div className="mt-2 space-y-1.5">
                    {(Object.entries(actionLabels) as Array<[keyof typeof actionLabels, string]>).map(([action, label]) => (
                      <p key={action} className="text-xs leading-5 opacity-85">
                        <span className={`mr-1 rounded-full border px-2 py-0.5 font-semibold ${actionColorClass(action)}`}>
                          {label}
                        </span>
                        {actionDescriptions[action]}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                Directional planning signal. Verify source records before operational decisions.
              </div>

              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">Confirmed evidence</p>
                    <p className="mt-1 text-emerald-900/80">
                      Planner-approved evidence rows are append-only and keep the chat history used for confirmation.
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 font-semibold">
                    {selectedConfirmedSummary?.confirmed_count ?? districtContext?.evidenceOverrides.length ?? 0} row
                    {(selectedConfirmedSummary?.confirmed_count ?? districtContext?.evidenceOverrides.length ?? 0) === 1
                      ? ''
                      : 's'}
                  </span>
                </div>
                {selectedConfirmedSummary && (
                  <p className="mt-2">
                    Evidence Confidence delta total:{' '}
                    <span className="font-semibold">
                      {selectedConfirmedSummary.confidence_delta_total >= 0 ? '+' : ''}
                      {selectedConfirmedSummary.confidence_delta_total}
                    </span>
                  </p>
                )}
                {districtContext?.evidenceOverrides.length ? (
                  <div className="mt-3 space-y-2">
                    {districtContext.evidenceOverrides.slice(0, 3).map((item) => (
                      <div key={item.id} className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                        <p className="font-semibold">
                          {item.source_title || item.evidence_type} · {item.confidence_delta >= 0 ? '+' : ''}
                          {item.confidence_delta}
                        </p>
                        <p className="mt-1 line-clamp-3 text-emerald-900/80">{item.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-emerald-900/75">No confirmed evidence has been saved for this district yet.</p>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">District chatbot</p>
                    <p className="mt-1 text-sm font-semibold">Short planning answer</p>
                    <p className="mt-1 text-xs text-slate-400">Action, evidence, caveat, next step.</p>
                  </div>
                  <Bot className="h-5 w-5 text-sky-300" />
                </div>

                {contextLoading && (
                  <div className="mt-4 space-y-2">
                    <Skeleton className="h-16 rounded-xl bg-white/10" />
                    <Skeleton className="h-16 rounded-xl bg-white/10" />
                  </div>
                )}

                {contextError && <p className="mt-4 text-sm leading-6 text-amber-200">{contextError}</p>}

                {districtContext && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`rounded-xl border p-3 ${metricCardClass.facilitiesDark}`}>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                          Facility records
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {formatNumber(districtContext.serviceSummary?.facility_record_count ?? selectedDistrict.facility_count)}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-emerald-100/75">{metricDescriptions.facilityRecords}</p>
                      </div>
                      <div className={`rounded-xl border p-3 ${metricCardClass.ownershipDark}`}>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Public / private</p>
                        <p className="mt-1 text-sm font-semibold">
                          {formatNumber(districtContext.serviceSummary?.public_government_facility_count)} /{' '}
                          {formatNumber(districtContext.serviceSummary?.private_facility_count)}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-orange-100/75">{metricDescriptions.publicPrivate}</p>
                      </div>
                      <div className={`rounded-xl border p-3 ${metricCardClass.websites}`}>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                          Clean websites
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {formatNumber(districtContext.serviceSummary?.website_clean_count)}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-cyan-100/75">{metricDescriptions.cleanWebsites}</p>
                      </div>
                      <div className={`rounded-xl border p-3 ${metricCardClass.services}`}>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                          Service breadth
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {formatNumber(districtContext.serviceSummary?.avg_service_category_count)}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-violet-100/75">{metricDescriptions.serviceBreadth}</p>
                      </div>
                    </div>

                    {serviceHighlights.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                        <p className="text-xs font-semibold text-slate-200">Top service mentions</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {serviceHighlights.map(([service, count]) => (
                            <span
                              key={service}
                              className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2.5 py-1 text-xs text-violet-100"
                            >
                              {serviceLabel(String(service))}: {formatNumber(count)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {populationAttributes.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                        <p className="text-xs font-semibold text-slate-200">NFHS population-survey attributes</p>
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          {populationAttributes.map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-slate-400">{label}</dt>
                              <dd className="font-semibold text-slate-100">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                    {districtContext.facilities.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                        <p className="text-xs font-semibold text-slate-200">Example facility records</p>
                        <div className="mt-2 space-y-2">
                          {districtContext.facilities.slice(0, 4).map((facility) => (
                            <div key={facility.facility_id} className="rounded-lg bg-white/[0.06] px-3 py-2">
                              <p className="text-xs font-semibold text-slate-100">
                                {facility.name || 'Unnamed facility'}
                              </p>
                              <p className="mt-1 text-[11px] leading-4 text-slate-400">
                                {facility.facility_type_clean || 'facility'} · {facility.operator_group || 'unknown'} ·{' '}
                                {facility.website_quality || 'website unknown'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatMessages.length === 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                        <p className="text-xs font-semibold text-slate-200">Ask a question about this district</p>
                        <div className="mt-2 space-y-2">
                          {[defaultDistrictQuestion(selectedDistrict), ...districtQuestionTemplates].map((question) => (
                            <button
                              key={question}
                              type="button"
                              className="block w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-xs leading-5 text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
                              onClick={() => setChatQuestion(question)}
                            >
                              {question}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatMessages.length > 0 && (
                      <div
                        className={`space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.06] p-3 ${
                          focusedStateKey ? 'max-h-[34rem]' : 'max-h-96'
                        }`}
                      >
                        {chatMessages.map((message) => (
                          <div
                            key={message.id}
                            className={`rounded-xl p-3 ${
                              message.role === 'user'
                                ? 'ml-8 bg-sky-300 text-slate-950'
                                : 'mr-8 border border-white/10 bg-white text-slate-800'
                            }`}
                          >
                            {message.role === 'user' ? (
                              <p className="text-sm leading-6">{message.content}</p>
                            ) : (
                              <div
                                className="prose-output text-sm leading-6"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                              />
                            )}
                          </div>
                        ))}
                        {chatLoading && <Skeleton className="mr-8 h-28 rounded-xl bg-white/10" />}
                      </div>
                    )}

                    {(chatLoading || agentTrace.length > 0) && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-200">Agent progress</p>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                            {chatLoading ? 'Running' : 'Completed'}
                          </span>
                        </div>
                        <div className="mt-2 space-y-2">
                          {(agentTrace.length > 0
                            ? agentTrace
                            : [
                                { step: 1, tool: 'evidence_lookup', tool_input: selectedDistrict.district_name },
                                { step: 2, tool: 'web_search', tool_input: 'official public context if needed' },
                                { step: 3, tool: 'finish', tool_input: 'compact planning answer' },
                              ]
                          ).map((step, index) => (
                            <div
                              key={`${step.step ?? index}-${step.tool ?? 'pending'}`}
                              className={`rounded-lg border px-3 py-2 text-xs leading-5 ${traceToolClass(step.tool)}`}
                            >
                              <p className="font-semibold">
                                Step {step.step ?? index + 1}: {traceToolLabel(step.tool)}
                              </p>
                              {step.tool_input && (
                                <p className="mt-0.5 text-[11px] opacity-75">Input: {String(step.tool_input)}</p>
                              )}
                              {step.reason && (
                                <p className="mt-0.5 text-[11px] opacity-75">Reason: {String(step.reason)}</p>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-slate-400">
                          Progress shows tool choices and status, not private model reasoning.
                        </p>
                      </div>
                    )}

                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        void askDistrictCopilot(event);
                      }}
                    >
                      <Textarea
                        value={chatQuestion}
                        onChange={(event) => setChatQuestion(event.target.value)}
                        className="min-h-24 border-white/10 bg-white/[0.08] text-sm text-white placeholder:text-slate-400"
                        placeholder="Ask about hospitals, population attributes, service evidence, or why this action was assigned"
                      />
                      {chatError && <p className="text-xs text-amber-200">{chatError}</p>}
                      <Button
                        type="submit"
                        className="w-full bg-sky-300 text-slate-950 hover:bg-sky-200"
                        disabled={chatLoading || chatQuestion.trim().length < 8}
                      >
                        <Send className="mr-2 h-4 w-4" /> {chatLoading ? 'Grounding answer…' : 'Ask district copilot'}
                      </Button>
                    </form>

                    <form
                      className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3"
                      onSubmit={(event) => {
                        void confirmLatestEvidence(event);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-emerald-100">Confirm latest evidence</p>
                          <p className="mt-1 text-[11px] leading-4 text-emerald-100/70">
                            Saves an auditable Lakebase row with the chat history. It does not overwrite base scores.
                          </p>
                        </div>
                        <span className="rounded-full border border-emerald-200/25 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                          Confirmed
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                          Delta
                          <input
                            type="number"
                            min="-25"
                            max="25"
                            step="1"
                            value={confirmDelta}
                            onChange={(event) => setConfirmDelta(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none focus:border-emerald-200"
                          />
                        </label>
                        <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                          Source URL
                          <input
                            type="url"
                            value={confirmSourceUrl}
                            onChange={(event) => setConfirmSourceUrl(event.target.value)}
                            placeholder="Optional official or web source"
                            className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-200"
                          />
                        </label>
                      </div>
                      <label className="mt-2 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Source title
                        <input
                          type="text"
                          value={confirmSourceTitle}
                          onChange={(event) => setConfirmSourceTitle(event.target.value)}
                          placeholder="Optional short label"
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-200"
                        />
                      </label>
                      <label className="mt-2 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Planner notes
                        <Textarea
                          value={confirmNotes}
                          onChange={(event) => setConfirmNotes(event.target.value)}
                          className="mt-1 min-h-20 border-white/10 bg-white/[0.08] text-sm text-white placeholder:text-slate-500"
                          placeholder="Optional reason for accepting this evidence"
                        />
                      </label>
                      {confirmMessage && <p className="mt-2 text-xs text-emerald-100">{confirmMessage}</p>}
                      {confirmError && <p className="mt-2 text-xs text-amber-200">{confirmError}</p>}
                      <Button
                        type="submit"
                        className="mt-3 w-full bg-emerald-300 text-slate-950 hover:bg-emerald-200"
                        disabled={confirmSaving || !lastCopilotFinding}
                      >
                        {confirmSaving ? 'Saving confirmed evidence…' : 'Confirm and save evidence'}
                      </Button>
                      {!lastCopilotFinding && (
                        <p className="mt-2 text-[11px] leading-4 text-slate-400">
                          Ask the district copilot first, then confirm the answer if the evidence should be written back.
                        </p>
                      )}
                    </form>

                    <p className="text-[11px] leading-4 text-slate-400">{districtContext.sourceNote}</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-slate-600">
                Click a district to open its decision audit, metric explanations, action class, and district copilot.
              </p>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Metric guide</p>
                <div className="mt-3 space-y-2 text-xs leading-5">
                  <p className={`rounded-xl border px-3 py-2 ${metricCardClass.coordinateDesert}`}>
                    <span className="font-semibold">Coordinate desert:</span>{' '}
                    {metricDescriptions.coordinateDesert}
                  </p>
                  <p className={`rounded-xl border px-3 py-2 ${metricCardClass.evidenceAdjusted}`}>
                    <span className="font-semibold">Evidence-adjusted:</span>{' '}
                    {metricDescriptions.evidenceAdjusted}
                  </p>
                  <p className={`rounded-xl border px-3 py-2 ${metricCardClass.evidenceDiscount}`}>
                    <span className="font-semibold">Evidence discount:</span>{' '}
                    {metricDescriptions.evidenceDiscount}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Action guide</p>
                <div className="mt-3 space-y-2">
                  {(Object.entries(actionLabels) as Array<[keyof typeof actionLabels, string]>).map(([action, label]) => (
                    <p key={action} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${actionColorClass(action)}`}>
                      <span className="font-semibold">{label}:</span> {actionDescriptions[action]}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
