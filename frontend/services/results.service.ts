import api from './api';
import { TestParticipation, LeaderboardEntry } from '@/types';

export const resultsService = {
  async startTest(testId: string): Promise<TestParticipation> {
    return api.post(`/results/start/${testId}`);
  },

  async submitTest(testId: string): Promise<TestParticipation> {
    return api.post(`/results/submit/${testId}`);
  },

  async reportAntiCheat(testId: string, type: 'tab_switch' | 'fullscreen_exit'): Promise<void> {
    return api.post(`/results/anti-cheat/${testId}`, { type });
  },

  async getParticipation(testId: string): Promise<TestParticipation | null> {
    return api.get(`/results/participation/${testId}`);
  },

  async getMonitor(testId: string): Promise<any> {
    return api.get(`/results/monitor/${testId}`);
  },

  async getLeaderboard(testId: string): Promise<LeaderboardEntry[]> {
    return api.get(`/results/leaderboard/${testId}`);
  },

  async getDetailedResult(testId: string): Promise<any> {
    return api.get(`/results/detailed/${testId}`);
  },

  async getStudentResult(testId: string, userId: string): Promise<any> {
    return api.get(`/results/detailed/${testId}/user/${userId}`);
  },
};
