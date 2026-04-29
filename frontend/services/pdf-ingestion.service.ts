import api from './api';
import { ParsedPdfQuestion, PdfUploadPreview } from '@/types';

export const pdfIngestionService = {
  async uploadPdf(file: File): Promise<{ uploadId: string; status: string; progress: number }> {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/admin/questions/upload-pdf', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  async getUpload(uploadId: string): Promise<PdfUploadPreview> {
    return api.get(`/admin/questions/upload-pdf/${uploadId}`);
  },

  async confirmUpload(payload: {
    uploadId: string;
    testId: string;
    questions: Array<{
      text: string;
      options: [string, string, string, string];
      correctOption: number | null;
      module: 'aptitude' | 'critical' | 'psychometric';
    }>;
  }): Promise<{ inserted: number; testId: string }> {
    return api.post('/admin/questions/confirm-upload', payload);
  },

  normalizeQuestionForSave(q: ParsedPdfQuestion) {
    return {
      text: q.text,
      options: q.options,
      correctOption: q.correctOption,
      module: q.module,
    };
  },
};
