import api from './api';
import { Question } from '@/types';

export const questionsService = {
  async getByTest(testId: string): Promise<Question[]> {
    return api.get(`/questions/test/${testId}`);
  },

  async getById(id: string): Promise<Question> {
    return api.get(`/questions/${id}`);
  },

  async create(data: any): Promise<Question> {
    return api.post('/questions', data);
  },

  async update(id: string, data: any): Promise<Question> {
    return api.put(`/questions/${id}`, data);
  },

  async delete(id: string): Promise<void> {
    return api.delete(`/questions/${id}`);
  },

  async addTestCase(questionId: string, data: any): Promise<any> {
    return api.post(`/questions/${questionId}/test-cases`, data);
  },

  async removeTestCase(testCaseId: string): Promise<void> {
    return api.delete(`/questions/test-cases/${testCaseId}`);
  },
};
