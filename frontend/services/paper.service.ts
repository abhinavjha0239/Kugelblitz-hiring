import api from './api';

export type CutoffType = 'percent' | 'marks' | 'none';
export type CutoffFailBehavior = 'end_exam' | 'lock_next' | 'none';

export interface PaperConfig {
  id: string;
  examId: string;
  name: string;
  order: number;
  totalQuestions: number;
  durationMinutes: number;
  passRequired: boolean;
  cutoffType: CutoffType;
  cutoffValue: number;
  cutoffFailBehavior: CutoffFailBehavior;
  totalMarks: number;
}

export const paperService = {
  async createPaper(data: {
    examId: string;
    name: string;
    order: number;
    totalQuestions: number;
    durationMinutes: number;
    passRequired?: boolean;
    cutoffType?: CutoffType;
    cutoffValue?: number;
    cutoffFailBehavior?: CutoffFailBehavior;
  }): Promise<PaperConfig> {
    return api.post('/admin/papers', data);
  },

  async listByExam(examId: string): Promise<PaperConfig[]> {
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
      cutoffType: CutoffType;
      cutoffValue: number;
      cutoffFailBehavior: CutoffFailBehavior;
    }>,
  ): Promise<PaperConfig> {
    return api.put(`/admin/papers/${paperId}`, data);
  },

  async deletePaper(paperId: string) {
    return api.delete(`/admin/papers/${paperId}`);
  },

  async setPaperQuestions(paperId: string, questionIds: string[]) {
    return api.put(`/admin/papers/${paperId}/questions`, { questionIds });
  },

  async getQuestionMapping(examId: string, setId?: string): Promise<{
    questions: { id: string; title: string; type: string; marks: number; orderIndex: number; paperId: string | null }[];
    papers: { id: string; name: string; order: number; totalMarks: number; mappedCount: number }[];
    setId: string;
  }> {
    return api.get(`/admin/papers/exam/${examId}/mapping`, { params: setId ? { setId } : undefined });
  },

  async addQuestionToPaper(paperId: string, questionId: string, setId?: string): Promise<{ added: boolean }> {
    return api.patch(`/admin/papers/${paperId}/questions/${questionId}`, undefined, { params: setId ? { setId } : undefined });
  },

  async removeQuestionFromPaper(paperId: string, questionId: string, setId?: string): Promise<{ removed: boolean }> {
    return api.delete(`/admin/papers/${paperId}/questions/${questionId}`, { params: setId ? { setId } : undefined });
  },

  async reorderPaperQuestions(paperId: string, questionIds: string[], setId?: string): Promise<{ reordered: number }> {
    return api.post(`/admin/papers/${paperId}/questions/reorder`, { questionIds }, { params: setId ? { setId } : undefined });
  },

  async bulkAddToPaper(paperId: string, questionIds: string[], setId?: string): Promise<{ added: number; skipped: number }> {
    return api.post(`/admin/papers/${paperId}/questions/bulk-add`, { questionIds }, { params: setId ? { setId } : undefined });
  },

  async autoAssignBySection(examId: string, setId?: string): Promise<{ assigned: Record<string, number> }> {
    return api.post(`/admin/papers/exam/${examId}/auto-assign-by-section`, undefined, { params: setId ? { setId } : undefined });
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
    return api.post(`/test-session/student/paper/${paperId}/autosave`, { answers });
  },

  async submitPaper(paperId: string, answers: Record<string, string>) {
    return api.post(`/test-session/student/submit-paper/${paperId}`, { answers });
  },
};

