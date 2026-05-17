'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Users, AlertTriangle, Shield, Wifi, WifiOff, Clock, Activity, Eye, FileText, RotateCw,
} from 'lucide-react';
import { getMonitoringSocket, disconnectMonitoringSocket, MonitorAttendee } from '@/services/monitoring.socket';
import { testsService } from '@/services/tests.service';

export default function MonitorPage() {
  const { id: testId } = useParams<{ id: string }>();
  const [test, setTest] = useState<any>(null);
  const [attendees, setAttendees] = useState<MonitorAttendee[]>([]);
  const [connected, setConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<{ id: string; ts: number; text: string; severity: 'info' | 'warn' | 'danger' }[]>([]);
  const eventIdRef = useRef(0);

  // Auto-tick to refresh "X min ago" labels
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    testsService.getById(testId).then((t) => mounted && setTest(t)).catch(() => undefined);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;
    const sock = getMonitoringSocket(token);

    sock.on('connect', () => {
      setConnected(true);
      sock.emit('subscribe', { testId });
    });
    sock.on('disconnect', () => setConnected(false));
    sock.on('connect_error', (err: any) => {
      console.error('Monitoring socket error', err.message);
    });

    sock.on('snapshot', (data: { testId: string; attendees: MonitorAttendee[] }) => {
      if (data.testId !== testId) return;
      setAttendees(data.attendees);
    });

    sock.on('attendee.update', (data: { testId: string; attendee: MonitorAttendee }) => {
      if (data.testId !== testId) return;
      setAttendees((prev) => {
        const idx = prev.findIndex((a) => a.userId === data.attendee.userId);
        if (idx === -1) return [data.attendee, ...prev];
        const next = [...prev];
        next[idx] = data.attendee;
        return next;
      });
    });

    sock.on('attendee.question', (data: { testId: string; userId: string; currentQuestionIndex: number; totalQuestionsInPaper: number }) => {
      if (data.testId !== testId) return;
      setAttendees((prev) => prev.map((a) => a.userId === data.userId
        ? { ...a, currentQuestionIndex: data.currentQuestionIndex, totalQuestionsInPaper: data.totalQuestionsInPaper, lastEventAt: new Date().toISOString() }
        : a,
      ));
    });

    sock.on('attendee.violation', (data: { testId: string; userId: string; type: string; riskScore: number; at: string }) => {
      if (data.testId !== testId) return;
      const a = attendeeRefMap.current.get(data.userId);
      const name = a?.name || a?.email || 'Candidate';
      const severity: 'warn' | 'danger' = data.riskScore >= 30 ? 'danger' : 'warn';
      const text = `${name}: ${data.type.replace(/_/g, ' ')} · risk ${data.riskScore}`;
      const eid = `e${++eventIdRef.current}`;
      setRecentEvents((prev) => [{ id: eid, ts: Date.now(), text, severity }, ...prev].slice(0, 30));
      if (severity === 'danger') {
        toast.error(text, { duration: 6000 });
      } else {
        toast(text, { icon: '⚠️', duration: 4000 });
      }
    });

    sock.on('attendee.left', (data: { testId: string; userId: string }) => {
      if (data.testId !== testId) return;
      setAttendees((prev) => prev.filter((a) => a.userId !== data.userId));
      const eid = `e${++eventIdRef.current}`;
      setRecentEvents((prev) => [{ id: eid, ts: Date.now(), text: 'Candidate submitted & left', severity: 'info' as const }, ...prev].slice(0, 30));
    });

    return () => {
      mounted = false;
      sock.emit('unsubscribe', { testId });
      sock.off('connect'); sock.off('disconnect'); sock.off('connect_error');
      sock.off('snapshot'); sock.off('attendee.update'); sock.off('attendee.question');
      sock.off('attendee.violation'); sock.off('attendee.left');
      disconnectMonitoringSocket();
    };
  }, [testId]);

  const attendeeRefMap = useRef<Map<string, MonitorAttendee>>(new Map());
  useEffect(() => {
    attendeeRefMap.current = new Map(attendees.map((a) => [a.userId, a]));
  }, [attendees]);

  const stats = useMemo(() => {
    const totalRisk = attendees.reduce((s, a) => s + (a.riskScore || 0), 0);
    return {
      live: attendees.length,
      avgRisk: attendees.length > 0 ? Math.round(totalRisk / attendees.length) : 0,
      highRisk: attendees.filter((a) => a.riskScore >= 30).length,
    };
  }, [attendees]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      {/* ─── Header ────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-dark-500 uppercase tracking-wider">Live monitor</p>
          <h1 className="text-xl lg:text-2xl font-bold truncate">{test?.title || 'Loading…'}</h1>
        </div>
        <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${connected ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/40' : 'bg-rose-900/30 text-rose-300 border border-rose-700/40'}`}>
          {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {connected ? 'LIVE' : 'Disconnected'}
        </span>
      </div>

      {/* ─── Stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Stat icon={<Users className="w-5 h-5 text-emerald-400" />} bg="bg-emerald-500/10" label="Live attendees" value={stats.live} />
        <Stat icon={<Shield className="w-5 h-5 text-blue-400" />} bg="bg-blue-500/10" label="Avg risk score" value={stats.avgRisk} />
        <Stat icon={<AlertTriangle className="w-5 h-5 text-rose-400" />} bg="bg-rose-500/10" label="High-risk candidates" value={stats.highRisk} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* ─── Attendee grid ─────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Currently in the exam
          </h2>
          {attendees.length === 0 ? (
            <div className="card text-center py-12 border-dashed">
              <Users className="w-10 h-10 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400 text-sm">No candidates are currently taking this exam.</p>
              <p className="text-dark-500 text-xs mt-1">Cards will appear here in real-time when invitees start.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {attendees.map((a) => <AttendeeCard key={a.userId} a={a} />)}
            </div>
          )}
        </div>

        {/* ─── Activity feed ─────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <RotateCw className="w-4 h-4" /> Recent events
          </h2>
          <div className="card max-h-[600px] overflow-y-auto">
            {recentEvents.length === 0 ? (
              <p className="text-xs text-dark-500 text-center py-8">No events yet. Tab switches, fullscreen exits, copy/paste — all show up here in real time.</p>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((e) => (
                  <div key={e.id} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg ${
                    e.severity === 'danger' ? 'bg-rose-900/30 border border-rose-700/40' :
                    e.severity === 'warn' ? 'bg-amber-900/30 border border-amber-700/40' :
                    'bg-dark-800/40'
                  }`}>
                    <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${
                      e.severity === 'danger' ? 'bg-rose-400' : e.severity === 'warn' ? 'bg-amber-400' : 'bg-dark-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className={
                        e.severity === 'danger' ? 'text-rose-200' :
                        e.severity === 'warn' ? 'text-amber-200' : 'text-dark-300'
                      }>{e.text}</p>
                      <p className="text-[10px] text-dark-500 mt-0.5">{relTime(e.ts)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AttendeeCard({ a }: { a: MonitorAttendee }) {
  const elapsed = Math.floor((Date.now() - new Date(a.startedAt).getTime()) / 60_000);
  const lastEventMs = Date.now() - new Date(a.lastEventAt).getTime();
  const stale = lastEventMs > 60_000;
  const risk = a.riskScore || 0;
  const riskBand = risk >= 30 ? 'danger' : risk >= 15 ? 'warn' : 'ok';

  return (
    <div className={`card border ${
      riskBand === 'danger' ? 'border-rose-700/40 bg-rose-950/10 ring-1 ring-rose-500/20' :
      riskBand === 'warn' ? 'border-amber-700/40 bg-amber-950/10' :
      'border-dark-700'
    } transition-all`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-dark-100 truncate">{a.name}</p>
          <p className="text-xs text-dark-500 truncate">{a.email}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full ${
          riskBand === 'danger' ? 'bg-rose-500/20 text-rose-300' :
          riskBand === 'warn' ? 'bg-amber-500/20 text-amber-300' :
          'bg-emerald-500/20 text-emerald-300'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${riskBand === 'danger' ? 'bg-rose-400 animate-pulse' : riskBand === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          Risk {risk}
        </span>
      </div>

      {a.currentPaperName ? (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-1">In paper</p>
          <p className="text-sm text-dark-200 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-blue-400" /> {a.currentPaperName}
          </p>
          {a.totalQuestionsInPaper != null && a.currentQuestionIndex != null && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1.5 bg-dark-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500/70 rounded-full transition-all duration-300"
                  style={{ width: `${a.totalQuestionsInPaper > 0 ? (a.currentQuestionIndex / a.totalQuestionsInPaper) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-dark-300 font-mono shrink-0">
                {a.currentQuestionIndex}/{a.totalQuestionsInPaper}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-3 text-xs text-dark-500 italic flex items-center gap-1.5">
          <Eye className="w-3 h-3" /> Reading instructions
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Tabs" value={a.tabSwitchCount} />
        <Mini label="FS exits" value={a.fullscreenExitCount} />
        <Mini label="Copy/paste" value={a.copyPasteCount} />
      </div>

      <div className="flex items-center justify-between mt-3 text-[10px] text-dark-500">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {elapsed} min in exam</span>
        <span className={stale ? 'text-amber-400' : 'text-emerald-400'}>
          {stale ? 'idle' : 'active'} · {relTime(new Date(a.lastEventAt).getTime())}
        </span>
      </div>
    </div>
  );
}

function Stat({ icon, bg, label, value }: { icon: React.ReactNode; bg: string; label: string; value: number }) {
  return (
    <div className="card flex items-center gap-3">
      <div className={`p-3 ${bg} rounded-lg shrink-0`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-dark-400 uppercase tracking-wider mt-1.5">{label}</p>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-dark-800/40 rounded-lg py-1.5">
      <p className="text-sm font-mono font-bold leading-none">{value}</p>
      <p className="text-[9px] text-dark-500 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

function relTime(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)}h ago`;
}
