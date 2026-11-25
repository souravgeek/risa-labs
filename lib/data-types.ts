export type Season = "2025" | "2026";
export type ChannelGroup = "warm" | "cold";
export type Provenance = "source" | "simulated" | "assumption" | "user";
export interface Origin {
  origin?: string;
  provenance?: Provenance;
}
export interface EventRow extends Origin {
  event_name: string;
  history_start: string;
  history_end: string;
  event_starts_at: string;
  event_ends_at: string;
}
export interface TargetRow extends Origin {
  effective_at: string;
  qualified_brands_goal: number;
  confirmed_partnerships_goal: number;
  cash_goal_inr?: number;
  target_version?: string;
}
export interface BrandRow extends Origin {
  brand_id: string;
  brand_name: string;
  industry: string;
  owner_id: string;
  owner_name?: string;
  created_at: string;
}
export interface ContactRow extends Origin {
  contact_id: string;
  contact_name: string;
  job_title?: string;
  brand_id: string;
  created_at: string;
}
export interface CampaignRow extends Origin {
  sponsor_campaign_id: string;
  campaign_name: string;
  channel: string;
  owner_id: string;
  owner_name?: string;
  created_at: string;
  effective_at?: string;
  planned_start_at?: string;
  planned_end_at?: string;
  objective?: string;
  audience?: string;
  status?: string;
  budget_inr?: number | null;
  updated_at?: string;
}
export interface InteractionRow extends Origin {
  interaction_id: string;
  brand_id: string;
  occurred_at: string;
  event_type: string;
  outcome?: string;
  summary?: string;
  sponsor_campaign_id?: string;
  contact_id?: string;
  owner_id?: string;
  attempt_id?: string;
  channel?: string;
}
export interface QualificationRow extends Origin {
  history_id: string;
  brand_id: string;
  effective_at: string;
  qualification_status: string;
  reason?: string;
  sponsor_campaign_id?: string;
}
export interface OpportunityRow extends Origin {
  opportunity_id: string;
  opportunity_name: string;
  brand_id: string;
  sponsor_campaign_id?: string;
  primary_contact_id?: string;
  support_type: string;
  created_at: string;
}
export interface StageRow extends Origin {
  history_id: string;
  opportunity_id: string;
  brand_id: string;
  effective_at: string;
  stage: string;
  owner_id: string;
  owner_name?: string;
  proposed_value_inr: number;
  confirmed_value_inr: number;
  reason?: string;
}
export interface InvoiceRow extends Origin {
  invoice_id: string;
  opportunity_id: string;
  milestone: string;
  amount_inr: number;
  issued_at: string;
  due_at: string;
  expected_payment_at?: string;
  status?: string;
  effective_at?: string;
}
export interface PaymentRow extends Origin {
  payment_id: string;
  invoice_id: string;
  amount_inr: number;
  received_at: string;
  method?: string;
}
export interface ActivationRow extends Origin {
  activation_id: string;
  opportunity_id: string;
  brand_id: string;
  linked_at: string;
  attendee_campaign_name?: string;
  activation_note?: string;
}
export interface SourceData {
  event: EventRow[];
  targets: TargetRow[];
  brands: BrandRow[];
  sponsor_contacts: ContactRow[];
  sponsor_campaigns: CampaignRow[];
  sponsor_interactions: InteractionRow[];
  brand_qualification_history: QualificationRow[];
  opportunities: OpportunityRow[];
  opportunity_history: StageRow[];
  sponsor_activations: ActivationRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
}
export interface Filters {
  campaign?: string;
  channel?: string;
  owner?: string;
  industry?: string;
}
export interface MetricSettings {
  cashTarget: number;
  stalledDays: number;
  qualifiedDays: number;
  replyDays: number;
  meetingDays: number;
  invoiceDays: number;
  paymentLag: number;
  payRate: number;
  lateRate: number;
  firstMilestoneShare: number;
  depositPercent?: number;
  finalMilestoneDays: number;
  stopAttempts: number;
  positiveThreshold: number;
  scaleWinRate: number;
  scaleClosed: number;
}
export interface MetricInput {
  season?: Season;
  asOf: string;
  filters?: Filters;
  additions?: Partial<SourceData>;
  settings?: Partial<MetricSettings>;
}
export interface ScenarioInput {
  shiftCold?: number;
  partners?: number;
  introsPerPartner?: number;
  recover?: number;
  dealSizeChange?: number;
  discount?: number;
  uptake?: number;
  paymentLag?: number;
}
