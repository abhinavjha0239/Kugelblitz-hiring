import api from './api';

// In-flight request dedupe for idempotent start-* endpoints. StrictMode
// double-mounts and React 19 transition retries can fire the same call
// twice within milliseconds; without this they pile up on the backend lock
// and waste a round trip. Keyed by URL, cleared when the call settles.
const inflight = new Map<string, Promise<any>>();
function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export const testSessionService = {
  async startTest(testId: string) {
    return singleFlight(`startTest:${testId}`, () => api.post(`/test-session/start/${testId}`));
  },

  async getStatus(testId: string) {
    return api.get(`/test-session/status/${testId}`);
  },

  async saveMcqAnswer(testId: string, questionId: string, selectedOption: string) {
    return api.post('/test-session/mcq/save', { testId, questionId, selectedOption });
  },

  async submitMcqSection(testId: string) {
    return singleFlight(`submitMcq:${testId}`, () => api.post('/test-session/mcq/submit', { testId }));
  },

  async submitCoding(data: { testId: string; questionId: string; languageId: number; sourceCode: string }) {
    return api.post('/test-session/coding/submit', data);
  },

  async finalSubmit(testId: string, isAutoSubmit = false) {
    // Critical: tab-switch auto-submit + timer-tick auto-submit can fire
    // simultaneously, double-recording score and producing duplicate logs.
    // Single-flight collapses them.
    return singleFlight(`finalSubmit:${testId}`, () =>
      api.post('/test-session/final-submit', { testId, isAutoSubmit }),
    );
  },

  async getTimer(testId: string) {
    return api.get(`/test-session/timer/${testId}`);
  },

  async logAntiCheat(testId: string, type: 'tab_switch' | 'fullscreen_exit' | 'copy_paste') {
    return api.post('/test-session/anti-cheat', { testId, type });
  },

  async startExam(testId: string) {
    return singleFlight(`startExam:${testId}`, () => api.post(`/test-session/student/start-exam/${testId}`));
  },

  async startPaper(paperId: string) {
    return singleFlight(`startPaper:${paperId}`, () => api.post(`/test-session/student/start-paper/${paperId}`));
  },

  async submitPaper(paperId: string, answers: Record<string, string>) {
    // Backend DTO uses forbidNonWhitelisted — sending paperId in body
    // (already present in URL) trips the validator. Body carries only answers.
    return singleFlight(`submitPaper:${paperId}`, () =>
      api.post(`/test-session/student/submit-paper/${paperId}`, { answers }),
    );
  },

  async autosavePaperAnswers(paperId: string, answers: Record<string, string>) {
    return api.post(`/test-session/student/paper/${paperId}/autosave`, { answers });
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
