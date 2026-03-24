export type Decision = 'PASS' | 'FAIL' | 'PENDING';

export interface Criterion {
  id: string;
  text: string;
  isMandatory: boolean;
}

export interface EvaluationResult {
  id: string;
  fileName: string;
  aiDecision: Decision;
  userDecision?: Decision;
  reasoning: string;
  missingCriteria: string[];
  tableSummary: string;
  userReasoning?: string;
  proposerName?: string;
  teamName?: string;
  timestamp: number;
  fileData?: string; // Base64 or URL
  mimeType?: string;
}

export interface ReferenceExample {
  id: string;
  type: 'PASS' | 'FAIL';
  title: string;
  teamName?: string;
  proposerName?: string;
  content: string;
  reasoning: string;
}

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface EvaluationResponse {
  file_name: string;
  ai_decision: 'PASS' | 'FAIL';
  reasoning: string;
  missing_criteria: string[];
  table_summary: string;
  proposer_name?: string;
  team_name?: string;
}
