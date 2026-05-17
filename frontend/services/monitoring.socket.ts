import { io, Socket } from 'socket.io-client';

export interface MonitorAttendee {
  userId: string;
  email: string;
  name: string;
  participationId: string;
  status: string;
  setId: string | null;
  startedAt: string;
  riskScore: number;
  tabSwitchCount: number;
  fullscreenExitCount: number;
  copyPasteCount: number;
  totalScore: number;
  currentPaperId: string | null;
  currentPaperName: string | null;
  currentQuestionIndex: number | null;
  totalQuestionsInPaper: number | null;
  paperStartedAt: string | null;
  lastEventAt: string;
}

let socket: Socket | null = null;

export function getMonitoringSocket(token: string): Socket {
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  socket = io(`${origin}/monitoring`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
  });
  return socket;
}

export function disconnectMonitoringSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
