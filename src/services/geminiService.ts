import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { Criterion, EvaluationResponse, ReferenceExample, AIConfig, EvaluationResult } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";
import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

// Helper to extract text via backend (Fallback)
async function extractTextViaBackend(fileData: string, fileName: string, mimeType: string): Promise<string> {
  console.log(`Extracting text from ${fileName} (${mimeType}) via backend...`);
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileData, fileName, mimeType })
  });
  
  if (!response.ok) {
    let errorMessage = '텍스트 추출 실패';
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const err = await response.json();
      errorMessage = err.error || errorMessage;
    } else {
      const text = await response.text();
      console.error('Server returned non-JSON error:', text);
      if (text.includes('파일 업로드 차단') || response.status === 403) {
        errorMessage = "사내 보안 시스템(DLP)에 의해 파일 업로드가 차단되었습니다. 텍스트를 직접 복사해서 붙여넣어 주세요.";
      } else {
        errorMessage = `서버 오류 (${response.status}): ${text.substring(0, 100)}`;
      }
    }
    throw new Error(errorMessage);
  }
  
  const data = await response.json();
  return data.text;
}

// Main extraction entry point
export interface ExtractedData {
  text: string;
  images: { data: string; mimeType: string }[];
}

// Client-side PPTX/DOCX extraction
async function extractOfficeText(file: File): Promise<ExtractedData> {
  const zip = await JSZip.loadAsync(file);
  let fullText = "";
  let images: { data: string; mimeType: string }[] = [];

  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".pptx")) {
    // PPTX: Read only the first slide for performance
    const slideFiles = Object.keys(zip.files).filter(name => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"));
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)![0]);
      const numB = parseInt(b.match(/\d+/)![0]);
      return numA - numB;
    });

    // Only take the first slide
    const firstSlide = slideFiles[0];
    if (firstSlide) {
      const content = await zip.file(firstSlide)?.async("string");
      if (content) {
        fullText += `\n[슬라이드 1]\n`;
        const matches = content.match(/<a:t>([^<]*)<\/a:t>/g);
        if (matches) {
          fullText += matches.map(m => m.replace(/<a:t>|<\/a:t>/g, "")).join(" ") + "\n";
        }
      }
    }

    // Extract images from ppt/media/
    const mediaFiles = Object.keys(zip.files).filter(name => name.startsWith("ppt/media/"));
    // Limit to top 10 images to avoid token limits
    for (const mediaPath of mediaFiles.slice(0, 10)) {
      const ext = mediaPath.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      if (['png', 'jpg', 'jpeg'].includes(ext || '')) {
        const base64 = await zip.file(mediaPath)?.async("base64");
        if (base64) {
          images.push({ data: base64, mimeType });
        }
      }
    }
  } else if (fileName.endsWith(".docx")) {
    const content = await zip.file("word/document.xml")?.async("string");
    if (content) {
      const matches = content.match(/<w:t>([^<]*)<\/w:t>/g);
      if (matches) {
        fullText = matches.map(m => m.replace(/<w:t>|<\/w:t>/g, "")).join(" ");
      }
    }
  }
  
  return { text: fullText.trim(), images };
}

// Client-side PDF extraction
async function extractPdfText(file: File): Promise<ExtractedData> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  let images: { data: string; mimeType: string }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    
    // Extract text
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += `\n[페이지 ${i}]\n${pageText}\n`;

    // Render page as image for visual analysis (limit to first 5 pages for performance)
    if (i <= 5) {
      try {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          images.push({ data: base64, mimeType: 'image/jpeg' });
        }
      } catch (renderError) {
        console.warn(`Page ${i} rendering failed:`, renderError);
      }
    }
  }

  return { text: fullText.trim(), images };
}

// Main extraction entry point
export async function extractText(file: File): Promise<ExtractedData> {
  try {
    const fileName = file.name.toLowerCase();
    console.log(`Attempting client-side extraction for: ${file.name}`);
    
    if (fileName.endsWith(".pptx") || fileName.endsWith(".docx")) {
      const data = await extractOfficeText(file);
      if (data.text || data.images.length > 0) return data;
    } else if (fileName.endsWith(".pdf") || file.type === "application/pdf") {
      const data = await extractPdfText(file);
      if (data.text) return data;
    } else if (file.type === "text/plain" || fileName.endsWith(".txt")) {
      return { text: await file.text(), images: [] };
    }
    
    console.log("Client-side extraction failed or unsupported, falling back to backend...");
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const text = await extractTextViaBackend(base64, file.name, file.type);
          resolve({ text, images: [] });
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error("파일 읽기 실패"));
      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error("Extraction error:", error);
    throw error;
  }
}

