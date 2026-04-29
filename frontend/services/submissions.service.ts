import api from './api';
import { Submission, RunCodeResult } from '@/types';

export const submissionsService = {
  async submit(data: {
    questionId: string;
    testId: string;
    languageId: number;
    sourceCode: string;
    isFinal?: boolean;
  }): Promise<Submission> {
    return api.post('/submissions', data);
  },

  async runCode(data: {
    languageId: number;
    sourceCode: string;
    stdin?: string;
  }): Promise<RunCodeResult> {
    return api.post('/submissions/run', data);
  },

  async getById(id: string): Promise<Submission> {
    return api.get(`/submissions/${id}`);
  },

  async getMyTestSubmissions(testId: string): Promise<Submission[]> {
    return api.get(`/submissions/user/test/${testId}`);
  },

  async getMyQuestionSubmissions(questionId: string): Promise<Submission[]> {
    return api.get(`/submissions/user/question/${questionId}`);
  },

  async getTestSubmissions(testId: string, page = 1): Promise<{ submissions: Submission[]; total: number }> {
    return api.get(`/submissions/test/${testId}/all?page=${page}`);
  },
};
