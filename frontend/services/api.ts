import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const axiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  headers: { 'Content-Type': 'application/json' },
  // Without an explicit timeout, axios waits forever — silently. Inside
  // a kiosk-mode browser (Safe Exam Browser) the candidate is then stuck
  // on a spinner with no way to recover. 30s is generous for any real
  // call (most return in <1s) and short enough that a stuck candidate
  // gets a visible error rather than an indefinite freeze.
  timeout: 30_000,
});

axiosInstance.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response.data?.data ?? response.data,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    const message = error.response?.data?.message || error.message || 'Something went wrong';
    const err = new Error(Array.isArray(message) ? message.join(', ') : message) as Error & {
      errors?: any;
      statusCode?: number;
    };
    err.errors = error.response?.data?.errors;
    err.statusCode = error.response?.status;
    return Promise.reject(err);
  },
);

type ApiClient = Omit<AxiosInstance, 'get' | 'post' | 'put' | 'patch' | 'delete'> & {
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
};

const api = axiosInstance as ApiClient;

export default api;