export async function evaluateProposal(
  file: File,
  criteria: Criterion[],
  examples: ReferenceExample[] = [],
  config: AIConfig
): Promise<EvaluationResponse> {
  const { text: fileText, images } = await extractText(file);
  
  const criteriaText = criteria
    .map((c: any) => `- [${c.isMandatory ? '필수' : '선택'}] ${c.text}`)
    .join('\n');

  const examplesText = examples.length > 0 
    ? `
    ### 기존 참조 사례 (Reference Library)
    다음은 기존에 등록된 합격/불합격 사례들입니다. 
    **중요**: 현재 분석 중인 제안서가 아래 사례들 중 하나와 내용이 매우 유사하거나 동일한지(중복 과제 여부)를 반드시 가장 먼저 확인하세요.
    
    ${examples.map((ex: any) => `
    - [사례 ID: ${ex.id}] [${ex.type}] 제목: ${ex.title}
      * 내용 요약: ${ex.content}
      * 기존 판정 근거: ${ex.reasoning}
    `).join('\n')}
    `
    : '';

  const prompt = `
    다음 과제 제안서의 텍스트와 이미지를 분석하여 평가해 주세요.
    이미지 내에 포함된 도표, 그래프, 텍스트 상자 등의 정보도 함께 고려하여 평가해 주세요.
    
    파일명: ${file.name}
    
    제안서 텍스트 내용:
    ${fileText.substring(0, 30000)}
    
    평가 기준:
    ${criteriaText}
    
    ${examplesText}
    
    ### 지시 사항
    1. **중복 검토**: 현재 제안서가 위 '기존 참조 사례'에 있는 내용과 ${config.similarityThreshold}% 이상 유사하거나 동일한지 확인하세요. **만약 ${config.similarityThreshold}% 이상 중복된다면, 중복 과제임을 사유로 'ai_decision'을 반드시 FAIL로 판정하세요.** 'reasoning' 필드에는 "기존 사례([사례 제목])와 중복되는 과제입니다."라는 문구를 반드시 포함해야 합니다.
    2. **유사도 점수**: 기존 사례 중 가장 유사한 사례와의 유사도를 0에서 100 사이의 숫자로 'similarity_score' 필드에 기재하세요. (${config.similarityThreshold}% 이상인 경우 특히 주의 깊게 확인)
    3. **유사 사례 ID**: 가장 유사한 사례의 '사례 ID'를 'similar_case_id' 필드에 기재하세요. (유사도가 낮은 경우에도 가장 가까운 사례를 기재)
    4. **기준 평가**: 설정된 '평가 기준'에 따라 제안서를 분석하세요.
    5. **제안자 및 팀 식별**: 제안서의 **우측 상단(보통 제안일 바로 아래)**에 기재된 **제안자 이름**과 **팀/부서 이름**(예: "전략기획팀", "인사task", "홍길동")을 각각 찾아 'proposer_name'과 'team_name' 필드에 넣어주세요. 팀 이름은 "~~팀" 뿐만 아니라 "~~task", "~~부" 등 다양한 부서 명칭을 포함할 수 있습니다. 찾을 수 없다면 비워두세요.
    6. **응답 형식**: 반드시 다음 JSON 형식으로만 응답해 주세요.
  `;

  if (config.baseUrl) {
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true
    });

    const response = await openai.chat.completions.create({
      model: config.modelId || "qwen-max",
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { 
          role: "user", 
          content: [
            { type: "text" as const, text: prompt },
            ...images.map(img => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mimeType};base64,${img.data}` }
            }))
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey || (process.env.GEMINI_API_KEY as string) });
  const parts: any[] = [{ text: prompt }];
  
  // Add images to parts
  images.forEach(img => {
    parts.push({
      inlineData: {
        data: img.data,
        mimeType: img.mimeType
      }
    });
  });

  const response = await ai.models.generateContent({
    model: config.modelId || "gemini-3-flash-preview",
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          file_name: { type: Type.STRING },
          ai_decision: { type: Type.STRING, description: "PASS 또는 FAIL" },
          reasoning: { type: Type.STRING },
          missing_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
          table_summary: { type: Type.STRING },
          proposer_name: { type: Type.STRING, description: "제안자 이름 (예: 홍길동)" },
          team_name: { type: Type.STRING, description: "팀 이름 (예: 전략기획팀)" },
          similarity_score: { type: Type.NUMBER, description: "가장 유사한 기존 사례와의 유사도 (0-100)" },
          similar_case_id: { type: Type.STRING, description: "가장 유사한 기존 사례의 ID" }
        },
        required: ["file_name", "ai_decision", "reasoning", "missing_criteria", "table_summary", "proposer_name", "team_name", "similarity_score", "similar_case_id"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function ingestReferenceFile(
  file: File,
  type: 'PASS' | 'FAIL',
  config: AIConfig
): Promise<{ title: string; content: string; reasoning: string }> {
  const { text: fileText, images } = await extractText(file);
  
  const prompt = `
    이 텍스트와 이미지는 기존의 [${type}] 사례입니다. 
    이 제안서의 핵심 내용을 상세히 요약하고, 특히 다른 제안서와 중복 여부를 판단할 수 있도록 고유한 특징, 기술적 방법론, 추진 단계 등을 구체적으로 포함해 주세요.
    왜 ${type === 'PASS' ? '합격' : '불합격'}했는지에 대한 논리적인 근거도 함께 추출해 주세요.
    이미지 내의 도표나 텍스트 정보도 함께 요약에 포함해 주세요.
    
    제안서 텍스트 내용:
    ${fileText.substring(0, 30000)}
    
    반드시 다음 JSON 형식으로 응답해 주세요:
    {
      "title": "제안서 제목",
      "content": "상세 요약 내용",
      "reasoning": "합격/불합격 근거"
    }
  `;

  if (config.baseUrl) {
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true
    });

    const response = await openai.chat.completions.create({
      model: config.modelId || "qwen-max",
      messages: [
        { role: "system", content: "당신은 제안서 분석 전문가입니다." },
        { 
          role: "user", 
          content: [
            { type: "text" as const, text: prompt },
            ...images.map(img => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mimeType};base64,${img.data}` }
            }))
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey || (process.env.GEMINI_API_KEY as string) });
  
  const parts: any[] = [{ text: prompt }];
  images.forEach(img => {
    parts.push({
      inlineData: {
        data: img.data,
        mimeType: img.mimeType
      }
    });
  });

  const response = await ai.models.generateContent({
    model: config.modelId || "gemini-3-flash-preview",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          reasoning: { type: Type.STRING }
        },
        required: ["title", "content", "reasoning"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function chatWithAI(
  messages: { role: 'user' | 'assistant'; content: string }[],
  config: AIConfig,
  evaluations: EvaluationResult[] = [],
  examples: ReferenceExample[] = []
): Promise<{ role: 'assistant'; content: string }> {
  const evaluationsContext = evaluations.length > 0 
    ? `
    현재 검토된 제안서 이력 (${evaluations.length}건):
    ${evaluations.map(ev => `
    - 파일명: ${ev.fileName}
      * 제안자: ${ev.proposerName || '미인식'}
      * 판정: ${ev.userDecision || ev.aiDecision}
      * 요약: ${ev.reasoning.substring(0, 200)}...
    `).join('\n')}
    `
    : '현재 검토된 제안서 이력이 없습니다.';

  const examplesContext = examples.length > 0
    ? `
    참조 라이브러리 (Reference Library) 데이터 (${examples.length}건):
    ${examples.map(ex => `
    - [${ex.type}] 제목: ${ex.title}
      * 내용 요약: ${ex.content.substring(0, 200)}...
      * 판정 근거: ${ex.reasoning.substring(0, 200)}...
    `).join('\n')}
    `
    : '참조 라이브러리에 등록된 데이터가 없습니다.';

  const systemInstruction = `
    당신은 과제 제안서 검토 시스템 'Lead Reviewer'의 AI 어시스턴트입니다.
    
    ${evaluationsContext}
    
    ${examplesContext}
    
    ### 답변 원칙
    1. **간결성 최우선**: 불필요한 인사말(안녕하세요 등)이나 맺음말은 생략하고, 사용자가 묻는 핵심 내용에 대해 즉시 답변하세요.
    2. **수치 중심**: 통계나 현황 질문에는 "총 X건 중 Y건이 Fail(Z%)입니다"와 같이 수치 위주로 명확하게 답변하세요.
    3. **직설적 분석**: 제안서 분석 요청 시에도 장황한 설명보다는 핵심 사유와 개선점만 요약하여 전달하세요.
    4. **전문성 유지**: 간결하되 전문적인 용어를 사용하며, 데이터에 기반한 정확한 정보를 제공하세요.
  `;

  if (config.baseUrl) {
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true
    });

    const response = await openai.chat.completions.create({
      model: config.modelId || "qwen-max",
      messages: [
        { role: "system", content: systemInstruction },
        ...messages.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        }))
      ]
    });

    return { role: 'assistant', content: response.choices[0].message.content || "" };
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey || (process.env.GEMINI_API_KEY as string) });
  
  const chat = ai.chats.create({
    model: config.modelId || "gemini-3-flash-preview",
    config: {
      systemInstruction
    }
  });

  // Convert messages to Gemini format (excluding the last one which we send)
  const history = messages.slice(0, -1).map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));
  
  const response = await ai.models.generateContent({
    model: config.modelId || "gemini-3-flash-preview",
    contents: [
      ...history.map(h => ({ role: h.role, parts: h.parts })),
      { role: 'user', parts: [{ text: messages[messages.length - 1].content }] }
    ],
    config: {
      systemInstruction
    }
  });

  return { role: 'assistant', content: response.text || "" };
}
