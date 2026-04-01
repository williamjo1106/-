import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
    
    try {
      if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        const data = await pdf(buffer);
        return data.text || '';
      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || 
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/vnd.ms-powerpoint' ||
        mimeType === 'application/mspowerpoint' ||
        mimeType === 'application/powerpoint' ||
        mimeType === 'application/x-mspowerpoint' ||
        mimeType === 'application/vnd.ms-office' ||
        mimeType === 'application/msword' ||
        mimeType === 'application/x-msword' ||
        mimeType === 'application/vnd.ms-excel' ||
        mimeType === 'application/msexcel' ||
        mimeType === 'application/x-msexcel' ||
        fileName.toLowerCase().endsWith('.pptx') ||
        fileName.toLowerCase().endsWith('.docx') ||
        fileName.toLowerCase().endsWith('.ppt') ||
        fileName.toLowerCase().endsWith('.doc') ||
        fileName.toLowerCase().endsWith('.xls')
      ) {
        console.log(`Using officeparser for: ${fileName} (MIME: ${mimeType})`);
        
        // For legacy formats like .ppt and .doc, officeparser often works better with file paths
        // because it might use external tools like catdoc/antiword under the hood.
        const tempPath = path.join(os.tmpdir(), `office_${Date.now()}_${fileName}`);
        try {
          fs.writeFileSync(tempPath, buffer);
          return new Promise((resolve, reject) => {
            officeParser.parseOffice(tempPath, (data, err) => {
              // Cleanup temp file
              fs.unlink(tempPath, (unlinkErr) => {
                if (unlinkErr) console.warn(`Failed to delete temp file ${tempPath}:`, unlinkErr);
              });

              if (err) {
                console.error(`OfficeParser error for ${fileName}:`, err);
                reject(err);
              }
              else {
                console.log(`OfficeParser successfully extracted ${data?.length || 0} chars from ${fileName}`);
                resolve(data || '');
              }
            }, {
              outputErrorLog: true,
              setEncoding: "utf-8"
            });
          });
        } catch (err) {
          console.error(`Failed to handle temp file for ${fileName}:`, err);
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          return '';
        }
      } else if (mimeType === 'text/plain' || fileName.toLowerCase().endsWith('.txt')) {
        return buffer.toString('utf-8');
      }
    } catch (error) {
      console.error(`Error extracting text from ${fileName}:`, error);
      return '';
    }
    return '';
  }

  // API Routes
  app.post('/api/extract', async (req, res) => {
    console.log(`Received extraction request for: ${req.body?.fileName}`);
    try {
      const { fileData, fileName, mimeType } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: 'File data is required' });
      }

      const text = await extractText(fileData, fileName, mimeType);
      if (!text || !text.trim()) {
        console.warn(`No text extracted from: ${fileName}`);
        // For legacy formats, sometimes extraction fails but we can still try to analyze the file name or provide a generic message
        if (fileName.toLowerCase().endsWith('.ppt') || fileName.toLowerCase().endsWith('.doc')) {
          return res.status(400).json({ error: `파일(${fileName})에서 텍스트를 추출할 수 없습니다. .pptx 또는 .docx 형식으로 변환하여 업로드하시거나, 내용을 직접 복사해서 붙여넣어 주세요.` });
        }
        return res.status(400).json({ error: '텍스트를 추출할 수 없는 파일입니다.' });
      }

      console.log(`Successfully extracted ${text.length} characters from: ${fileName}`);
      res.json({ text });
    } catch (error) {
      console.error('Extraction Error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : '텍스트 추출 중 오류가 발생했습니다.' });
    }
  });

  // API 404 handler
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
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
