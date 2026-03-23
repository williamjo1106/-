import { Criterion, EvaluationResponse, ReferenceExample, AIConfig } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";

export async function evaluateProposal(
  fileData: string,
  fileName: string,
  mimeType: string,
  criteria: Criterion[],
  examples: ReferenceExample[] = [],
  config: AIConfig
): Promise<EvaluationResponse> {
  const response = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileData,
      fileName,
      mimeType,
      criteria,
      examples,
      systemInstruction: SYSTEM_INSTRUCTION,
      config
    })
  });

  if (!response.ok) {
    throw new Error("평가 요청 중 오류가 발생했습니다.");
  }

  return response.json();
}

export async function ingestReferenceFile(
  fileData: string,
  fileName: string,
  mimeType: string,
  type: 'PASS' | 'FAIL',
  config: AIConfig
): Promise<{ title: string; content: string; reasoning: string }> {
  const response = await fetch('/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileData,
      fileName,
      mimeType,
      type,
      config
    })
  });

  if (!response.ok) {
    throw new Error("사례 분석 중 오류가 발생했습니다.");
  }

  return response.json();
}
