export interface DistrictPriority {
  state_name: string;
  state_key: string;
  district_name: string;
  district_key: string;
  facility_count: number;
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
    };
  };
  trust: {
    model: string;
    modelExecution: string;
    dataExecution: string;
    retrieval: string;
  };
}
