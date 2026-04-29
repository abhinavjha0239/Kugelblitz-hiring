import api from './api';
import { AuthResponse } from '@/types';

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    return api.post('/auth/login', { email, password });
  },

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role?: string;
  }): Promise<AuthResponse> {
    return api.post('/auth/register', data);
  },

  async getProfile() {
    return api.get('/auth/profile');
  },
};
