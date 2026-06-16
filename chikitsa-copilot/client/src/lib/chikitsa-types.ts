export interface DistrictPriority {
  state_name: string;
  state_key: string;
  district_name: string;
  district_key: string;
  district_geo_key?: string;
  facility_count: number;
  public_facility_count?: number;
  private_facility_count?: number;
  unknown_operator_count?: number;
  geocoded_facility_count?: number;
  flagged_facility_count: number;
  child_anaemia_pct: number;
  child_underweight_pct: number;
  four_anc_visits_pct: number;
  health_insurance_pct: number;
  contains_caution_estimate: boolean;
  contains_suppressed_value: boolean;
  health_need_score: number;
  facility_scarcity_score: number;
  desert_score: number;
  evidence_trust_score: number;
  trust_adjusted_score: number;
  desert_area_pct?: number;
  desert_area_pct_trust_adjusted?: number;
  desert_population?: number | null;
  desert_population_pct?: number | null;
  desert_population_trust_adjusted?: number | null;
  desert_population_pct_trust_adjusted?: number | null;
  t_facility_presence?: number;
  t_geocoding?: number | null;
  t_pin_unambiguous?: number | null;
  t_flagged_inverse?: number | null;
  t_indicator_quality?: number;
  t_external_verification?: number | null;
  signals_version?: string;
  recommended_action: InterventionAction;
}

export type InterventionAction = 'build' | 'verify' | 'upgrade' | 'improve_access' | 'investigate';

export interface QualityIssue {
  facility_id: string;
  name: string;
  city: string | null;
  state_or_region: string | null;
  pincode: string | null;
  coordinate_quality: string;
  reported_capacity: number | null;
  capacity_outlier_flag: boolean;
  completeness_score: number;
}

export interface Overview {
  metrics: {
    facilities: number;
    districts: number;
    pincodes: number;
    ambiguous_pincodes: number;
    flagged_facilities: number;
  };
  priorityDistricts: DistrictPriority[];
  qualityIssues: QualityIssue[];
  freshness: string;
}

export interface IndiaMapState {
  state_name: string;
  state_key: string;
  district_count: number;
  facility_count: number;
  avg_desert_score: number;
  avg_evidence_confidence: number;
  max_trust_adjusted_score: number;
  build_count: number;
  verify_count: number;
  top_district_name: string;
  top_district_action: InterventionAction;
  top_district_score: number;
}

export interface IndiaMapOverview {
  states: IndiaMapState[];
  freshness: string;
  assignmentMethod: string;
}

export type PlanningSignal = DistrictPriority;

export interface DesertHex {
  h3_index: string;
  is_covered: boolean;
  is_covered_trust_adjusted: boolean;
  population: number | null;
  nearest_facility_distance_km: number | null;
  district_key: string | null;
}

export interface StateCoverageResponse {
  state_key: string;
  resolution: number;
  base_radius_km: number;
  hexes: DesertHex[];
  totals: {
    total_population: number;
    desert_population_base: number;
    desert_population_trust_adjusted: number;
    total_area_hexes: number;
    desert_area_hexes_base: number;
    desert_area_hexes_trust_adjusted: number;
  };
}

export interface StateFacility {
  facility_id: string;
  name: string;
  facility_type: string | null;
  latitude: number;
  longitude: number;
  operator_type: 'public' | 'private' | 'unknown' | null;
  city?: string | null;
  pincode?: string | null;
  website_quality?: string | null;
  service_categories?: string | null;
  places_matched: boolean;
}

export interface StateDistrictsResponse {
  state_key: string;
  districts: PlanningSignal[];
  freshness: string;
  geometry_url: string;
}

export interface QualityContamination {
  contaminated_shift: number;
  recovered_from_address: number;
  missing_state: number;
  ambiguous_pincodes: number;
  suppressed_nfhs_districts: number;
  caution_nfhs_districts: number;
}

export interface LocationOptions {
  states: Array<{
    state_name: string;
    state_key: string;
    district_count: number;
  }>;
  districts: Array<{
    state_name: string;
    state_key: string;
    district_name: string;
    district_key: string;
  }>;
}

export interface Facility {
  facility_id: string;
  name: string;
  facility_type: string | null;
  operator_type: string | null;
  city: string | null;
  state_or_region: string | null;
  pincode: string | null;
  specialties: string | null;
  capabilities: string | null;
  coordinate_quality: string;
  capacity_outlier_flag: boolean;
  completeness_score: number;
  district_name: string | null;
  district_key: string | null;
  is_unambiguous: boolean | null;
}

