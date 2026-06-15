export interface DistrictPriority {
  state_name: string;
  state_key: string;
  district_name: string;
  district_key: string;
  facility_count: number;
  child_anaemia_pct: number;
  child_underweight_pct: number;
  four_anc_visits_pct: number;
  health_insurance_pct: number;
  contains_caution_estimate: boolean;
  contains_suppressed_value: boolean;
  health_need_score: number;
}

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
    facilities: Array<Record<string, unknown>>;
    quality: Record<string, unknown>;
    sourcePeriod: string;
  };
  trust: {
    model: string;
    modelExecution: string;
    dataExecution: string;
    retrieval: string;
  };
}
