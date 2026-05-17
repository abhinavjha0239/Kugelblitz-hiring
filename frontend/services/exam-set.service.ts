import api from './api';

export interface ExamSet {
  id: string;
  testId: string;
  name: string;
  code: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const examSetService = {
  list: (testId: string): Promise<ExamSet[]> => api.get(`/admin/tests/${testId}/sets`),
  create: (testId: string, payload: { name: string; code?: string; isActive?: boolean }): Promise<ExamSet> =>
    api.post(`/admin/tests/${testId}/sets`, payload),
  update: (setId: string, payload: { name?: string; code?: string; isActive?: boolean }): Promise<ExamSet> =>
    api.put(`/admin/sets/${setId}`, payload),
  remove: (setId: string): Promise<{ removed: boolean }> => api.delete(`/admin/sets/${setId}`),
};
