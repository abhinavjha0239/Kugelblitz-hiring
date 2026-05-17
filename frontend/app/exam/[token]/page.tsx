'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { magicLinkService, MagicLoginResponse } from '@/services/magic-link.service';
import { Loader2, CheckCircle2, XCircle, Clock, CalendarX, Lock, Download, User, Phone, ArrowRight } from 'lucide-react';

type State =
  | { phase: 'loading' }
  | { phase: 'profile'; login: MagicLoginResponse }
  | { phase: 'starting'; testId: string }
  | { phase: 'not_started'; startsAt: string; endsAt?: string; serverTime: string; testTitle?: string }
  | { phase: 'window_closed'; endsAt: string; testTitle?: string }
  | { phase: 'seb_required'; testTitle: string; sebsLaunchUrl: string; sebHttpsUrl: string }
  | { phase: 'error'; message: string };

export default function ExamMagicLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [form, setForm] = useState({ firstName: '', lastName: '', mobile: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { void enter(); }, [token]);

  async function enter() {
    try {
      const login = await Promise.race([
        magicLinkService.magicLogin(token),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Network timeout — please check your internet and click Retry.')), 15000),
        ),
      ]);
      const existingUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
      if (existingUser?.role !== 'admin') {
        localStorage.setItem('token', login.accessToken);
        localStorage.setItem('user', JSON.stringify({
          id: login.user.id,
          email: login.user.email,
          firstName: login.user.firstName,
          lastName: login.user.lastName,
          role: login.user.role,
          // Lockdown marker: tells /student, /admin, and /test/<id>
          // layouts that this session can only access one specific test.
          // The hard gate is server-side (InviteScopeGuard). This is the
          // soft redirect so the candidate doesn't see broken pages.
          inviteScope: login.inviteScope,
        }));
      }
      if (login.requireSafeExamBrowser && !/SEB[\s\/]/i.test(navigator.userAgent)) {
        const httpsUrl = `${window.location.origin}/api/exam/${token}/seb-config`;
        setState({
          phase: 'seb_required',
          testTitle: login.testTitle || 'this exam',
          sebsLaunchUrl: httpsUrl.replace(/^https?:\/\//, 'sebs://'),
          sebHttpsUrl: httpsUrl,
        });
        return;
      }
      if (!login.profileComplete) {
        setForm({
          firstName: login.user.firstName ?? '',
          lastName: login.user.lastName ?? '',
          mobile: login.user.mobile ?? '',
        });
        setState({ phase: 'profile', login });
      } else {
        setState({ phase: 'starting', testId: login.testId });
        window.location.href = `/test/${login.testId}`;
      }
    } catch (e: any) {
      const code = e.errors?.code;
      if (code === 'NOT_STARTED') {
        setState({ phase: 'not_started', startsAt: e.errors.startsAt, endsAt: e.errors.endsAt, serverTime: e.errors.serverTime, testTitle: e.errors.testTitle });
      } else if (code === 'WINDOW_CLOSED') {
        setState({ phase: 'window_closed', endsAt: e.errors.endsAt, testTitle: e.errors.testTitle });
      } else {
        setState({ phase: 'error', message: e.message || 'Invalid link' });
      }
    }
  }

  async function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase !== 'profile') return;
    if (!form.firstName.trim() || !form.lastName.trim()) { toast.error('First and last name are required'); return; }
    setSubmitting(true);
    try {
      await magicLinkService.completeProfile(token, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        mobile: form.mobile.trim() || undefined,
      });
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      u.firstName = form.firstName.trim();
      u.lastName = form.lastName.trim();
      localStorage.setItem('user', JSON.stringify(u));
      const testId = state.login.testId;
      setState({ phase: 'starting', testId });
      window.location.href = `/test/${testId}`;
    } catch (e: any) {
      toast.error(e.message || 'Failed to save profile');
      setSubmitting(false);
    }
  }

  // ─── LOADING ──────────────────────────────────────────────────────────────
  if (state.phase === 'loading') {
    return (
      <Shell>
        <Loader2 className="animate-spin text-blue-400 mb-4" size={40} />
        <p className="text-slate-300 font-medium">Validating your invite…</p>
        <p className="text-slate-500 text-sm mt-1">Hang tight, this only takes a moment.</p>
      </Shell>
    );
  }

  // ─── STARTING ─────────────────────────────────────────────────────────────
  if (state.phase === 'starting') {
    return (
      <Shell>
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4">
          <CheckCircle2 className="text-emerald-400" size={32} />
        </div>
        <h2 className="text-xl font-semibold text-white mb-1">You&apos;re all set</h2>
        <p className="text-slate-400 text-sm mt-1">Starting your exam…</p>
        <div className="mt-5 w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <a href={`/test/${state.testId}`} className="mt-6 text-xs text-blue-400 hover:text-blue-300 underline">
          Click here if not redirected
        </a>
      </Shell>
    );
  }

  // ─── PROFILE FORM ─────────────────────────────────────────────────────────
  if (state.phase === 'profile') {
    const { login } = state;
    return (
      <Shell wide>
        <div className="w-full max-w-md">
          {/* Exam badge */}
          <div className="flex items-center gap-3 mb-7 p-4 rounded-2xl bg-blue-500/8 border border-blue-500/20">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
              <span className="text-lg font-bold text-white">G</span>
            </div>
            <div>
              <p className="text-xs text-blue-400 font-medium uppercase tracking-wider">Graviton Hiring</p>
              <p className="text-white font-semibold leading-tight mt-0.5">
                {login.testTitle || 'Assessment'}
              </p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-white mb-1">Complete your profile</h2>
          <p className="text-slate-400 text-sm mb-6">
            We need your details before starting. This is shared with the recruiter.
          </p>

          <form onSubmit={submitProfile} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">First name <span className="text-rose-400">*</span></label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    required
                    autoFocus
                    className="w-full bg-slate-800/40 border border-slate-700/40 rounded-xl pl-10 pr-3.5 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all text-sm"
                    placeholder="Rahul"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Last name <span className="text-rose-400">*</span></label>
                <input
                  required
                  className="w-full bg-slate-800/40 border border-slate-700/40 rounded-xl px-3.5 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all text-sm"
                  placeholder="Sharma"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Mobile <span className="text-slate-600">(optional)</span></label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="tel"
                  className="w-full bg-slate-800/40 border border-slate-700/40 rounded-xl pl-10 pr-3.5 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all text-sm"
                  placeholder="+91 98765 43210"
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 mt-2"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Start exam <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>

          <p className="text-center text-xs text-slate-600 mt-5">{login.user.email}</p>
        </div>
      </Shell>
    );
  }

  // ─── NOT STARTED ──────────────────────────────────────────────────────────
  if (state.phase === 'not_started') {
    return (
      <Shell>
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mb-4">
          <Clock className="text-amber-400" size={28} />
        </div>
        <h2 className="text-xl font-semibold text-white mb-1">{state.testTitle || 'Your exam'} hasn&apos;t started yet</h2>
        <p className="text-slate-400 text-sm text-center max-w-sm mt-1">
          Come back when the window opens — this page will refresh automatically.
        </p>
        <Countdown targetIso={state.startsAt} onElapsed={() => enter()} />
        <p className="text-xs text-slate-500 mt-4 text-center">
          Opens: {new Date(state.startsAt).toLocaleString()}
          {state.endsAt && <><br />Closes: {new Date(state.endsAt).toLocaleString()}</>}
        </p>
      </Shell>
    );
  }

  // ─── WINDOW CLOSED ────────────────────────────────────────────────────────
  if (state.phase === 'window_closed') {
    return (
      <Shell>
        <div className="w-14 h-14 rounded-2xl bg-rose-500/15 flex items-center justify-center mb-4">
          <CalendarX className="text-rose-400" size={28} />
        </div>
        <h2 className="text-xl font-semibold text-white mb-1">Exam window closed</h2>
        <p className="text-slate-400 text-sm text-center max-w-sm mt-1">
          The window for <strong className="text-slate-200">{state.testTitle || 'this exam'}</strong> closed at{' '}
          {new Date(state.endsAt).toLocaleString()}. Contact your recruiter if this is a mistake.
        </p>
      </Shell>
    );
  }

  // ─── SEB REQUIRED ─────────────────────────────────────────────────────────
  if (state.phase === 'seb_required') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid flex items-center justify-center p-6">
        <div className="glass-strong border border-amber-700/30 shadow-2xl rounded-3xl p-8 max-w-2xl w-full">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 flex items-center justify-center shrink-0">
              <Lock className="text-amber-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Safe Exam Browser required</h2>
              <p className="text-sm text-slate-400">{state.testTitle} runs in lockdown mode.</p>
            </div>
          </div>
          <p className="text-sm text-slate-300 mb-5 leading-relaxed">
            This exam runs inside <strong className="text-white">Safe Exam Browser</strong> — a free lockdown app that locks your screen, blocks other apps and screen sharing, and verifies every request with the server. You can&apos;t exit until you submit.
          </p>
          <div className="space-y-3 mb-6">
            <SebStep n={1} title="Quit conflicting apps" body="Close TeamViewer, AnyDesk, RDP, Zoom, Teams, OBS, screen recorders, VMs (VirtualBox / VMware / Parallels). SEB will refuse to start if they're running." />
            <SebStep n={2} title="Install Safe Exam Browser (free)" body={<>Windows / macOS download: <a className="text-blue-400 underline" href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer">safeexambrowser.org</a></>} />
            <SebStep n={3} title="Launch your exam" body="Click the button below — your browser hands the .seb config to Safe Exam Browser, which opens the exam fullscreen automatically." />
          </div>
          <a
            href={state.sebsLaunchUrl}
            className="inline-flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-6 py-3.5 rounded-xl transition-all text-base hover:scale-[1.01] active:scale-[0.99]"
          >
            <Download size={18} />
            Launch exam in Safe Exam Browser
          </a>
          <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col gap-1.5 items-center">
            <p className="text-xs text-slate-500">
              Button didn&apos;t open SEB?{' '}
              <a href={state.sebHttpsUrl} className="text-blue-400 underline">Download .seb manually</a> and double-click it.
            </p>
            <p className="text-xs text-slate-500">
              Already inside Safe Exam Browser?{' '}
              <button type="button" className="text-blue-400 underline" onClick={() => window.location.reload()}>Reload this page</button>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── ERROR ────────────────────────────────────────────────────────────────
  return (
    <Shell>
      <div className="w-14 h-14 rounded-2xl bg-rose-500/15 flex items-center justify-center mb-4">
        <XCircle className="text-rose-400" size={28} />
      </div>
      <h2 className="text-xl font-semibold text-white mb-1">This link can&apos;t be used</h2>
      <p className="text-slate-400 text-sm text-center max-w-sm mt-1">{state.message}</p>
      <button
        type="button"
        onClick={() => { setState({ phase: 'loading' }); void enter(); }}
        className="mt-5 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium text-sm transition-colors"
      >
        Retry
      </button>
      <p className="text-xs text-slate-600 mt-4 text-center">
        Already submitted? You can&apos;t retake. If your link expired, contact your recruiter.
      </p>
    </Shell>
  );
}

