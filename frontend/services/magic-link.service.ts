import api from './api';

export interface MagicLink {
  id: string;
  token: string;
  email: string;
  testId: string;
  userId: string | null;
  prefillFirstName: string | null;
  prefillLastName: string | null;
  prefillMobile: string | null;
  setId: string | null;
  validFrom: string;
  validUntil: string;
  usedAt: string | null;
  submittedAt: string | null;
  status: 'pending' | 'active' | 'submitted' | 'expired' | 'revoked';
  createdAt: string;
  updatedAt: string;
}

export interface InviteRow {
  email: string;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  setId?: string;
}

export interface BulkInviteResponse {
  created: MagicLink[];
  queued: number;
  queueName: string;
}

export interface MailQueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface MagicLoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    mobile: string | null;
    role: string;
  };
  testId: string;
  testTitle?: string;
  requireSafeExamBrowser?: boolean;
  profileComplete: boolean;
  // Locks this session to a single test on both client and server.
  // The frontend persists this onto the localStorage user object for
  // soft redirects from /student, /admin, /test/<other-id>.
  inviteScope?: { testId: string; lockedToTest: true };
}

export const magicLinkService = {
  bulkInvite: (testId: string, rows: InviteRow[]): Promise<BulkInviteResponse> =>
    api.post(`/admin/tests/${testId}/invites`, { rows }),

  mailQueueStats: (): Promise<MailQueueStats> => api.get('/admin/mail-queue/stats'),

  list: (testId: string): Promise<MagicLink[]> =>
    api.get(`/admin/tests/${testId}/invites`),

  resend: (inviteId: string): Promise<{ delivered: boolean }> =>
    api.post(`/admin/invites/${inviteId}/resend`),

  revoke: (inviteId: string): Promise<MagicLink> =>
    api.delete(`/admin/invites/${inviteId}`),

  magicLogin: (token: string): Promise<MagicLoginResponse> =>
    api.post(`/auth/magic/${token}`),

  completeProfile: (
    token: string,
    payload: { firstName: string; lastName: string; mobile?: string },
  ): Promise<{ user: any; profileComplete: true }> =>
    api.post(`/auth/magic/${token}/profile`, payload),
};
