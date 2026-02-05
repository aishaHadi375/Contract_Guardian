
export interface KeyTerms {
  payment_terms: string;
  contract_duration: string;
  termination_rights: string;
  liability_cap: string | null;
  ip_ownership: string;
  jurisdiction: string;
}

export interface RedFlag {
  id: string;
  severity: 'Critical' | 'High' | 'Medium';
  category: string;
  section: string;
  clause_text: string;
  plain_english: string;
  why_risky: string;
  financial_impact_example: string;
  suggested_alternative: string;
  negotiation_script: string;
  industry_standard: string;
}

export interface ClauseExplanation {
  section_title: string;
  original_text: string;
  plain_english: string;
  why_it_matters: string;
  risk_level: 'Low' | 'Medium' | 'High';
  negotiation_recommended: 'Yes' | 'No';
}

export interface ContractAnalysis {
  contract_type: string;
  overall_risk_score: number;
  risk_level: 'Low' | 'Medium' | 'High';
  summary: string;
  key_terms: KeyTerms;
  red_flags: RedFlag[];
  action_items: string[];
  clause_explanations?: ClauseExplanation[]; // Added to the JSON for cleaner parsing
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface RedactionResult {
  originalText: string;
  redactedText: string;
  mappings: Record<string, string>;
}

export interface AppState {
  isAnalyzing: boolean;
  contractText: string;
  fileName: string | null;
  analysis: ContractAnalysis | null;
  chatHistory: ChatMessage[];
  isListening: boolean;
  isSpeaking: boolean;
  error: string | null;
  activeRedFlagId: string | null;
  negotiationTracker: Record<string, 'Proposed' | 'Accepted' | 'Rejected' | 'Countered'>;
  language: 'en' | 'ur';
}
