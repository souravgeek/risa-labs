export const DISCLOSURE = "Hi, I'm an AI assistant calling from the Unmaad partnerships team.";
export const MAX_CALL_MS = 5 * 60 * 1000;
export const VOICE_TOOLS = ['get_package_options', 'log_payment_promise', 'schedule_follow_up', 'mark_opt_out', 'end_call'] as const;
export type VoiceTool = typeof VOICE_TOOLS[number];
export type CallPurpose = 'payment reminder' | 'stalled deal' | 'inbound lead';
export interface CallBrief {
  brand: string;
  purpose: CallPurpose;
  facts?: Record<string, string | number>;
  packages?: { name: string; price: number }[];
  discountCeiling?: number;
  asOf?: string;
  /** The real date the call happens on (IST). The agent treats this as today; facts are records as of `asOf`. */
  callDate?: string;
}
/** Today's date in India, as YYYY-MM-DD. */
export const istToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export interface Utterance { speaker: 'agent' | 'sponsor'; text: string }
export type Transcript = Utterance[];
export interface VoiceCredentials { token: string; model: string; expiresAt: string }
export const insightKeys = ['outcome', 'interest', 'budgetMin', 'budgetMax', 'decisionMaker', 'objections', 'nextStep', 'nextStepDate', 'paymentDate', 'paymentAmount', 'optOut', 'confidence'] as const;
export type InsightKey = typeof insightKeys[number];
export type InsightValue = string | string[] | number | boolean | null;
export interface InsightField { value: InsightValue; quote: string }
export interface CallAnalysis {
  fields: Record<InsightKey, InsightField>;
  disclosurePresent: boolean;
  mode: 'gemini' | 'fixture';
}
export function hasDisclosure(transcript: Transcript) {
  const normal = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const opening: string[] = [];
  for (const turn of transcript) {
    if (turn.speaker !== 'agent') break;
    opening.push(turn.text);
  }
  return normal(opening.join(' ')).startsWith(normal(DISCLOSURE));
}
