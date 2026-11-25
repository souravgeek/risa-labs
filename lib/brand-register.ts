// Real brand names for the provided (fictional) 2025 dataset and the simulated live season.
// Only names change: every record, ID, value and date stays as provided. Methodology: scripts/map-brands.ts.
import register from "../data/real-brands.json";
import map from "../data/brand-map.json";

export type RealBrand = { name: string; industry: string; category: string; evidence: "unmaad_past" | "peer_fest" | "none"; evidenceNote: string; source: string; youth: number; bengaluru: number; liveOnly?: boolean };
export type MappedBrand = { name: string; original: string; industry: string; category: string; evidence: RealBrand["evidence"]; evidenceNote: string; source: string; score: number; position: string; rank: number };

export const REGISTER = register as RealBrand[];
export const BRAND_MAP = map as Record<string, MappedBrand>;
/** Evidence points: a past Unmaad sponsor 50, a past sponsor of a peer fest 35, nothing verified 0. */
export const EVIDENCE_POINTS = { unmaad_past: 50, peer_fest: 35, none: 0 } as const;
/** Relevance score out of 100 = evidence (0-50) + youth fit (10-30) + Bengaluru presence (5-20). */
export const relevance = (b: RealBrand) => EVIDENCE_POINTS[b.evidence] + b.youth + b.bengaluru;
/** Highest relevance first; ties broken by evidence, then youth fit, then name, so the order never changes between runs. */
export const byRelevance = (a: RealBrand, b: RealBrand) => relevance(b) - relevance(a) || EVIDENCE_POINTS[b.evidence] - EVIDENCE_POINTS[a.evidence] || b.youth - a.youth || a.name.localeCompare(b.name);
export const RANKED = [...REGISTER].sort(byRelevance);
export const registerEntry = (name: string) => REGISTER.find(b => b.name === name);