// ─── Shared layout shell ──────────────────────────────────────────────────────
function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid flex items-center justify-center p-6">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-500/8 rounded-full blur-[120px] pointer-events-none" />
      <div className={`glass-strong rounded-3xl p-8 shadow-2xl shadow-black/20 flex flex-col items-center text-center relative z-10 ${wide ? 'w-full max-w-lg items-start text-left' : 'max-w-md w-full'}`}>
        {children}
      </div>
    </div>
  );
}

function SebStep({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-sm font-bold">{n}</div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white mb-0.5">{title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function Countdown({ targetIso, onElapsed }: { targetIso: string; onElapsed: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const target = new Date(targetIso).getTime();
  const remaining = Math.max(0, target - now);

  useEffect(() => {
    if (remaining <= 0) { onElapsed(); return; }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [remaining, onElapsed]);

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="flex items-center gap-2 mt-5">
      {days > 0 && <Cell value={days} label="days" />}
      <Cell value={hours} label="hrs" />
      <Cell value={minutes} label="min" />
      <Cell value={seconds} label="sec" />
    </div>
  );
}

function Cell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center bg-slate-800/60 border border-slate-700/30 rounded-xl px-4 py-3 min-w-[64px]">
      <span className="text-2xl font-mono tabular-nums text-white leading-none">{String(value).padStart(2, '0')}</span>
      <span className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">{label}</span>
    </div>
  );
}
