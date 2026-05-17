import api from './api';

export interface UploadedImage {
  id: string;
  url: string;
  size: number;
  mimetype: string;
}

export const uploadsService = {
  async uploadImage(file: File): Promise<UploadedImage> {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/uploads/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  toAbsolute(url: string): string {
    if (/^https?:/i.test(url)) return url;
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const origin = base.replace(/\/api\/?$/, '');
    return origin + url;
  },
};
