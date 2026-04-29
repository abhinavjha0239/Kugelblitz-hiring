import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import { ConfigService } from '@nestjs/config';
import { ParsedPdfQuestion } from './pdf-upload.entity';

type LlmParsedQuestion = {
  text: string;
  options: string[];
  correct_option: number | null;
  module: 'aptitude' | 'critical' | 'psychometric' | string;
};

const PROMPT = `Extract all MCQ questions from the given text.

Rules:
- Each question must have:
  - text
  - 4 options
  - correct answer (if available, else null)
- Output strict JSON format:
[
  {
    "text": "string",
    "options": ["string", "string", "string", "string"],
    "correct_option": 0,
    "module": "aptitude | critical | psychometric"
  }
]
Do not hallucinate answers.
Do not skip questions.
Do not change wording.`;

@Injectable()
export class PdfParseService {
  private readonly logger = new Logger(PdfParseService.name);
  private readonly openai: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = key ? new OpenAI({ apiKey: key }) : null;
  }

  async extractText(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: fileBuffer });
    let textOutput = '';
    try {
      const data = await parser.getText();
      textOutput = (data.text || '').replace(/\r/g, '').trim();
    } catch (err) {
      this.logger.warn(`pdf-parse getText failed: ${(err as Error).message}`);
    }

    if (this.isLowSignal(textOutput)) {
      this.logger.log('Low-signal PDF text detected — falling back to OCR.');
      try {
        const ocrText = await this.ocrWithScreenshots(parser);
        if (ocrText && ocrText.trim().length > textOutput.length) {
          textOutput = ocrText.trim();
        }
      } catch (err) {
        this.logger.error(`OCR fallback failed: ${(err as Error).message}`);
      }
    }

    await parser.destroy();
    return textOutput;
  }

  private isLowSignal(text: string): boolean {
    if (!text) return true;
    const stripped = text.replace(/-- \d+ of \d+ --/g, '').replace(/\s+/g, ' ').trim();
    return stripped.length < 40;
  }

  private async ocrWithScreenshots(parser: PDFParse): Promise<string> {
    const screenshots = await parser.getScreenshot({
      scale: 2,
      imageBuffer: true,
      imageDataUrl: false,
    });

    if (!screenshots?.pages?.length) return '';

    const worker: TesseractWorker = await createWorker('eng');
    try {
      const pageTexts: string[] = [];
      for (const page of screenshots.pages) {
        if (!page.data) continue;
        const buffer = Buffer.from(page.data);
        const { data } = await worker.recognize(buffer);
        pageTexts.push(`-- ${page.pageNumber} of ${screenshots.total} --\n${data.text || ''}`);
      }
      return pageTexts.join('\n\n');
    } finally {
      await worker.terminate();
    }
  }

  async parseQuestions(extractedText: string): Promise<LlmParsedQuestion[]> {
    if (!this.openai) return this.parseWithRegex(extractedText);

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: extractedText.slice(0, 120_000) },
        ],
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw) as { questions?: LlmParsedQuestion[] } | LlmParsedQuestion[];
      const questions = Array.isArray(parsed) ? parsed : parsed.questions || [];
      if (!questions.length) return this.parseWithRegex(extractedText);
      return questions;
    } catch {
      return this.parseWithRegex(extractedText);
    }
  }

  validateAndNormalize(questions: LlmParsedQuestion[]): {
    normalized: ParsedPdfQuestion[];
    duplicatesRemoved: number;
  } {
    const dedupe = new Set<string>();
    const normalized: ParsedPdfQuestion[] = [];
    let duplicatesRemoved = 0;

    for (const q of questions) {
      const text = (q.text || '').trim();
      const options = (q.options || []).map((o) => (o || '').trim()).filter(Boolean);
      const issues: string[] = [];

      if (!text) issues.push('Question text is empty');
      if (options.length !== 4) issues.push('Question must have exactly 4 options');

      const signature = `${text.toLowerCase()}::${options.join('|').toLowerCase()}`;
      if (text && options.length === 4 && dedupe.has(signature)) {
        duplicatesRemoved += 1;
        continue;
      }
      if (text && options.length === 4) dedupe.add(signature);

      const correctedModule = this.normalizeModule(q.module || '', text, options.join(' '));
      const normalizedQuestion: ParsedPdfQuestion = {
        text,
        options: [
          options[0] || '',
          options[1] || '',
          options[2] || '',
          options[3] || '',
        ],
        correctOption:
          typeof q.correct_option === 'number' && q.correct_option >= 0 && q.correct_option <= 3
            ? q.correct_option
            : null,
        module: correctedModule,
        status: issues.length ? 'invalid' : 'valid',
        issues,
      };
      normalized.push(normalizedQuestion);
    }

    return { normalized, duplicatesRemoved };
  }

  private normalizeModule(module: string, text: string, optionsText: string): 'aptitude' | 'critical' | 'psychometric' {
    const normalized = (module || '').toLowerCase();
    if (normalized === 'aptitude' || normalized === 'critical' || normalized === 'psychometric') {
      return normalized;
    }
    const corpus = `${text} ${optionsText}`.toLowerCase();
    if (/\b(sql|database|db|query|join|transaction)\b/.test(corpus)) return 'critical';
    if (/\b(math|percent|probability|ratio|series|number|average|speed|time)\b/.test(corpus)) return 'aptitude';
    if (/\b(behavior|attitude|personality|team|ethic|emotion|psychometric)\b/.test(corpus)) return 'psychometric';
    if (/\b(logic|reasoning|puzzle)\b/.test(corpus)) return 'aptitude';
    return 'aptitude';
  }

  private parseWithRegex(extractedText: string): LlmParsedQuestion[] {
    const cleaned = extractedText
      .replace(/-- \d+ of \d+ --/g, '\n')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const questionStart = /^(?:Q(?:uestion)?\s*[:.\-]?\s*)?(\d{1,3})[\.\)\]\:\-]\s+(.+)$/i;
    const answerLine = /^(?:answer|ans)[\s:.\-]+([A-Da-d1-4])/i;

    const blocks: { headLine: string; lines: string[] }[] = [];
    let currentBlock: { headLine: string; lines: string[] } | null = null;

    for (const line of cleaned) {
      const qMatch = line.match(questionStart);
      if (qMatch) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { headLine: qMatch[2].trim(), lines: [] };
        continue;
      }
      if (currentBlock) currentBlock.lines.push(line);
    }
    if (currentBlock) blocks.push(currentBlock);

    const results: LlmParsedQuestion[] = [];

    for (const block of blocks) {
      const parsed = this.parseBlock(block.headLine, block.lines, answerLine);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  private parseBlock(
    headLine: string,
    bodyLines: string[],
    answerLine: RegExp,
  ): LlmParsedQuestion | null {
    let answer: number | null = null;
    const filtered = bodyLines.filter((line) => {
      const m = line.match(answerLine);
      if (m) {
        const idx = this.optionLetterToIndex(m[1]);
        if (idx !== null) answer = idx;
        return false;
      }
      return true;
    });

    type Hit = { line: number; col: number; idx: number };
    const hits: Hit[] = [];
    const optionRegex = this.optionMarkerRegex();

    for (let i = 0; i < filtered.length; i++) {
      const line = filtered[i];
      let lastIndex = 0;
      while (lastIndex < line.length) {
        optionRegex.lastIndex = lastIndex;
        const m = optionRegex.exec(line);
        if (!m) break;
        const letterIdx = this.markerToOptionIndex(m[1]);
        if (letterIdx === null) {
          lastIndex = m.index + m[0].length;
          continue;
        }
        if (m.index === 0 || /[\s\.\-]/.test(line[m.index - 1] || '')) {
          hits.push({ line: i, col: m.index, idx: letterIdx });
        }
        lastIndex = m.index + m[0].length;
      }
    }

    const ordered = this.pickOrderedABCD(hits);
    if (!ordered) return null;

    const slices: string[] = [];
    for (let k = 0; k < 4; k++) {
      const start = ordered[k];
      const end = ordered[k + 1];
      const text = this.collectBetween(filtered, start, end);
      slices.push(text);
    }

    const questionLineIndex = ordered[0].line;
    let questionText = headLine;
    for (let i = 0; i < questionLineIndex; i++) {
      questionText = `${questionText} ${filtered[i]}`.trim();
    }
    if (ordered[0].col > 0) {
      const prefixOnQuestionLine = filtered[questionLineIndex].slice(0, ordered[0].col).trim();
      if (prefixOnQuestionLine) questionText = `${questionText} ${prefixOnQuestionLine}`.trim();
    }

    return {
      text: questionText.trim(),
      options: slices.map((s) => s.trim()),
      correct_option: answer,
      module: 'aptitude',
    };
  }

  private collectBetween(
    lines: string[],
    start: { line: number; col: number; idx: number },
    end: { line: number; col: number; idx: number } | undefined,
  ): string {
    const startLine = start.line;
    const startCol = this.skipMarker(lines[startLine], start.col);
    const endLine = end ? end.line : lines.length - 1;
    const endCol = end ? end.col : lines[endLine]?.length ?? 0;

    if (startLine === endLine) {
      return (lines[startLine] || '').slice(startCol, endCol).trim();
    }
    const parts: string[] = [];
    parts.push((lines[startLine] || '').slice(startCol).trim());
    for (let i = startLine + 1; i < endLine; i++) {
      parts.push(lines[i].trim());
    }
    if (end) {
      parts.push((lines[endLine] || '').slice(0, endCol).trim());
    } else {
      parts.push((lines[endLine] || '').trim());
    }
    return parts.filter(Boolean).join(' ').trim();
  }

  private skipMarker(line: string, col: number): number {
    const optionRegex = this.optionMarkerRegex();
    optionRegex.lastIndex = col;
    const m = optionRegex.exec(line);
    if (m && m.index === col) {
      return col + m[0].length;
    }
    return col;
  }

  private pickOrderedABCD(
    hits: { line: number; col: number; idx: number }[],
  ): { line: number; col: number; idx: number }[] | null {
    const sorted = [...hits].sort((a, b) => (a.line - b.line) || (a.col - b.col));
    const ordered: { line: number; col: number; idx: number }[] = [];
    let expected = 0;
    for (const h of sorted) {
      if (h.idx === expected) {
        ordered.push(h);
        expected += 1;
        if (expected === 4) break;
      }
    }
    if (ordered.length === 4) return ordered;

    if (ordered.length === 3) {
      const missing = expected;
      const inferred = this.inferMissingOption(sorted, ordered, missing);
      if (inferred) {
        const filled = [...ordered];
        filled.splice(missing, 0, inferred);
        return filled;
      }
    }
    return null;
  }

  private inferMissingOption(
    sorted: { line: number; col: number; idx: number }[],
    ordered: { line: number; col: number; idx: number }[],
    missing: number,
  ): { line: number; col: number; idx: number } | null {
    if (missing === 3) {
      const last = ordered[ordered.length - 1];
      return { line: last.line + 1, col: 0, idx: 3 };
    }
    const before = ordered[missing - 1];
    const after = ordered[missing];
    if (!before || !after) return null;
    if (after.line > before.line + 1) {
      return { line: before.line + 1, col: 0, idx: missing };
    }
    return null;
  }

  private optionMarkerRegex(): RegExp {
    return /([A-Da-d©¢]|0|9)\s*[\)\.\]:\-]/g;
  }

  private markerToOptionIndex(letter: string): number | null {
    const c = letter.toUpperCase();
    if (c === 'A') return 0;
    if (c === 'B') return 1;
    if (c === 'C' || c === '©' || c === '¢' || c === '0') return 2;
    if (c === 'D' || c === '9') return 3;
    return null;
  }

  private optionLetterToIndex(letter: string): number | null {
    const c = letter.toUpperCase();
    if (c === 'A' || c === '1') return 0;
    if (c === 'B' || c === '2') return 1;
    if (c === 'C' || c === '3') return 2;
    if (c === 'D' || c === '4') return 3;
    return null;
  }
}
