import api from './api';
import { Test } from '@/types';

export const testsService = {
  async getAll(page = 1, limit = 20): Promise<{ tests: Test[]; total: number }> {
    return api.get(`/tests?page=${page}&limit=${limit}`);
  },

  async getActive(): Promise<Test[]> {
    return api.get('/tests/active');
  },

  async getById(id: string): Promise<Test> {
    return api.get(`/tests/${id}`);
  },

  async create(data: Partial<Test>): Promise<Test> {
    return api.post('/tests', data);
  },

  async update(id: string, data: Partial<Test>): Promise<Test> {
    return api.put(`/tests/${id}`, data);
  },

  async delete(id: string): Promise<void> {
    return api.delete(`/tests/${id}`);
  },
};
