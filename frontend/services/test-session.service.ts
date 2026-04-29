import api from './api';

export const testSessionService = {
  async startTest(testId: string) {
    return api.post(`/test-session/start/${testId}`);
  },

  async getStatus(testId: string) {
    return api.get(`/test-session/status/${testId}`);
  },

  async saveMcqAnswer(testId: string, questionId: string, selectedOption: string) {
    return api.post('/test-session/mcq/save', { testId, questionId, selectedOption });
  },

  async submitMcqSection(testId: string) {
    return api.post('/test-session/mcq/submit', { testId });
  },

  async submitCoding(data: { testId: string; questionId: string; languageId: number; sourceCode: string }) {
    return api.post('/test-session/coding/submit', data);
  },

  async finalSubmit(testId: string, isAutoSubmit = false) {
    return api.post('/test-session/final-submit', { testId, isAutoSubmit });
  },

  async getTimer(testId: string) {
    return api.get(`/test-session/timer/${testId}`);
  },

  async logAntiCheat(testId: string, type: 'tab_switch' | 'fullscreen_exit' | 'copy_paste') {
    return api.post('/test-session/anti-cheat', { testId, type });
  },

  async startExam(testId: string) {
    return api.post(`/test-session/student/start-exam/${testId}`);
  },

  async startPaper(paperId: string) {
    return api.post(`/test-session/student/start-paper/${paperId}`);
  },

  async submitPaper(paperId: string, answers: Record<string, string>) {
    return api.post(`/test-session/student/submit-paper/${paperId}`, { paperId, answers });
  },

  async autosavePaperAnswers(paperId: string, answers: Record<string, string>) {
    return api.post(`/test-session/student/paper/${paperId}/autosave`, { paperId, answers });
  },

  async getExamStatus(testId: string) {
    return api.get(`/test-session/student/exam-status/${testId}`);
  },

  async getAdminResults(testId: string) {
    return api.get(`/test-session/admin/results/${testId}`);
  },

  async getAdminViolations(testId: string) {
    return api.get(`/test-session/admin/violations/${testId}`);
  },

  async getAdminActiveUsers(testId: string) {
    return api.get(`/test-session/admin/active-users/${testId}`);
  },
};
