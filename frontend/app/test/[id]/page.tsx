'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { testSessionService } from '@/services/test-session.service';
import { testsService } from '@/services/tests.service';
import { submissionsService } from '@/services/submissions.service';
import { useAuth } from '@/hooks/useAuth';
import { Question, Submission, LANGUAGES } from '@/types';
import CodeEditor from '@/components/test/CodeEditor';
import QuestionPanel from '@/components/test/QuestionPanel';
import OutputPanel from '@/components/test/OutputPanel';
import {
  Clock, Send, Play, ChevronLeft, ChevronRight,
  Maximize, Lock, Unlock, CheckCircle,
  ListChecks, Code, AlertTriangle, ArrowRight,
  Shield, Zap, Save, RotateCcw, Keyboard,
} from 'lucide-react';

type Section = 'mcq' | 'coding';
const MAX_TAB_SWITCHES = 3;
const TAB_RETURN_TIMEOUT = 10;

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'primary' | 'danger';
  onConfirm: () => void;
}

export default function TestPage() {
  const { id: testId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loadFromStorage } = useAuth();

  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, title: '', message: '', confirmLabel: 'Confirm', variant: 'primary', onConfirm: () => {},
  });
  const askConfirm = (cfg: Omit<ConfirmState, 'open'>) => setConfirmState({ ...cfg, open: true });
  const closeConfirm = () => setConfirmState((s) => ({ ...s, open: false }));

  const [session, setSession] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [mcqQuestions, setMcqQuestions] = useState<Question[]>([]);
  const [codingQuestions, setCodingQuestions] = useState<Question[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('mcq');
  const [mcqSubmitted, setMcqSubmitted] = useState(false);
  const [codingUnlocked, setCodingUnlocked] = useState(false);
  const [mcqResult, setMcqResult] = useState<any>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({});
  const [code, setCode] = useState<Record<string, string>>({});
  const [langId, setLangId] = useState<Record<string, number>>({});
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [output, setOutput] = useState('');
  const [outputTab, setOutputTab] = useState<'output' | 'results'>('output');
  const [customInput, setCustomInput] = useState('');
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  // Flips true once we've populated `remaining` from a backend response.
  // Until then, remaining=0 means "not initialized yet", not "expired" — and
  // the timer interval must NOT fire handleAutoSubmit. Without this guard
  // the freshly-loaded paper-flow page auto-submits on the first 1Hz tick.
  const [timerArmed, setTimerArmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [multiPaperEnabled, setMultiPaperEnabled] = useState(false);
  const [paperStatuses, setPaperStatuses] = useState<any[]>([]);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [paperQuestions, setPaperQuestions] = useState<any[]>([]);
  const [paperAnswers, setPaperAnswers] = useState<Record<string, string>>({});
  const [paperCode, setPaperCode] = useState<Record<string, string>>({});
  const [paperLangId, setPaperLangId] = useState<Record<string, number>>({});
  const [paperOutput, setPaperOutput] = useState('');
  const [paperRunning, setPaperRunning] = useState(false);
  const [paperCodingSubmissions, setPaperCodingSubmissions] = useState<Record<string, any>>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const syncRef = useRef<NodeJS.Timeout | null>(null);

  // Fullscreen
  const [fsWarningOpen, setFsWarningOpen] = useState(false);
  const [fsExitCount, setFsExitCount] = useState(0);
  const fsReentryTimer = useRef<NodeJS.Timeout | null>(null);

  // Tab switch proctoring
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [tabAwayOverlay, setTabAwayOverlay] = useState(false);
  const [tabCountdown, setTabCountdown] = useState(TAB_RETURN_TIMEOUT);
  const tabCountdownRef = useRef<NodeJS.Timeout | null>(null);
  // Mirror of tabSwitchCount used outside the React updater to avoid
  // StrictMode double-fire side-effects in the visibility handler.
  const tabSwitchCountRef = useRef<number>(0);
  const [violationCount, setViolationCount] = useState(0);

  // Single-flight guard for the load effect. StrictMode double-mounts
  // useEffect in dev (and React 19 sometimes in prod-like modes); without
  // this, two startExam calls fire and pile up on the backend lock.
  const loadStartedRef = useRef<boolean>(false);

  // Single-flight guard for ALL auto-submit paths (paper timer expiry,
  // tab-switch overflow, fullscreen overflow, sync timer hit zero, manual
  // End Exam). Without this, two triggers race → 2 finalSubmit calls →
  // toast spam, double redirect, occasional 5xx because the second call
  // races past the SUBMITTED guard. Reset after a successful per-paper
  // submit so the next paper's timer can fire its own auto-submit later.
  const autoSubmitFiredRef = useRef<boolean>(false);

  // Live mirror of paperAnswers/activePaperId so async retry callbacks
  // (set inside setTimeout / catch blocks) see the latest values without
  // forcing the useCallback to depend on them — which would tear down the
  // 1Hz timer interval every keystroke.
  const paperAnswersRef = useRef<Record<string, string>>({});
  const activePaperIdRef = useRef<string | null>(null);

  // Auto-save
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);

  // Interstitial state shown between papers / after a paper is submitted.
  const [paperResult, setPaperResult] = useState<{
    paperName: string;
    score: number;
    totalMarks: number;
    cutoffPassed: boolean | null;
    cutoffType?: 'percent' | 'marks' | 'none';
    cutoffValue?: number;
    nextPaperName?: string | null;
    examEnded?: boolean;
  } | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  // Keep the tab-switch ref aligned with state so the visibility handler reads
  // the latest count without depending on closure.
  useEffect(() => { tabSwitchCountRef.current = tabSwitchCount; }, [tabSwitchCount]);
  // Mirror paperAnswers + activePaperId for stable async access (see refs).
  useEffect(() => { paperAnswersRef.current = paperAnswers; }, [paperAnswers]);
  useEffect(() => { activePaperIdRef.current = activePaperId; }, [activePaperId]);

  const loadPaperStatus = useCallback(async () => {
    const status: any = await testSessionService.getExamStatus(testId);
    setPaperStatuses(status.papers || []);
    setActivePaperId(status.currentPaperId || null);
    return status;
  }, [testId]);

  const startPaperFlow = useCallback(async (paperId: string) => {
    const paperData: any = await testSessionService.startPaper(paperId);
    // Each paper has its own timer; reset the auto-submit guard so this
    // paper's timer expiry can fire its own auto-submit. Without this, after
    // the first auto-submit the guard stays true and the next paper's expiry
    // is silently swallowed.
    autoSubmitFiredRef.current = false;
    setPaperQuestions(paperData.questions || []);
    setPaperAnswers(paperData.answers || {});
    setPaperCode({});
    setPaperLangId({});
    setPaperOutput('');
    setPaperCodingSubmissions({});
    setCurrentQIndex(0);
    setActivePaperId(paperId);
    setPaperStatuses((prev) => prev.map((p) =>
      p.paperId === paperId && p.status === 'not_started' ? { ...p, status: 'in_progress' } : p,
    ));
    // Backend returns remainingSeconds for the paper. Three cases:
    // 1. > 0 → arm the timer normally.
    // 2. exactly 0 → paper time has already expired (resumed after window).
    //    Auto-submit immediately so the candidate can't keep answering with 00:00 on the clock.
    // 3. missing/null → leave timer un-armed (handled by overall exam timer).
    if (typeof paperData?.remainingSeconds === 'number') {
      if (paperData.remainingSeconds > 0) {
        setRemaining(paperData.remainingSeconds);
        setTimerArmed(true);
      } else {
        setRemaining(0);
        // Already expired on resume — auto-submit the paper (idempotent).
        // Don't gate on the autoSubmit ref here because we just reset it; this
        // is exactly the case the ref is meant to handle.
        autoSubmitFiredRef.current = true;
        try {
          await testSessionService.submitPaper(paperId, paperData.answers || {});
          toast.error('Time was up for this paper — auto-submitted.');
        } catch { /* swallow — user will see the next paper or results */ }
        const latest: any = await loadPaperStatus();
        // Advance to next playable paper, or end the exam if none. Without
        // this the candidate stays on the now-submitted paper view with a
        // 00:00 timer and dead inputs.
        const nextPaper = latest?.papers?.find((p: any) => !p.locked && p.status !== 'submitted');
        if (nextPaper?.paperId && nextPaper.paperId !== paperId) {
          autoSubmitFiredRef.current = false;
          await startPaperFlow(nextPaper.paperId);
        } else {
          try { await testSessionService.finalSubmit(testId, true); } catch { /* idempotent */ }
          const inSeb = /SEB[\s\/]/i.test(navigator.userAgent);
          if (inSeb) window.location.href = `/student/results/${testId}?seb=quit`;
          else router.push(`/student/results/${testId}`);
        }
      }
    }
  // startPaperFlow is referenced inside but it's the same function — rely on
  // a `useRef` rebuild on each call rather than a circular dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPaperStatus, testId, router]);

  // ─── LOAD SESSION + RESTORE STATE ─────────────────────
  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    const load = async () => {
      try {
        // Lockdown: a magic-link candidate visiting /test/<some-other-id>
        // gets redirected to their own exam. Backend InviteScopeGuard
        // enforces the same boundary; this is the soft client-side
        // redirect so the candidate doesn't see a 403 toast for
        // testsService.getById on the wrong test.
        const stored = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        if (stored?.inviteScope?.lockedToTest && stored.inviteScope.testId !== testId) {
          router.replace(`/test/${stored.inviteScope.testId}`);
          return;
        }

        // Fetch test metadata FIRST so we can SEB-gate before any server
        // call that's protected by SebGuard. Without this, startExam would
        // 403 with a confusing "SEB required" error before we know to
        // redirect the candidate.
        let testMeta: any = null;
        try {
          testMeta = await testsService.getById(testId);
          setTest(testMeta);
        } catch { /* non-blocking */ }

        // SEB gate: if the test requires SEB and we're not in SEB, send
        // them back to the magic-link landing page (which has the download
        // CTA). Defense in depth — server SebGuard is the real check.
        if (testMeta?.requireSafeExamBrowser && !/SEB[\s\/]/i.test(navigator.userAgent)) {
          toast.error('This exam requires Safe Exam Browser.');
          router.replace('/student');
          return;
        }

        await testSessionService.startExam(testId);
        const examStatus: any = await loadPaperStatus();
        if (Array.isArray(examStatus?.papers) && examStatus.papers.length > 0) {
          setMultiPaperEnabled(true);
          setSession(examStatus.participation);
          const nextPaper = examStatus.papers.find((p: any) => !p.locked && p.status !== 'submitted');
          if (nextPaper?.paperId) {
            // startPaperFlow sets remaining + timerArmed from the freshly-computed
            // remainingSeconds in the startPaper response. Don't overwrite with the
            // stale value from getExamStatus — that snapshot can be 0 (e.g. paper not
            // started yet, or from an expired prior session) and would auto-submit.
            await startPaperFlow(nextPaper.paperId);
          }
          // Multi-paper flow handled — skip the legacy section/MCQ load entirely.
          setLoading(false);
          return;
        }

        await testSessionService.startTest(testId);
        const status: any = await testSessionService.getStatus(testId);
        if (status?.autoSubmittedRedirect) {
          toast.error('Time is up — your test was auto-submitted.');
          router.push(status.autoSubmittedRedirect);
          return;
        }
        setSession(status.participation);
        setTest(status.test);
        setMcqQuestions(status.mcqQuestions || []);
        setCodingQuestions(status.codingQuestions || []);
        setMcqSubmitted(status.participation.mcqSubmitted);
        setCodingUnlocked(status.participation.codingUnlocked);
        setActiveSection(status.participation.currentSection || 'mcq');
        const initialRemaining = status.timer?.remaining || 0;
        setRemaining(initialRemaining);
        if (initialRemaining > 0) setTimerArmed(true);
        setViolationCount(status.participation.violationCount || 0);
        setTabSwitchCount(status.participation.tabSwitchCount || 0);
        if (status.savedAnswers) setMcqAnswers(status.savedAnswers);

        const dc: Record<string, string> = {};
        const dl: Record<string, number> = {};
        (status.codingQuestions || []).forEach((q: Question) => {
          if (q.type === 'coding') {
            const savedCode = typeof window !== 'undefined' ? localStorage.getItem(`code_${testId}_${q.id}`) : null;
            const savedLang = typeof window !== 'undefined' ? localStorage.getItem(`lang_${testId}_${q.id}`) : null;
            dc[q.id] = savedCode || '';
            dl[q.id] = savedLang ? Number(savedLang) : (q.allowedLanguages?.[0] || 71);
          }
        });
        setCode(dc);
        setLangId(dl);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load test');
        router.push('/student');
      } finally { setLoading(false); }
    };
    load();
  }, [testId, router, loadPaperStatus, startPaperFlow]);

  // Declared before the timer / visibility effects so the dep array can
  // reference it without hitting a temporal dead zone (TDZ) error.

  // Retry an idempotent server call up to N times with exponential backoff.
  // Used to ride out transient network blips so a single failed POST doesn't
  // leave the candidate stranded with an unsubmitted exam.
  const submitWithRetry = useCallback(async <T,>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
    let lastErr: any;
    for (let i = 0; i < attempts; i += 1) {
      try { return await fn(); }
      catch (err: any) {
        lastErr = err;
        // 4xx is usually permanent (e.g. "already submitted") — bail fast and
        // let the caller decide. Retry only network/5xx.
        const code = err?.statusCode;
        if (code && code >= 400 && code < 500) throw err;
        if (i < attempts - 1) {
          const delay = 1500 * 2 ** i; // 1.5s → 3s → 6s
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }, []);

  // Final submit — kills the entire exam. Used for tab-switch / fullscreen
  // anti-cheat and for last-paper-expired in legacy single-paper flow.
  const handleAutoSubmit = useCallback(async (reason: string = 'time expired') => {
    if (autoSubmitFiredRef.current) return;
    autoSubmitFiredRef.current = true;
    try {
      // Best-effort: also push the in-progress paper's answers so anything
      // typed after the last autosave isn't lost.
      const apId = activePaperIdRef.current;
      if (apId) {
        try { await testSessionService.submitPaper(apId, paperAnswersRef.current); } catch { /* silent — finalSubmit will close it */ }
      }
      await submitWithRetry(() => testSessionService.finalSubmit(testId, true));
      toast.error(`Test auto-submitted: ${reason}`);
      const inSeb = /SEB[\s\/]/i.test(navigator.userAgent);
      if (inSeb) window.location.href = `/student/results/${testId}?seb=quit`;
      else router.push(`/student/results/${testId}`);
    } catch (err: any) {
      // After 3 retries, leave the candidate on the page with a clear ask to
      // refresh. Don't reset the guard — repeated finalSubmit on a closed
      // exam is harmless but spams toasts.
      toast.error(`Auto-submit failed: ${err?.message || 'unknown error'}. Refresh the page; if it persists, contact your recruiter.`);
    }
  }, [testId, router, submitWithRetry]);

  // Per-paper auto-submit — used when a single paper's countdown hits 0 in
  // the multi-paper flow. Submits ONLY the current paper, then advances to
  // the next paper or falls through to a final submit if this was the last.
  // Critical: in multi-paper mode, paper timer expiring must NOT kill the
  // entire exam — that's what the legacy handleAutoSubmit was doing.
  const autoSubmitActivePaper = useCallback(async (reason: string = 'time expired') => {
    if (autoSubmitFiredRef.current) return;
    const apId = activePaperIdRef.current;
    if (!apId) {
      // No active paper context — fall back to final submit.
      return handleAutoSubmit(reason);
    }
    autoSubmitFiredRef.current = true;
    try {
      await submitWithRetry(() => testSessionService.submitPaper(apId, paperAnswersRef.current));
      toast.error(`Paper auto-submitted: ${reason}`);
      // Find next paper. If none, finalize the test.
      const latest: any = await loadPaperStatus();
      const nextPaper = latest?.papers?.find((p: any) => !p.locked && p.status !== 'submitted');
      if (nextPaper?.paperId) {
        autoSubmitFiredRef.current = false; // arm for the next paper's own timer
        await startPaperFlow(nextPaper.paperId);
      } else {
        // Backend may have already marked the exam submitted via cascade; just
        // navigate to results. If not, trigger a finalSubmit defensively.
        try { await testSessionService.finalSubmit(testId, true); } catch { /* idempotent */ }
        const inSeb = /SEB[\s\/]/i.test(navigator.userAgent);
        if (inSeb) window.location.href = `/student/results/${testId}?seb=quit`;
        else router.push(`/student/results/${testId}`);
      }
    } catch (err: any) {
      autoSubmitFiredRef.current = false; // allow user-driven submit to retry
      toast.error(`Paper auto-submit failed: ${err?.message || 'unknown error'}. Will retry in 30s.`);
      setTimeout(() => autoSubmitActivePaper(reason), 30000);
    }
  }, [testId, router, submitWithRetry, handleAutoSubmit, loadPaperStatus, startPaperFlow]);

  // ─── TIMER ─────────────────────────────────────────────
  useEffect(() => {
    if (loading || !session) return;
    // Guard: don't start the countdown until timerArmed flips true (i.e.
    // we've populated `remaining` from a backend response). Otherwise the
    // 1Hz tick would fire on initial state remaining=0 and immediately
    // handleAutoSubmit a freshly-loaded exam. Use `timerArmed` (not
    // `remaining`) in deps so we don't recreate the interval every tick.
    if (!timerArmed) return;
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          // Multi-paper: expire only the current paper, advance.
          // Single-paper / legacy: final submit.
          // Schedule outside the updater so React's StrictMode double-fire
          // doesn't trigger autoSubmit twice; the ref-guard inside both
          // handlers also blocks double-fire across triggers.
          setTimeout(() => {
            if (multiPaperEnabled) autoSubmitActivePaper('paper time expired');
            else handleAutoSubmit('time expired');
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    // Sync the legacy test-level timer every 30s to recover from clock drift.
    // SKIP this for multi-paper flow — the legacy timer uses Redis cache that
    // can be stale, and the paper has its own per-paper countdown, not the
    // overall test duration. Syncing here wrongly auto-submits a fresh paper.
    if (!multiPaperEnabled) {
      syncRef.current = setInterval(async () => {
        try {
          const t = await testSessionService.getTimer(testId);
          setRemaining(t.remaining);
          if (t.remaining <= 0) handleAutoSubmit();
        } catch (err: any) {
          // Don't crash sync loop on transient backend hiccup, but surface server errors.
          if (err?.statusCode && err.statusCode >= 500) {
            // eslint-disable-next-line no-console
            console.warn('Timer sync failed:', err.message);
          }
        }
      }, 30000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); if (syncRef.current) clearInterval(syncRef.current); };
  }, [loading, session, testId, handleAutoSubmit, autoSubmitActivePaper, timerArmed, multiPaperEnabled]);

  // ─── FULLSCREEN ────────────────────────────────────────
  useEffect(() => {
    if (loading || !session) return;
    (async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {} })();
  }, [loading, session]);

  const forceReenterFullscreen = useCallback(async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); setFsWarningOpen(false); } catch {}
  }, []);

  const enterFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen(); setFsWarningOpen(false); } catch {}
  }, []);

  // ─── AUTO-SAVE CODE (every 5s) ────────────────────────
  useEffect(() => {
    if (loading || activeSection !== 'coding') return;
    autoSaveRef.current = setInterval(() => {
      Object.entries(code).forEach(([qId, src]) => {
        if (src && typeof window !== 'undefined') {
          localStorage.setItem(`code_${testId}_${qId}`, src);
          localStorage.setItem(`lang_${testId}_${qId}`, String(langId[qId] || 71));
        }
      });
      setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 5000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [loading, activeSection, code, langId, testId]);

  useEffect(() => {
    if (loading || !multiPaperEnabled || !activePaperId) return;
    const id = setInterval(() => {
      testSessionService.autosavePaperAnswers(activePaperId, paperAnswers).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [loading, multiPaperEnabled, activePaperId, paperAnswers]);

  // ─── TAB SWITCH PROCTORING ────────────────────────────
  useEffect(() => {
    if (loading) return;

    const handleVisibility = () => {
      if (document.hidden) {
        testSessionService.logAntiCheat(testId, 'tab_switch').catch(() => {});
        // React StrictMode double-fires updaters in dev; running side-effects
        // (setInterval, handleAutoSubmit) inside setState would double them.
        // Compute next count via a ref-based read, do side-effects outside.
        setTabSwitchCount((prev) => prev + 1);
        setViolationCount((v) => v + 1);
        const nextCount = (tabSwitchCountRef.current ?? 0) + 1;
        tabSwitchCountRef.current = nextCount;
        if (nextCount >= MAX_TAB_SWITCHES) {
          // Schedule after commit so we don't tear down the current effect mid-run.
          setTimeout(() => handleAutoSubmit(), 0);
          return;
        }
        setTabAwayOverlay(true);
        setTabCountdown(TAB_RETURN_TIMEOUT);
        if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
        tabCountdownRef.current = setInterval(() => {
          setTabCountdown((c) => {
            if (c <= 1) {
              if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
              setTimeout(() => handleAutoSubmit(), 0);
              return 0;
            }
            return c - 1;
          });
        }, 1000);
      } else {
        // User returned
        if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
        setTabAwayOverlay(false);
        setTabCountdown(TAB_RETURN_TIMEOUT);
      }
    };

    const logClipboard = () => {
      testSessionService.logAntiCheat(testId, 'copy_paste').catch(() => {});
      setViolationCount((v) => v + 1);
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        testSessionService.logAntiCheat(testId, 'fullscreen_exit').catch(() => {});
        setFsExitCount((p) => p + 1);
        setViolationCount((v) => v + 1);
        setFsWarningOpen(true);
        if (fsReentryTimer.current) clearTimeout(fsReentryTimer.current);
        fsReentryTimer.current = setTimeout(forceReenterFullscreen, 500);
      } else { setFsWarningOpen(false); }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
      // Ctrl+Enter = Run, Ctrl+Shift+Enter = Submit
      if (e.ctrlKey && e.key === 'Enter' && !e.shiftKey && activeSection === 'coding') { e.preventDefault(); handleRunCode(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'Enter' && activeSection === 'coding') { e.preventDefault(); handleSubmitCoding(); }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };

    document.addEventListener('copy', logClipboard);
    document.addEventListener('paste', logClipboard);
    document.addEventListener('cut', logClipboard);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('copy', logClipboard);
      document.removeEventListener('paste', logClipboard);
      document.removeEventListener('cut', logClipboard);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (fsReentryTimer.current) clearTimeout(fsReentryTimer.current);
      if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
    };
  }, [testId, loading, forceReenterFullscreen, activeSection]);

  // ─── HANDLERS ──────────────────────────────────────────
  // (handleAutoSubmit declared earlier so timer/visibility effects can reference it.)

  const handleSaveMcq = async (questionId: string, option: string) => {
    setMcqAnswers((prev) => ({ ...prev, [questionId]: option }));
    try { await testSessionService.saveMcqAnswer(testId, questionId, option); } catch (err: any) { toast.error(err.message); }
  };

  const handleSubmitMcq = async () => {
    askConfirm({
      title: 'Submit MCQ section?',
      message: 'You cannot change answers after submission.',
      confirmLabel: 'Submit MCQ',
      variant: 'primary',
      onConfirm: () => { closeConfirm(); void doSubmitMcq(); },
    });
  };

  const doSubmitMcq = async () => {
    setSubmitting(true);
    try {
      const result = await testSessionService.submitMcqSection(testId);
      setMcqResult(result); setMcqSubmitted(true); setCodingUnlocked(result.codingUnlocked);
      if (result.codingUnlocked) {
        toast.success(result.message);
        const status: any = await testSessionService.getStatus(testId);
        setCodingQuestions(status.codingQuestions || []);
        const dc: Record<string, string> = {}; const dl: Record<string, number> = {};
        (status.codingQuestions || []).forEach((q: Question) => {
          const saved = typeof window !== 'undefined' ? localStorage.getItem(`code_${testId}_${q.id}`) : null;
          dc[q.id] = saved || ''; dl[q.id] = q.allowedLanguages?.[0] || 71;
        });
        setCode(dc); setLangId(dl);
      } else { toast.error(result.message); }
    } catch (err: any) { toast.error(err.message); } finally { setSubmitting(false); }
  };

  const handleSwitchToCoding = () => {
    if (!codingUnlocked) { toast.error('Complete MCQ section first'); return; }
    setActiveSection('coding'); setCurrentQIndex(0); setOutput('');
  };

  const formatJ0Error = (result: any): string => {
    if (!result) return 'Unknown error';
    const sid = result.status?.id;
    if (sid === 6) return `Compilation Error:\n${result.compile_output || 'Check your syntax'}`;
    if (sid === 7 || sid === 8 || sid === 9 || sid === 10 || sid === 11 || sid === 12) return `Runtime Error:\n${result.stderr || result.message || 'Your program crashed'}`;
    if (sid === 5) return 'Time Limit Exceeded — your solution is too slow.';
    if (sid === 13) return `Execution Error:\n${result.message || 'Internal error — try again'}`;
    let out = '';
    if (result.compile_output) out += `Compilation:\n${result.compile_output}\n\n`;
    if (result.stdout) out += `Output:\n${result.stdout}`;
    if (result.stderr) out += `\nErrors:\n${result.stderr}`;
    if (!out.trim()) out = `Status: ${result.status?.description || 'Unknown'}`;
    return out;
  };

  const handleRunCode = async () => {
    const q = codingQuestions[currentQIndex]; if (!q || running) return;
    setRunning(true); setOutputTab('output'); setOutput('Running...');
    try {
      const result = await submissionsService.runCode({ languageId: langId[q.id], sourceCode: code[q.id] || '', stdin: customInput });
      if (result.status?.id === 3) {
        setOutput(`Output:\n${result.stdout || '(no output)'}\n\nTime: ${result.time || '0'}s | Memory: ${result.memory || 0}KB`);
      } else {
        setOutput(formatJ0Error(result) + `\n\nTime: ${result.time || '0'}s | Memory: ${result.memory || 0}KB`);
      }
    } catch (err: any) { setOutput(`Error: ${err.message}`); } finally { setRunning(false); }
  };

  const handleSubmitCoding = async () => {
    const q = codingQuestions[currentQIndex]; if (!q || submitting) return;
    setSubmitting(true);
    try {
      const sub = await testSessionService.submitCoding({ testId, questionId: q.id, languageId: langId[q.id], sourceCode: code[q.id] || '' });
      setSubmissions((p) => ({ ...p, [q.id]: sub }));
      toast.success('Evaluating...'); setOutputTab('results'); setOutput('Evaluating against test cases...');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const updated = await submissionsService.getById(sub.id);
          if (updated.status === 'completed' || updated.status === 'failed') {
            clearInterval(poll); setSubmissions((p) => ({ ...p, [q.id]: updated }));
            if (updated.result?.testCaseResults) {
              const r = updated.result;
              let out = `Score: ${updated.score}/${q.marks}\nPassed: ${r.passedCount}/${r.totalCount}\n\n`;
              r.testCaseResults.forEach((tc: any, i: number) => {
                const icon = tc.passed ? '✓' : '✗';
                out += `${icon} ${tc.isHidden ? 'Hidden ' : ''}Case ${i + 1}: ${tc.passed ? 'PASSED' : 'FAILED'}`;
                if (!tc.passed) out += ` (${tc.status})`;
                if (tc.stdout && !tc.isHidden) out += `\n  Output: ${tc.stdout.trim()}`;
                out += '\n';
              });
              if (updated.executionTime) out += `\nTime: ${updated.executionTime}s`;
              if (updated.memoryUsed) out += ` | Memory: ${updated.memoryUsed}KB`;
              setOutput(out);
            } else { setOutput(`Status: ${updated.status}`); }
          }
        } catch (err: any) {
          // Stop on hard server errors instead of silently re-polling 30 times.
          const code = err?.statusCode;
          if (code && code >= 400) {
            clearInterval(poll);
            toast.error(`Evaluation request failed (${code}). Please submit again.`);
            setOutput(`Evaluation failed: ${err.message}`);
          }
        }
        if (attempts > 30) {
          clearInterval(poll);
          toast.error('Evaluation timed out. Please try submitting again.');
          setOutput('Evaluation timed out — no result after 60 seconds.');
        }
      }, 2000);
    } catch (err: any) { toast.error(err.message); } finally { setSubmitting(false); }
  };

  const handleResetCode = () => {
    const q = codingQuestions[currentQIndex]; if (!q) return;
    askConfirm({
      title: 'Reset code?',
      message: 'Your current code will be cleared and cannot be recovered.',
      confirmLabel: 'Reset',
      variant: 'danger',
      onConfirm: () => {
        closeConfirm();
        setCode((p) => ({ ...p, [q.id]: '' }));
        if (typeof window !== 'undefined') localStorage.removeItem(`code_${testId}_${q.id}`);
      },
    });
  };

  const handleFinalSubmit = async () => {
    askConfirm({
      title: 'Submit the entire test?',
      message: 'This cannot be undone. You will not be able to change any answers afterwards.',
      confirmLabel: 'Submit Test',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        try {
          await testSessionService.finalSubmit(testId, false);
          toast.success('Test submitted!');
          // SEB-required exams: quit SEB by navigating to ?seb=quit (matches
          // the configured quitURL). Plain candidates land on the dashboard.
          const inSeb = /SEB[\s\/]/i.test(navigator.userAgent);
          if (inSeb) {
            window.location.href = `/student/results/${testId}?seb=quit`;
          } else {
            router.push('/student');
          }
        } catch (err: any) { toast.error(err.message); }
      },
    });
  };

  const handleRunPaperCode = async (q: any) => {
    if (!q || paperRunning) return;
    const lId = paperLangId[q.id] || 71;
    setPaperRunning(true);
    setPaperOutput('Running...');
    try {
      const result = await submissionsService.runCode({ languageId: lId, sourceCode: paperCode[q.id] || '', stdin: '' });
      if (result.status?.id === 3) {
        setPaperOutput(`Output:\n${result.stdout || '(no output)'}\n\nTime: ${result.time || '0'}s | Memory: ${result.memory || 0}KB`);
      } else {
        setPaperOutput(formatJ0Error(result) + `\n\nTime: ${result.time || '0'}s | Memory: ${result.memory || 0}KB`);
      }
    } catch (err: any) { setPaperOutput(`Error: ${err.message}`); } finally { setPaperRunning(false); }
  };

  const handleSubmitPaperCode = async (q: any) => {
    if (!q || submitting) return;
    setSubmitting(true);
    try {
      const sub = await testSessionService.submitCoding({ testId, questionId: q.id, languageId: paperLangId[q.id] || 71, sourceCode: paperCode[q.id] || '' });
      setPaperCodingSubmissions((p) => ({ ...p, [q.id]: sub }));
      setPaperAnswers((p) => ({ ...p, [q.id]: sub.id }));
      toast.success('Evaluating...');
      setPaperOutput('Evaluating against test cases...');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const updated = await submissionsService.getById(sub.id);
          if (updated.status === 'completed' || updated.status === 'failed') {
            clearInterval(poll);
            setPaperCodingSubmissions((p) => ({ ...p, [q.id]: updated }));
            if (updated.result?.testCaseResults) {
              const r = updated.result;
              let out = `Score: ${updated.score}/${q.marks}\nPassed: ${r.passedCount}/${r.totalCount}\n\n`;
              r.testCaseResults.forEach((tc: any, i: number) => {
                const icon = tc.passed ? '✓' : '✗';
                out += `${icon} ${tc.isHidden ? 'Hidden ' : ''}Case ${i + 1}: ${tc.passed ? 'PASSED' : 'FAILED'}`;
                if (!tc.passed) out += ` (${tc.status})`;
                if (tc.stdout && !tc.isHidden) out += `\n  Output: ${tc.stdout.trim()}`;
                out += '\n';
              });
              if (updated.executionTime) out += `\nTime: ${updated.executionTime}s`;
              if (updated.memoryUsed) out += ` | Memory: ${updated.memoryUsed}KB`;
              setPaperOutput(out);
            } else { setPaperOutput(`Status: ${updated.status}`); }
          }
        } catch (err: any) {
          const code = err?.statusCode;
          if (code && code >= 400) { clearInterval(poll); setPaperOutput(`Evaluation failed: ${err.message}`); }
        }
        if (attempts > 30) { clearInterval(poll); setPaperOutput('Evaluation timed out.'); }
      }, 2000);
    } catch (err: any) { toast.error(err.message); } finally { setSubmitting(false); }
  };

  const handleSavePaperAnswer = async (questionId: string, optionId: string) => {
    if (!activePaperId) return;
    const next = { ...paperAnswers, [questionId]: optionId };
    setPaperAnswers(next);
    // Persist to backend so a refresh / crash doesn't lose answers.
    try { await testSessionService.autosavePaperAnswers(activePaperId, next); } catch { /* silent — local state still valid */ }
  };

  const handleSubmitPaper = async () => {
    if (!activePaperId || submitting) return;
    const answeredCount = paperQuestions.filter((q) => !!paperAnswers[q.id]).length;
    const totalCount = paperQuestions.length;
    const unanswered = totalCount - answeredCount;
    askConfirm({
      title: 'Submit this paper?',
      message: unanswered > 0
        ? `${unanswered} question${unanswered > 1 ? 's are' : ' is'} unanswered (${answeredCount}/${totalCount} answered). You cannot change answers after submission.`
        : `All ${totalCount} questions answered. You cannot change answers after submission.`,
      confirmLabel: 'Submit Paper',
      variant: unanswered > 0 ? 'danger' : 'primary',
      onConfirm: async () => {
        closeConfirm();
        setSubmitting(true);
        try {
          const res: any = await testSessionService.submitPaper(activePaperId, paperAnswers);
          const submittedPaper = paperStatuses.find((p) => p.paperId === activePaperId);
          const latest: any = await loadPaperStatus();
          const nextPaper = latest.papers?.find((p: any) => !p.locked && p.status !== 'submitted');
          const examEnded = latest.participation?.status === 'submitted' || res?.examEnded;

          // Show interstitial — don't auto-advance silently.
          setPaperResult({
            paperName: submittedPaper?.name || 'Paper',
            score: Number(res?.score ?? 0),
            totalMarks: Number(res?.totalMarks ?? submittedPaper?.totalMarks ?? 0),
            cutoffPassed: res?.cutoffPassed ?? null,
            cutoffType: res?.cutoffType,
            cutoffValue: res?.cutoffValue,
            nextPaperName: nextPaper?.name ?? null,
            examEnded,
          });
        } catch (err: any) {
          toast.error(err.message || 'Failed to submit paper');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const handleContinueAfterPaper = async () => {
    if (!paperResult) return;
    const inSeb = /SEB[\s\/]/i.test(navigator.userAgent);
    const exitUrl = inSeb
      ? `/student/results/${testId}?seb=quit` // matches SEB's quitURL → auto-quits
      : `/student/results/${testId}`;
    if (paperResult.examEnded || !paperResult.nextPaperName) {
      if (inSeb) window.location.href = exitUrl; else router.push(exitUrl);
      return;
    }
    // Find next paper id from latest status
    const latest = await loadPaperStatus();
    const nextPaper = latest.papers?.find((p: any) => !p.locked && p.status !== 'submitted');
    if (nextPaper?.paperId) {
      setPaperResult(null);
      await startPaperFlow(nextPaper.paperId);
      if (typeof nextPaper.remainingSeconds === 'number') {
        setRemaining(nextPaper.remainingSeconds);
      }
    } else {
      if (inSeb) window.location.href = exitUrl; else router.push(exitUrl);
    }
  };

  // ─── DERIVED ───────────────────────────────────────────
  const timerMinutes = Math.floor(remaining / 60);
  const timerSeconds = remaining % 60;
  const timerFormatted = `${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`;
  const isLow = remaining < 300;
  const isCritical = remaining < 60;
  const currentQuestions = activeSection === 'mcq' ? mcqQuestions : codingQuestions;
  const currentQuestion = currentQuestions[currentQIndex];
  const answeredCount = Object.keys(mcqAnswers).length;

  // ─── LOADING ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid flex items-center justify-center">
        <div className="animate-fade-in flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-slate-300 font-medium">Preparing your assessment</p>
            <p className="text-slate-500 text-sm mt-1">Setting up secure environment...</p>
          </div>
        </div>
      </div>
    );
  }

  if (multiPaperEnabled) {
    const currentPaper = paperStatuses.find((p) => p.paperId === activePaperId) || null;
    const currentPaperQuestion = paperQuestions[currentQIndex];
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid overflow-hidden">
        <header className="h-14 glass-strong border-b border-slate-700/30 flex items-center px-5 justify-between shrink-0 z-50">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-slate-200 truncate max-w-[300px]">{test?.title || 'Loading…'}</h1>
            <span className="text-xs text-blue-400">{currentPaper?.name || 'Paper'}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="font-mono text-sm text-blue-300">{timerFormatted}</div>
            {/* Always-visible exit. Confirms before submitting + closing SEB. */}
            <button
              type="button"
              onClick={handleFinalSubmit}
              className="text-xs px-3 py-1.5 rounded-md bg-red-600/90 hover:bg-red-600 text-white font-semibold transition-colors"
              title="End the exam now and quit Safe Exam Browser"
            >
              End Exam
            </button>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-72 border-r border-slate-700/30 p-4 overflow-y-auto">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Papers</p>
            <div className="space-y-2 mb-6">
              {paperStatuses.map((p) => {
                const isLockedFail = p.status === 'locked_fail' || p.lockedReason === 'cutoff_failed';
                const subline =
                  p.status === 'submitted' && p.cutoffPassed === false
                    ? `Score ${p.score}/${p.totalMarks} — cutoff missed`
                    : p.status === 'submitted'
                      ? `Score ${p.score}/${p.totalMarks}`
                      : isLockedFail
                        ? 'Locked (cutoff missed)'
                        : p.locked
                          ? 'Locked'
                          : p.status;
                return (
                  <button
                    key={p.paperId}
                    onClick={() => !p.locked && !isLockedFail && p.status !== 'submitted' && startPaperFlow(p.paperId)}
                    disabled={p.locked || isLockedFail || p.status === 'submitted'}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex flex-col gap-0.5 ${
                      p.paperId === activePaperId
                        ? 'bg-blue-600/20 text-blue-300'
                        : isLockedFail
                          ? 'bg-rose-900/30 text-rose-300 border border-rose-700/40'
                          : p.locked
                            ? 'bg-slate-900/50 text-slate-600'
                            : 'bg-slate-800/40 text-slate-300'
                    }`}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs opacity-80">{subline}</span>
                    {p.cutoffType && p.cutoffType !== 'none' && p.status !== 'submitted' && !isLockedFail && (
                      <span className="text-[10px] opacity-60">
                        Cutoff: {p.cutoffValue}{p.cutoffType === 'percent' ? '%' : ' marks'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Questions</p>
            <div className="grid grid-cols-5 gap-2">
              {paperQuestions.map((q, idx) => (
                <button
                  key={q.id}
                  onClick={() => setCurrentQIndex(idx)}
                  className={`h-8 rounded text-xs ${idx === currentQIndex ? 'bg-blue-600 text-white' : paperAnswers[q.id] ? 'bg-emerald-700/30 text-emerald-300' : 'bg-slate-800/40 text-slate-400'}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </aside>
          <main className="flex-1 p-8 overflow-y-auto">
            {currentPaperQuestion ? (() => {
              const totalQ = paperQuestions.length;
              const answeredQ = paperQuestions.filter((q) => !!paperAnswers[q.id]).length;
              const isFirst = currentQIndex === 0;
              const isLast = currentQIndex === totalQ - 1;
              const isCodingQ = currentPaperQuestion.type === 'coding';
              const renderDesc = (text: string) => {
                const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
                return parts.map((part, i) => {
                  if (part.startsWith('**') && part.endsWith('**'))
                    return <strong key={i} className="text-slate-200">{part.slice(2, -2)}</strong>;
                  if (part.startsWith('`') && part.endsWith('`'))
                    return <code key={i} className="font-mono text-xs bg-slate-800 px-1 py-0.5 rounded text-emerald-300">{part.slice(1, -1)}</code>;
                  return <span key={i}>{part}</span>;
                });
              };
              return (
                <div className={isCodingQ ? 'flex flex-col h-full' : 'max-w-3xl'}>
                  {/* Progress bar */}
                  <div className="flex items-center justify-between mb-6 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-mono bg-slate-800/60 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/30">
                        Question {currentQIndex + 1} of {totalQ}
                      </span>
                      <span className="text-slate-500">
                        {answeredQ} of {totalQ} answered
                      </span>
                    </div>
                    <div className="flex-1 max-w-[200px] h-1.5 bg-slate-800/60 rounded-full overflow-hidden ml-4">
                      <div className="h-full bg-emerald-500/70 rounded-full transition-all duration-300" style={{ width: `${totalQ > 0 ? (answeredQ / totalQ) * 100 : 0}%` }} />
                    </div>
                  </div>

                  <h2 className="text-white text-xl font-semibold mb-2">{currentPaperQuestion.title}</h2>
                  <p className="text-slate-400 mb-6 whitespace-pre-line">{renderDesc(currentPaperQuestion.description || '')}</p>

                  {isCodingQ ? (
                    <div className="space-y-4">
                      {/* Language selector */}
                      <div className="flex items-center gap-3">
                        <select
                          value={paperLangId[currentPaperQuestion.id] || 71}
                          onChange={(e) => setPaperLangId((p) => ({ ...p, [currentPaperQuestion.id]: Number(e.target.value) }))}
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {Object.entries(LANGUAGES).map(([id, lang]) => (
                            <option key={id} value={Number(id)}>{lang.name}</option>
                          ))}
                        </select>
                        {paperCodingSubmissions[currentPaperQuestion.id] && (
                          <span className="text-xs text-emerald-400">
                            ✓ Submitted — Score: {paperCodingSubmissions[currentPaperQuestion.id].score}/{currentPaperQuestion.marks}
                          </span>
                        )}
                      </div>
                      {/* Code editor */}
                      <div className="h-64 rounded-xl overflow-hidden border border-slate-700/50">
                        <CodeEditor
                          language={LANGUAGES[paperLangId[currentPaperQuestion.id] || 71]?.monacoId || 'python'}
                          value={paperCode[currentPaperQuestion.id] || ''}
                          onChange={(v) => setPaperCode((p) => ({ ...p, [currentPaperQuestion.id]: v || '' }))}
                        />
                      </div>
                      {/* Run / Submit buttons */}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleRunPaperCode(currentPaperQuestion)}
                          disabled={paperRunning}
                          className="btn-secondary text-sm py-1.5 flex items-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" />
                          {paperRunning ? 'Running…' : 'Run'}
                        </button>
                        <button
                          onClick={() => handleSubmitPaperCode(currentPaperQuestion)}
                          disabled={submitting || !paperCode[currentPaperQuestion.id]}
                          className="btn-primary text-sm py-1.5 flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {submitting ? 'Submitting…' : 'Submit Code'}
                        </button>
                      </div>
                      {/* Output */}
                      {paperOutput && (
                        <pre className="bg-slate-900/80 border border-slate-700/40 rounded-xl p-4 text-xs text-slate-300 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
                          {paperOutput}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(currentPaperQuestion.mcqOptions || []).map((opt: any, idx: number) => (
                        <button
                          key={opt.id}
                          onClick={() => handleSavePaperAnswer(currentPaperQuestion.id, opt.id)}
                          className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                            paperAnswers[currentPaperQuestion.id] === opt.id
                              ? 'bg-blue-600/20 border-blue-500 text-white'
                              : 'bg-slate-800/30 border-slate-700 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          <span className="font-mono text-xs text-slate-500 mr-2">{String.fromCharCode(65 + idx)}.</span>
                          {opt.text}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Navigation: Previous always; Next on intermediate; Submit on last */}
                  <div className="flex items-center justify-between mt-8 gap-3">
                    <button
                      className="btn-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => setCurrentQIndex((v) => Math.max(0, v - 1))}
                      disabled={isFirst}
                    >
                      ← Previous
                    </button>
                    {isLast ? (
                      <button
                        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleSubmitPaper}
                        disabled={submitting}
                      >
                        {submitting ? 'Submitting…' : 'Submit Paper'}
                      </button>
                    ) : (
                      <button
                        className="btn-secondary"
                        onClick={() => setCurrentQIndex((v) => Math.min(totalQ - 1, v + 1))}
                      >
                        Next →
                      </button>
                    )}
                  </div>

                  {/* Always-available submit (subtle) for intermediate questions */}
                  {!isLast && (
                    <div className="mt-6 pt-6 border-t border-slate-800/60 flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        Done early? You can submit anytime — locked questions stay unanswered.
                      </p>
                      <button
                        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                        onClick={handleSubmitPaper}
                        disabled={submitting}
                      >
                        {submitting ? 'Submitting…' : 'Submit Paper now →'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })() : (
              <p className="text-slate-500">No unlocked paper available.</p>
            )}
          </main>
        </div>

        {paperResult && (
          <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 backdrop-blur-md p-6">
            <div className="card max-w-lg w-full border border-dark-700 text-center">
              <div className={`w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center ${
                paperResult.cutoffPassed === false ? 'bg-rose-500/15' :
                paperResult.cutoffPassed === true ? 'bg-emerald-500/15' :
                'bg-blue-500/15'
              }`}>
                {paperResult.cutoffPassed === false ? <AlertTriangle className="w-8 h-8 text-rose-400" /> :
                  paperResult.cutoffPassed === true ? <CheckCircle className="w-8 h-8 text-emerald-400" /> :
                  <CheckCircle className="w-8 h-8 text-blue-400" />}
              </div>
              <h2 className="text-xl font-bold text-white mb-1">{paperResult.paperName} submitted</h2>

              <div className="mt-4 mb-5 inline-flex flex-col items-center bg-slate-800/40 rounded-xl px-6 py-4 mx-auto">
                <span className="text-3xl font-mono font-bold text-white">{paperResult.score}<span className="text-slate-500 text-lg">/{paperResult.totalMarks}</span></span>
                <span className="text-xs text-slate-400 mt-1">your score</span>
              </div>

              {paperResult.cutoffType && paperResult.cutoffType !== 'none' && (
                <p className={`text-sm font-medium mb-4 ${paperResult.cutoffPassed ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {paperResult.cutoffPassed ? '✓ Cutoff cleared' : '✗ Cutoff not met'}
                  <span className="text-slate-500 font-normal ml-2">
                    (required: {paperResult.cutoffValue}{paperResult.cutoffType === 'percent' ? '%' : ' marks'})
                  </span>
                </p>
              )}

              {paperResult.examEnded ? (
                <p className="text-sm text-slate-400 mb-5">
                  {paperResult.cutoffPassed === false
                    ? 'Cutoff was not met — your exam has ended here. Your recruiter will review your performance.'
                    : 'All papers submitted — your exam is complete.'}
                </p>
              ) : paperResult.nextPaperName ? (
                <p className="text-sm text-slate-400 mb-5">
                  Up next: <span className="text-blue-300 font-medium">{paperResult.nextPaperName}</span>
                </p>
              ) : (
                <p className="text-sm text-slate-400 mb-5">No more papers — submitting your exam.</p>
              )}

              <button onClick={handleContinueAfterPaper} className="btn-primary w-full">
                {paperResult.examEnded ? 'View final results →' : paperResult.nextPaperName ? `Start ${paperResult.nextPaperName} →` : 'Continue →'}
              </button>
            </div>
          </div>
        )}

        {confirmState.open && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeConfirm}>
            <div className="card max-w-md w-full mx-4 border border-dark-700" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-2">{confirmState.title}</h3>
              <p className="text-dark-300 text-sm mb-5">{confirmState.message}</p>
              <div className="flex justify-end gap-3">
                <button onClick={closeConfirm} className="btn-secondary">Cancel</button>
                <button
                  onClick={confirmState.onConfirm}
                  className={confirmState.variant === 'danger'
                    ? 'px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium'
                    : 'btn-primary'}
                >
                  {confirmState.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid overflow-hidden">

      {/* ═══ TAB AWAY OVERLAY (countdown) ══════════════════ */}
      {tabAwayOverlay && (
        <div className="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-md flex items-center justify-center animate-fade-in">
          <div className="text-center max-w-md mx-4">
            <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-red-500/30">
              <span className="text-4xl font-bold text-red-400 font-mono">{tabCountdown}</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">You left the test!</h2>
            <p className="text-slate-400 mb-2">Return within {tabCountdown} seconds or your test will be auto-submitted.</p>
            <p className="text-red-400 text-sm font-medium">
              Tab switches: {tabSwitchCount}/{MAX_TAB_SWITCHES} (auto-submit at {MAX_TAB_SWITCHES})
            </p>
          </div>
        </div>
      )}

      {/* ═══ FULLSCREEN WARNING ════════════════════════════ */}
      {fsWarningOpen && !tabAwayOverlay && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center animate-fade-in">
          <div className="glass-strong rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/20">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Fullscreen Required</h2>
            <p className="text-slate-400 text-sm mb-6">Exits: {fsExitCount}. Please remain in fullscreen.</p>
            <button onClick={enterFullscreen} className="w-full py-3 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center justify-center gap-2">
              <Maximize className="w-5 h-5" /> Re-enter Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* ═══ TOP HEADER ════════════════════════════════════ */}
      <header className="h-14 glass-strong border-b border-slate-700/30 flex items-center px-5 justify-between shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
              <span className="text-xs font-bold text-white">G</span>
            </div>
            <h1 className="text-sm font-semibold text-slate-200 truncate max-w-[160px] hidden sm:block">{test?.title}</h1>
          </div>
          <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-xl p-1 border border-slate-700/30">
            <button onClick={() => { setActiveSection('mcq'); setCurrentQIndex(0); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${activeSection === 'mcq' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : mcqSubmitted ? 'text-emerald-400' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              <ListChecks className="w-3.5 h-3.5" /> MCQ {mcqSubmitted && <CheckCircle className="w-3 h-3" />}
            </button>
            <button onClick={handleSwitchToCoding} disabled={!codingUnlocked}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${activeSection === 'coding' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : codingUnlocked ? 'text-slate-400 hover:text-white hover:bg-slate-700/50' : 'text-slate-600 cursor-not-allowed'}`}>
              {codingUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Coding
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Question pills */}
          <div className="hidden lg:flex gap-1">
            {currentQuestions.map((_, i) => {
              const q = currentQuestions[i];
              const isAnswered = activeSection === 'mcq' ? !!mcqAnswers[q.id] : !!submissions[q.id];
              return (
                <button key={i} onClick={() => setCurrentQIndex(i)}
                  className={`w-7 h-7 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                    i === currentQIndex ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 scale-110' :
                    isAnswered ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                    'bg-slate-800/50 text-slate-500 hover:bg-slate-700/50 border border-slate-700/30'
                  }`}>{i + 1}</button>
              );
            })}
          </div>

          {/* Violation indicator */}
          {violationCount > 0 && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
              violationCount >= 5 ? 'bg-red-500/10 text-red-400 border-red-500/20' :
              violationCount >= 2 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              'bg-slate-800/50 text-slate-400 border-slate-700/30'
            }`}>
              <Shield className="w-3 h-3" /> {violationCount}
            </div>
          )}

          {/* Timer */}
          <div className={`flex items-center gap-2 px-4 py-1.5 rounded-xl font-mono text-sm font-bold border ${
            isCritical ? 'bg-red-500/10 text-red-400 border-red-500/20 timer-critical' :
            isLow ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 timer-warn' :
            'bg-blue-500/10 text-blue-400 border-blue-500/20 timer-glow'
          }`}>
            <Clock className="w-4 h-4" />{timerFormatted}
          </div>

          <button onClick={handleFinalSubmit} className="bg-red-600/80 hover:bg-red-500 text-white text-sm py-1.5 px-4 rounded-xl font-medium flex items-center gap-1.5 transition-all hover:shadow-lg hover:shadow-red-500/20">
            <Send className="w-3.5 h-3.5" /> Finish
          </button>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ══════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden animate-fade-in">

        {/* ─── MCQ SECTION ─────────────────────────────── */}
        {activeSection === 'mcq' && (
          <div className="flex-1 flex">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto">
                  {currentQuestion ? (
                    <div className="animate-fade-in" key={currentQuestion.id}>
                      <div className="flex items-center gap-3 mb-6">
                        <span className="text-xs font-mono bg-slate-800/60 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-700/30">Q{currentQIndex + 1}/{mcqQuestions.length}</span>
                        <span className="text-xs bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-lg border border-blue-500/15 font-medium">{currentQuestion.marks} marks</span>
                      </div>
                      <h2 className="text-2xl font-bold text-white mb-3 leading-tight">{currentQuestion.title}</h2>
                      <div className="mb-8">
                        {currentQuestion.description.split('\n').map((line, i) => (
                          <p key={i} className="text-slate-400 leading-relaxed my-0.5 text-[15px]">{line || <br />}</p>
                        ))}
                      </div>
                      {currentQuestion.mcqOptions && (
                        <div className="space-y-3">
                          {currentQuestion.mcqOptions.map((opt, idx) => {
                            const isSelected = mcqAnswers[currentQuestion.id] === opt.id;
                            return (
                              <div key={opt.id} onClick={() => !mcqSubmitted && handleSaveMcq(currentQuestion.id, opt.id)}
                                className={`group flex items-center gap-4 p-5 rounded-2xl cursor-pointer transition-all duration-300 border ${isSelected ? 'bg-blue-500/10 border-blue-500/30 shadow-lg shadow-blue-500/5' : 'bg-slate-800/30 border-slate-700/20 hover:bg-slate-800/50 hover:border-slate-600/40'} ${mcqSubmitted ? 'pointer-events-none opacity-60' : ''}`}>
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 transition-all ${isSelected ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30' : 'bg-slate-700/50 text-slate-400 group-hover:bg-slate-600/50 border border-slate-600/30'}`}>
                                  {String.fromCharCode(65 + idx)}
                                </div>
                                <span className={`text-base transition-colors ${isSelected ? 'text-white font-medium' : 'text-slate-300 group-hover:text-white'}`}>{opt.text}</span>
                                {isSelected && <CheckCircle className="w-5 h-5 text-blue-400 ml-auto" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : <div className="text-slate-500 text-center py-20">No questions available</div>}
                </div>
              </div>
              <div className="p-4 glass-strong border-t border-slate-700/20 flex items-center justify-between">
                <div className="flex gap-2">
                  <button onClick={() => setCurrentQIndex(Math.max(0, currentQIndex - 1))} disabled={currentQIndex === 0} className="btn-secondary text-sm py-2 flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> Previous</button>
                  <button onClick={() => setCurrentQIndex(Math.min(mcqQuestions.length - 1, currentQIndex + 1))} disabled={currentQIndex === mcqQuestions.length - 1} className="btn-secondary text-sm py-2 flex items-center gap-1.5">Next <ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500">{answeredCount}/{mcqQuestions.length} answered</span>
                  {!mcqSubmitted ? (
                    <button onClick={handleSubmitMcq} disabled={submitting} className="bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 px-5 rounded-xl font-medium flex items-center gap-2 transition-all disabled:opacity-50">
                      <Send className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit MCQ'}
                    </button>
                  ) : codingUnlocked ? (
                    <button onClick={handleSwitchToCoding} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 px-5 rounded-xl font-medium flex items-center gap-2 transition-all">
                      <ArrowRight className="w-4 h-4" /> Go to Coding
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {/* Right sidebar */}
            <div className="w-60 glass border-l border-slate-700/20 flex flex-col shrink-0">
              <div className="p-4 border-b border-slate-700/20">
                <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Questions</h3>
                <div className="grid grid-cols-5 gap-2">
                  {mcqQuestions.map((q, i) => (
                    <button key={q.id} onClick={() => setCurrentQIndex(i)}
                      className={`w-9 h-9 rounded-xl text-xs font-medium transition-all ${i === currentQIndex ? 'bg-blue-600 text-white shadow-md scale-105' : mcqAnswers[q.id] ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/40 text-slate-500 border border-slate-700/30'}`}>{i + 1}</button>
                  ))}
                </div>
              </div>
              {mcqResult && (
                <div className="p-4 border-t border-slate-700/20">
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Score</span><span className="font-bold text-blue-400">{mcqResult.mcqScore}/{mcqResult.totalMcqMarks}</span></div>
                    <div className={`p-2.5 rounded-xl text-center font-semibold ${mcqResult.cutoffMet ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {mcqResult.cutoffMet ? 'Cutoff Cleared' : 'Below Cutoff'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── CODING SECTION ──────────────────────────── */}
        {activeSection === 'coding' && codingUnlocked && (
          <>
            <div className="w-[400px] glass border-r border-slate-700/20 flex flex-col shrink-0">
              {currentQuestion && <QuestionPanel question={currentQuestion} />}
              <div className="p-3 border-t border-slate-700/20 flex justify-between">
                <button onClick={() => setCurrentQIndex(Math.max(0, currentQIndex - 1))} disabled={currentQIndex === 0} className="btn-secondary text-sm py-1.5 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Prev</button>
                <button onClick={() => setCurrentQIndex(Math.min(codingQuestions.length - 1, currentQIndex + 1))} disabled={currentQIndex === codingQuestions.length - 1} className="btn-secondary text-sm py-1.5 flex items-center gap-1">Next <ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              {currentQuestion && currentQuestion.type === 'coding' && (
                <>
                  <div className="h-12 glass-strong border-b border-slate-700/20 flex items-center px-4 justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <select value={langId[currentQuestion.id] || 71}
                        onChange={(e) => setLangId((p) => ({ ...p, [currentQuestion.id]: Number(e.target.value) }))}
                        className="bg-slate-800/50 border border-slate-700/40 rounded-xl px-3 py-1.5 text-sm text-slate-300">
                        {(currentQuestion.allowedLanguages.length > 0 ? currentQuestion.allowedLanguages : Object.keys(LANGUAGES).map(Number))
                          .map((id) => (<option key={id} value={id}>{LANGUAGES[id]?.name || `Lang ${id}`}</option>))}
                      </select>
                      {lastSaved && (
                        <span className="text-[11px] text-slate-600 flex items-center gap-1">
                          <Save className="w-3 h-3" /> Saved {lastSaved}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleResetCode} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-all" title="Reset code">
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-600 border-r border-slate-700/30 pr-2 mr-1">
                        <Keyboard className="w-3 h-3" /> Ctrl+Enter: Run
                      </div>
                      <button onClick={handleRunCode} disabled={running}
                        className="btn-secondary text-sm py-1.5 flex items-center gap-1.5">
                        <Play className="w-4 h-4" /> {running ? 'Running...' : 'Run'}
                      </button>
                      <button onClick={handleSubmitCoding} disabled={submitting}
                        className="btn-primary text-sm py-1.5 flex items-center gap-1.5">
                        <Send className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit'}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-hidden">
                      <CodeEditor language={LANGUAGES[langId[currentQuestion.id] || 71]?.monacoId || 'python'}
                        value={code[currentQuestion.id] || ''}
                        onChange={(val) => setCode((p) => ({ ...p, [currentQuestion.id]: val || '' }))} />
                    </div>
                    <div className="h-[250px] border-t border-slate-700/20 shrink-0">
                      <OutputPanel output={output} customInput={customInput} onCustomInputChange={setCustomInput}
                        activeTab={outputTab} onTabChange={setOutputTab} submission={submissions[currentQuestion.id]} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ─── CODING LOCKED ──────────────────────────── */}
        {activeSection === 'coding' && !codingUnlocked && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md animate-fade-in">
              <div className="w-20 h-20 bg-slate-800/50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-slate-700/30">
                <Lock className="w-10 h-10 text-slate-500" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Coding Section Locked</h2>
              <p className="text-slate-400 mb-8">
                {mcqSubmitted ? `Your MCQ score did not meet the ${test?.mcqCutoffPercent}% cutoff.` : `Complete MCQ first. Need ${test?.mcqCutoffPercent || 40}% to unlock.`}
              </p>
              {!mcqSubmitted && (
                <button onClick={() => { setActiveSection('mcq'); setCurrentQIndex(0); }} className="btn-primary flex items-center gap-2 mx-auto py-3 px-6">
                  <ArrowRight className="w-5 h-5" /> Go to MCQ
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {confirmState.open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeConfirm}>
          <div className="card max-w-md w-full mx-4 border border-dark-700" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">{confirmState.title}</h3>
            <p className="text-dark-300 text-sm mb-5">{confirmState.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={closeConfirm} className="btn-secondary">Cancel</button>
              <button
                onClick={confirmState.onConfirm}
                className={confirmState.variant === 'danger'
                  ? 'px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium'
                  : 'btn-primary'}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
