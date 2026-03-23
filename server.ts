import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const officeParser = require('officeparser');

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // AI Configuration
  const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const AI_API_KEY = process.env.AI_API_KEY;
  const AI_MODEL_ID = process.env.AI_MODEL_ID || 'gpt-4o';

  // Helper to extract text from file
  async function extractText(base64Data: string, fileName: string, mimeType: string): Promise<string> {
    const buffer = Buffer.from(base64Data, 'base64');
    
    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      const data = await pdf(buffer);
      return data.text;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || fileName.endsWith('.pptx')) {
      return new Promise((resolve, reject) => {
        officeParser.parseOffice(buffer, (data, err) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
    }
    return '';
  }

  // API Routes
  app.post('/api/evaluate', async (req, res) => {
    try {
      const { fileData, fileName, mimeType, criteria, examples, systemInstruction, config } = req.body;
      
      const AI_BASE_URL = config?.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
      const AI_API_KEY = config?.apiKey || process.env.AI_API_KEY;
      const AI_MODEL_ID = config?.modelId || process.env.AI_MODEL_ID || 'gpt-4o';

      if (!AI_API_KEY) {
        return res.status(400).json({ error: 'API Key is required' });
      }

      const fileText = await extractText(fileData, fileName, mimeType);
      
      const criteriaText = criteria
        .map((c: any) => `- [${c.isMandatory ? '필수' : '선택'}] ${c.text}`)
        .join('\n');

      const examplesText = examples.length > 0 
        ? `
        다음은 기존 합격/불합격 사례 데이터입니다. 이를 참조하여 판정의 일관성을 유지해 주세요:
        ${examples.map((ex: any) => `
        [${ex.type}] ${ex.title}
        - 내용 요약: ${ex.content}
        - 판정 근거: ${ex.reasoning}
        `).join('\n')}
        `
        : '';

      const userPrompt = `
        다음 과제 제안서 텍스트를 분석하여 평가해 주세요.
        
        파일명: ${fileName}
        
        제안서 내용:
        ${fileText.substring(0, 50000)} // Limit text length for safety
        
        평가 기준:
        ${criteriaText}
        
        ${examplesText}
        
        위 기준과 사례를 바탕으로 PASS 또는 FAIL을 판정하고, 반드시 다음 JSON 형식으로만 응답해 주세요. (마크다운 코드 블록 없이 순수 JSON만 출력)
        {
          "file_name": "${fileName}",
          "ai_decision": "PASS 또는 FAIL",
          "reasoning": "판정 근거 요약",
          "missing_criteria": ["누락된 필수 조건 목록"],
          "table_summary": "텍스트에서 추출된 핵심 수치 및 요약"
        }
      `;

      const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL_ID,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      });

      const data = await response.json();
      const content = data.choices[0].message.content;
      res.json(JSON.parse(content));
    } catch (error) {
      console.error('Evaluation Error:', error);
      res.status(500).json({ error: 'Evaluation failed' });
    }
  });

  app.post('/api/ingest', async (req, res) => {
    try {
      const { fileData, fileName, mimeType, type, config } = req.body;

      const AI_BASE_URL = config?.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
      const AI_API_KEY = config?.apiKey || process.env.AI_API_KEY;
      const AI_MODEL_ID = config?.modelId || process.env.AI_MODEL_ID || 'gpt-4o';

      if (!AI_API_KEY) {
        return res.status(400).json({ error: 'API Key is required' });
      }

      const fileText = await extractText(fileData, fileName, mimeType);

      const userPrompt = `
        이 텍스트는 기존의 [${type}] 사례입니다. 
        이 제안서의 핵심 내용을 요약하고, 왜 ${type === 'PASS' ? '합격' : '불합격'}했는지에 대한 논리적인 근거를 추출해 주세요.
        
        제안서 내용:
        ${fileText.substring(0, 30000)}
        
        응답은 반드시 다음 JSON 형식으로 해주세요:
        {
          "title": "제안서 제목 또는 요약 제목",
          "content": "제안서 핵심 내용 요약 (3-4문장)",
          "reasoning": "${type === 'PASS' ? '합격' : '불합격'} 근거 요약"
        }
      `;

      const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL_ID,
          messages: [
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      });

      const data = await response.json();
      const content = data.choices[0].message.content;
      res.json(JSON.parse(content));
    } catch (error) {
      console.error('Ingest Error:', error);
      res.status(500).json({ error: 'Ingest failed' });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { messages, config } = req.body;

      const AI_BASE_URL = config?.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
      const AI_API_KEY = config?.apiKey || process.env.AI_API_KEY;
      const AI_MODEL_ID = config?.modelId || process.env.AI_MODEL_ID || 'gpt-4o';

      if (!AI_API_KEY) {
        return res.status(400).json({ error: 'API Key is required' });
      }

      const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL_ID,
          messages: messages,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'AI 응답 중 오류가 발생했습니다.');
      }

      const data = await response.json();
      res.json(data.choices[0].message);
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal Server Error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
