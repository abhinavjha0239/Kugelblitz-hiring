import api from './api';

export const paperService = {
  async createPaper(data: {
    examId: string;
    name: string;
    order: number;
    totalQuestions: number;
    durationMinutes: number;
    passRequired?: boolean;
  }) {
    return api.post('/admin/papers', data);
  },

  async listByExam(examId: string) {
    return api.get(`/admin/papers/exam/${examId}`);
  },

  async updatePaper(
    paperId: string,
    data: Partial<{
      name: string;
      order: number;
      totalQuestions: number;
      durationMinutes: number;
      passRequired: boolean;
    }>,
  ) {
    return api.put(`/admin/papers/${paperId}`, data);
  },

  async deletePaper(paperId: string) {
    return api.delete(`/admin/papers/${paperId}`);
  },

  async setPaperQuestions(paperId: string, questionIds: string[]) {
    return api.put(`/admin/papers/${paperId}/questions`, { questionIds });
  },

  async startExam(testId: string) {
    return api.post(`/test-session/student/start-exam/${testId}`);
  },

  async examStatus(testId: string) {
    return api.get(`/test-session/student/exam-status/${testId}`);
  },

  async startPaper(paperId: string) {
    return api.post(`/test-session/student/start-paper/${paperId}`);
  },

  async autosavePaper(paperId: string, answers: Record<string, string>) {
    return api.post(`/test-session/student/paper/${paperId}/autosave`, { paperId, answers });
  },

  async submitPaper(paperId: string, answers: Record<string, string>) {
    return api.post(`/test-session/student/submit-paper/${paperId}`, { paperId, answers });
  },
};