export interface DistrictHealthProfile {
  state_name: string;
  state_key: string;
  district_name: string;
  district_key: string;
  households_surveyed: number | null;
  women_interviewed: number | null;
  men_interviewed: number | null;
  health_insurance_pct: number | null;
  improved_sanitation_pct: number | null;
  four_anc_visits_pct: number | null;
  institutional_birth_pct: number | null;
  child_fully_vaccinated_pct: number | null;
  child_stunted_pct: number | null;
  child_wasted_pct: number | null;
  child_underweight_pct: number | null;
  child_anaemia_pct: number | null;
  women_anaemia_pct: number | null;
  women_high_blood_pressure_pct: number | null;
  men_high_blood_pressure_pct: number | null;
  women_high_blood_sugar_pct: number | null;
  men_high_blood_sugar_pct: number | null;
  cervical_screening_pct: number | null;
  breast_exam_pct: number | null;
  contains_caution_estimate: boolean;
  contains_suppressed_value: boolean;
  source_period: string;
}

export interface DistrictServiceSummary {
  state_name: string;
  state_key: string;
  district_name: string;
  district_key: string;
  facility_record_count: number;
  public_government_facility_count: number;
  private_facility_count: number;
  unknown_operator_facility_count: number;
  website_clean_count: number;
  website_url_like_count: number;
  website_domain_only_count: number;
  website_third_party_or_generic_count: number;
  source_url_count: number;
  service_maternal_child_count: number;
  service_emergency_critical_count: number;
  service_diagnostics_count: number;
  service_cardiac_count: number;
  service_diabetes_endocrine_count: number;
  service_renal_count: number;
  service_oncology_count: number;
  service_eye_care_count: number;
  service_dental_count: number;
  service_surgery_orthopedic_count: number;
  avg_website_signal_score: number | null;
  avg_service_category_count: number | null;
  layer_version: string;
}

export interface DistrictFacilityService {
  facility_id: string;
  name: string | null;
  facility_type_clean: string | null;
  operator_group: string | null;
  city: string | null;
  pincode: string | null;
  coordinate_quality: string;
  doctor_count: number | null;
  reported_capacity: number | null;
  website_quality: string | null;
  service_categories: string | null;
}

export type DistrictEvidenceOverrideType =
  | 'copilot_web_verification'
  | 'official_registry'
  | 'facility_website'
  | 'planner_note';

export interface DistrictEvidenceOverride {
  id: string;
  state_key: string;
  district_key: string;
  evidence_type: DistrictEvidenceOverrideType;
  source_url: string;
  source_title: string;
  summary: string;
  confidence_delta: number;
  status: 'confirmed' | 'rejected' | 'superseded';
  confirmed_by: string;
  confirmed_at: string;
  chat_history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  notes: string;
  created_at: string;
}

export interface DistrictEvidenceOverrideSummary {
  state_key: string;
  district_key: string;
  confirmed_count: number;
  confidence_delta_total: number;
  latest_confirmed_at: string;
}

export interface DistrictContextResponse {
  district: DistrictPriority;
  healthProfile: DistrictHealthProfile | null;
  serviceSummary: DistrictServiceSummary | null;
  facilities: DistrictFacilityService[];
  evidenceOverrides: DistrictEvidenceOverride[];
  sourceNote: string;
}

export interface Intervention {
  id: string;
  title: string;
  state: string;
  district: string;
  action_type: InterventionAction;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'draft' | 'review' | 'approved' | 'active' | 'complete';
  owner: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CopilotResponse {
  answer: string;
  evidence: {
    districts: DistrictPriority[];
    facilitySummaryByDistrict: Array<Record<string, unknown>>;
    facilitySamples: Array<Record<string, unknown>>;
    publicFacilityDetails: Array<Record<string, unknown>>;
    healthProfile?: Record<string, unknown> | null;
    serviceSummary?: Record<string, unknown> | null;
    quality: Record<string, unknown>;
    sourcePeriod: string;
    retrievalScope: {
      state: string;
      district: string;
      districtRowsReturned: number;
      districtRowLimit: number;
      districtCoverage: string;
      facilitySummaryRowsReturned: number;
      facilityExampleRowsReturned: number;
      facilityExampleLimit: number;
      publicFacilityDetailRowsReturned: number;
    };
  };
  trust: {
    model: string;
    modelExecution: string;
    agentMode?: string;
    agentTools?: string[];
    agentTrace?: Array<{
      step?: number;
      tool?: string;
      tool_input?: string;
      reason?: string;
    }>;
    dataExecution: string;
    retrieval: string;
  };
}

export interface CopilotReview {
  author_name: string;
  author_url: string | null;
  rating: number;
  language: string | null;
  publish_time: string;
  text: string;
}

export interface CopilotReviewsResponse {
  facility_id: string;
  place_id: string | null;
  google_maps_uri: string | null;
  attribution: string;
  reviews: CopilotReview[];
  reason?: 'no_match' | 'api_error';
}
