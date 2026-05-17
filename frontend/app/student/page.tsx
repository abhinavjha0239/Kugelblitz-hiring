'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { testsService } from '@/services/tests.service';
import { resultsService } from '@/services/results.service';
import { testSessionService } from '@/services/test-session.service';
import { useAuth } from '@/hooks/useAuth';
import { ExamPaperStatus, Test } from '@/types';
import {
  Clock, FileText, Play, CheckCircle, Lock, ListChecks, Code,
  Search, ArrowRight, Zap, Trophy, Target, BarChart3,
  Sparkles, ChevronRight, SlidersHorizontal, Shield,
  AlertTriangle, TrendingUp, Eye, Clipboard, Maximize2,
  Monitor, Wifi, X, Info,
} from 'lucide-react';

type TabKey = 'all' | 'active' | 'completed';

export default function StudentDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [tests, setTests] = useState<Test[]>([]);
  const [participations, setParticipations] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [paperStatusByTest, setPaperStatusByTest] = useState<Record<string, ExamPaperStatus[]>>({});
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [durationFilter, setDurationFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [previewTest, setPreviewTest] = useState<Test | null>(null);
  const [systemCheckDone, setSystemCheckDone] = useState(false);
  const [systemChecks, setSystemChecks] = useState({ browser: false, internet: false, fullscreen: false });

  useEffect(() => {
    const load = async () => {
      try {
        const activeTests = await testsService.getActive();
        setTests(activeTests);
        // Fetch participation + paper status in parallel — was 2N sequential round-trips.
        const results = await Promise.all(
          activeTests.map(async (t) => {
            const [p, s] = await Promise.all([
              resultsService.getParticipation(t.id).catch(() => null),
              testSessionService.getExamStatus(t.id).catch(() => null) as Promise<any>,
            ]);
            return { id: t.id, p, s };
          }),
        );
        const parts: Record<string, any> = {};
        const statuses: Record<string, ExamPaperStatus[]> = {};
        for (const { id, p, s } of results) {
          if (p) parts[id] = p;
          if (Array.isArray(s?.papers) && s.papers.length > 0) statuses[id] = s.papers;
        }
        setParticipations(parts);
        setPaperStatusByTest(statuses);
      } catch (err: any) { toast.error(err.message); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const getStatus = useCallback((testId: string) => {
    const p = participations[testId];
    return p ? p.status : 'not_started';
  }, [participations]);

  const getDifficulty = (test: Test) => {
    if (test.durationMinutes >= 90) return 'hard';
    if (test.durationMinutes >= 45) return 'medium';
    return 'easy';
  };

  // ─── Stats ─────────────────────────────────────────────
  const stats = useMemo(() => {
    const completed = tests.filter((t) => {
      const s = getStatus(t.id);
      return s === 'submitted' || s === 'timed_out';
    });
    const totalScore = completed.reduce((s, t) => s + Number(participations[t.id]?.totalScore || 0), 0);
    const totalMax = completed.reduce((s, t) => s + (t.totalMarks || 0), 0);
    const mcqTotal = completed.reduce((s, t) => s + Number(participations[t.id]?.mcqScore || 0), 0);
    const codingTotal = completed.reduce((s, t) => s + Number(participations[t.id]?.codingScore || 0), 0);
    const inProgress = tests.filter((t) => getStatus(t.id) === 'in_progress').length;

    return {
      total: tests.length,
      completed: completed.length,
      inProgress,
      avgScore: completed.length > 0 && totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : -1,
      mcqAvg: completed.length > 0 ? Math.round(mcqTotal / completed.length) : 0,
      codingAvg: completed.length > 0 ? Math.round(codingTotal / completed.length) : 0,
      bestScore: completed.length > 0 ? Math.max(...completed.map((t) => {
        const p = participations[t.id];
        return t.totalMarks > 0 ? Math.round((Number(p?.totalScore || 0) / t.totalMarks) * 100) : 0;
      })) : 0,
    };
  }, [tests, participations, getStatus]);

  const activeTest = useMemo(() => tests.find((t) => getStatus(t.id) === 'in_progress'), [tests, getStatus]);

  const filteredTests = useMemo(() => {
    let result = [...tests];
    if (activeTab === 'active') result = result.filter((t) => { const s = getStatus(t.id); return s === 'not_started' || s === 'in_progress'; });
    else if (activeTab === 'completed') result = result.filter((t) => { const s = getStatus(t.id); return s === 'submitted' || s === 'timed_out'; });
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter((t) => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)); }
    if (durationFilter !== 'all') {
      if (durationFilter === 'short') result = result.filter((t) => t.durationMinutes < 45);
      else if (durationFilter === 'medium') result = result.filter((t) => t.durationMinutes >= 45 && t.durationMinutes < 90);
      else if (durationFilter === 'long') result = result.filter((t) => t.durationMinutes >= 90);
    }
    return result;
  }, [tests, getStatus, activeTab, searchQuery, durationFilter]);

  const getScorePercent = (testId: string, totalMarks: number) => {
    const p = participations[testId];
    if (!p || !totalMarks) return 0;
    return Math.round((Number(p.totalScore) / totalMarks) * 100);
  };

  // Compute "attempted total" — only sum totalMarks for papers actually submitted.
  // If exam ended with some papers locked_fail (cutoff failed), those papers don't count toward the denominator.
  const getAttemptedDenominator = (testId: string, fallbackTotal: number): { denom: number; partial: boolean } => {
    const papers = paperStatusByTest[testId];
    if (!papers || papers.length === 0) return { denom: fallbackTotal, partial: false };
    const submitted = papers.filter((p) => p.status === 'submitted');
    if (submitted.length === 0) return { denom: fallbackTotal, partial: false };
    const submittedTotal = submitted.reduce((s, p) => s + Number(p.totalMarks || 0), 0);
    if (submittedTotal === 0) return { denom: fallbackTotal, partial: false };
    const partial = submitted.length < papers.length;
    return { denom: submittedTotal, partial };
  };

  // ─── System Check ──────────────────────────────────────
  const runSystemCheck = useCallback(async () => {
    const browser = typeof document !== 'undefined' && typeof document.createElement === 'function';
    const internet = navigator.onLine;
    const fullscreen = document.fullscreenEnabled;
    setSystemChecks({ browser, internet, fullscreen });
    setSystemCheckDone(true);
  }, []);

  const handleStartWithCheck = useCallback(async (testId: string) => {
    await runSystemCheck();
    setTimeout(() => { router.push(`/test/${testId}`); }, 800);
  }, [router, runSystemCheck]);

  const diffBadge = (diff: string) => {
    const styles: Record<string, string> = {
      easy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      hard: 'bg-red-500/10 text-red-400 border-red-500/20',
    };
    return <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${styles[diff]}`}>{diff}</span>;
  };

  // ─── Skeleton Loader ───────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
        <div className="space-y-2">
          <div className="h-8 w-72 bg-slate-800/50 rounded-xl animate-pulse" />
          <div className="h-4 w-48 bg-slate-800/30 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-800/30 rounded-2xl animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 bg-slate-800/20 rounded-2xl animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">

      {/* ═══ WELCOME HEADER ════════════════════════════════ */}
      <div>
        <p className="text-slate-500 text-sm mb-1">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},</p>
        <h1 className="text-2xl lg:text-3xl font-bold text-white">
          {user?.firstName} {user?.lastName}
        </h1>
        <p className="text-slate-400 mt-1 text-sm">
          {stats.inProgress > 0
            ? 'You have an assessment in progress — resume below.'
            : tests.length === 0
              ? 'No assessments assigned to you yet. Check back when your recruiter sends an invite.'
              : stats.completed === tests.length
                ? `${stats.completed} assessment${stats.completed > 1 ? 's' : ''} completed.`
                : `${tests.length - stats.completed} assessment${tests.length - stats.completed > 1 ? 's' : ''} ready for you.`}
        </p>
      </div>

      {/* ═══ STAT CARDS ════════════════════════════════════ */}
      {tests.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {[
            { icon: Target, label: 'Assigned', value: String(stats.total), color: 'blue' },
            { icon: Trophy, label: 'Completed', value: String(stats.completed), color: 'emerald' },
            { icon: BarChart3, label: 'Avg score', value: stats.avgScore === -1 ? '—' : `${stats.avgScore}%`, color: 'amber' },
            { icon: TrendingUp, label: 'Best score', value: stats.completed > 0 ? `${stats.bestScore}%` : '—', color: 'purple' },
          ].map((s, i) => (
            <div key={i} className="relative overflow-hidden glass rounded-2xl p-4 lg:p-5 hover:border-slate-600/40 transition-all duration-300 group">
              <div className={`absolute -top-4 -right-4 w-16 h-16 bg-${s.color}-500/5 rounded-full group-hover:bg-${s.color}-500/10 transition-colors`} />
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 bg-${s.color}-500/10 rounded-xl flex items-center justify-center shrink-0`}>
                  <s.icon className={`w-5 h-5 text-${s.color}-400`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl lg:text-2xl font-bold text-white truncate">{s.value}</p>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ PERFORMANCE INSIGHTS (if completed tests) ════ */}
      {stats.completed > 0 && (
        <div className="glass rounded-2xl p-5 lg:p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Performance Insights</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-800/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">Overall</span>
                <span className="text-sm font-bold text-blue-400">{stats.avgScore}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700" style={{ width: `${stats.avgScore}%` }} />
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 flex items-center gap-1"><ListChecks className="w-3 h-3" /> MCQ Avg</span>
                <span className={`text-sm font-bold ${stats.mcqAvg > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{stats.mcqAvg} pts</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (stats.mcqAvg / 50) * 100)}%` }} />
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 flex items-center gap-1"><Code className="w-3 h-3" /> Coding Avg</span>
                <span className={`text-sm font-bold ${stats.codingAvg > 0 ? 'text-purple-400' : 'text-slate-500'}`}>{stats.codingAvg} pts</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (stats.codingAvg / 50) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ RESUME ACTIVE TEST BANNER ═════════════════════ */}
      {activeTest && (
        <div className="relative overflow-hidden bg-gradient-to-r from-blue-600/10 via-slate-900/80 to-slate-900/80 border border-blue-500/20 rounded-2xl p-6 lg:p-8">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full -translate-y-32 translate-x-32" />
          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full animate-pulse">
                  <Zap className="w-3 h-3" /> IN PROGRESS
                </span>
                {diffBadge(getDifficulty(activeTest))}
              </div>
              <h2 className="text-xl lg:text-2xl font-bold text-white mb-2">{activeTest.title}</h2>
              <p className="text-slate-400 text-sm mb-4 max-w-xl">{activeTest.description || 'Continue your assessment'}</p>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {activeTest.durationMinutes} min</span>
                <span className="flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> {activeTest.totalMarks} marks</span>
                {participations[activeTest.id] && (
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Shield className="w-3.5 h-3.5" /> MCQ {participations[activeTest.id].mcqSubmitted ? 'Done' : 'Pending'}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => router.push(`/test/${activeTest.id}`)}
              className="shrink-0 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-3.5 px-8 rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98]">
              <Play className="w-5 h-5" /> Resume Test <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ═══ TABS + SEARCH + FILTER (only meaningful when many tests) ═══ */}
      {tests.length > 1 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-0.5 glass rounded-xl p-1">
              {([
                { key: 'all' as TabKey, label: 'All', count: tests.length },
                { key: 'active' as TabKey, label: 'Active', count: tests.filter((t) => { const s = getStatus(t.id); return s === 'not_started' || s === 'in_progress'; }).length },
                { key: 'completed' as TabKey, label: 'Completed', count: stats.completed },
              ]).map((tab) => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.key ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}>
                  {tab.label}
                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-white/20' : 'bg-slate-700/50'}`}>{tab.count}</span>
                </button>
              ))}
            </div>
            {tests.length >= 5 && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input type="text" placeholder="Search tests..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-slate-900/50 border border-slate-700/40 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-48 lg:w-64 transition-all" />
                </div>
                <button onClick={() => setShowFilters(!showFilters)}
                  className={`p-2.5 rounded-xl border transition-all ${showFilters || durationFilter !== 'all' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-slate-900/50 border-slate-700/40 text-slate-500 hover:text-white'}`}>
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          {showFilters && (
            <div className="flex items-center gap-3 glass rounded-xl p-3">
              <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Duration:</span>
              {[{ key: 'all', label: 'All' }, { key: 'short', label: '< 45m' }, { key: 'medium', label: '45-90m' }, { key: 'long', label: '90m+' }].map((f) => (
                <button key={f.key} onClick={() => setDurationFilter(f.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${durationFilter === f.key ? 'bg-blue-600 text-white' : 'bg-slate-800/40 text-slate-400 hover:text-white'}`}>{f.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section heading when there's exactly one test (no tabs shown) */}
      {tests.length > 0 && tests.length <= 1 && !activeTest && (
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your assessment</h2>
      )}

      {/* ═══ TEST CARDS ════════════════════════════════════ */}
      {filteredTests.length === 0 ? (
        <div className="text-center py-20 glass rounded-2xl border-dashed">
          <div className="w-16 h-16 bg-slate-800/40 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-300 text-lg font-medium">
            {tests.length === 0 ? 'No assessments yet' : 'Nothing matches your filters'}
          </p>
          <p className="text-slate-500 text-sm mt-1 max-w-sm mx-auto">
            {tests.length === 0
              ? 'Your recruiter will email you a magic link when an assessment is ready. The link will sign you in directly — no password needed.'
              : searchQuery
                ? 'Try a different search term, or clear filters.'
                : activeTab === 'completed' ? 'You haven\'t completed any tests yet.' : 'Switch tabs to see other tests.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {filteredTests.map((test) => {
            const status = getStatus(test.id);
            const p = participations[test.id];
            const hasSections = (test as any).hasSections;
            const diff = getDifficulty(test);
            const scorePercent = getScorePercent(test.id, test.totalMarks);
            const isCompleted = status === 'submitted' || status === 'timed_out';
            const isActive = status === 'in_progress';

            return (
              <div key={test.id}
                className={`group relative bg-slate-900/40 backdrop-blur-sm border rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20 ${
                  isActive ? 'border-blue-500/25 hover:border-blue-500/40' : isCompleted ? 'border-emerald-500/15 hover:border-emerald-500/30' : 'border-slate-700/30 hover:border-slate-600/50'
                }`}>
                <div className={`h-0.5 w-full ${isActive ? 'bg-gradient-to-r from-blue-500 to-purple-500' : isCompleted ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-slate-700/50 to-slate-600/50'}`} />

                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {diffBadge(diff)}
                      {isActive && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Live</span>}
                      {isCompleted && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" /> Done</span>}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setPreviewTest(test); }} className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-800/50 transition-all opacity-0 group-hover:opacity-100">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h3 className="text-base font-semibold text-slate-200 mb-1.5 group-hover:text-white transition-colors line-clamp-1">{test.title}</h3>
                  <p className="text-sm text-slate-500 mb-4 line-clamp-2 min-h-[2.5rem]">{test.description || 'No description available'}</p>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {hasSections && (<><span className="inline-flex items-center gap-1 text-[11px] bg-slate-800/50 text-slate-400 px-2 py-1 rounded-lg"><ListChecks className="w-3 h-3 text-blue-400" /> MCQ</span><span className="inline-flex items-center gap-1 text-[11px] bg-slate-800/50 text-slate-400 px-2 py-1 rounded-lg"><Code className="w-3 h-3 text-purple-400" /> Coding</span></>)}
                    <span className="inline-flex items-center gap-1 text-[11px] bg-slate-800/50 text-slate-400 px-2 py-1 rounded-lg"><Clock className="w-3 h-3" /> {test.durationMinutes}m</span>
                    <span className="inline-flex items-center gap-1 text-[11px] bg-slate-800/50 text-slate-400 px-2 py-1 rounded-lg"><Target className="w-3 h-3" /> {test.totalMarks} pts</span>
                  </div>

                  {paperStatusByTest[test.id]?.length > 0 && (
                    <div className="mb-4 bg-slate-800/20 rounded-xl p-3 border border-slate-700/20">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Paper Flow</p>
                      <div className="space-y-1.5">
                        {paperStatusByTest[test.id].map((paper) => (
                          <div key={paper.paperId} className="flex items-center justify-between text-xs">
                            <span className="text-slate-300">
                              {paper.name}
                            </span>
                            <span className={paper.locked ? 'text-slate-500' : paper.status === 'submitted' ? 'text-emerald-400' : 'text-blue-400'}>
                              {paper.locked ? 'Locked' : paper.status.replace('_', ' ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Score + Proctoring for completed */}
                  {isCompleted && p && (
                    <div className="mb-4 space-y-3">
                      {(() => {
                        const { denom, partial } = getAttemptedDenominator(test.id, test.totalMarks);
                        const score = Number(p.totalScore);
                        const pct = denom > 0 ? Math.round((score / denom) * 100) : 0;
                        return (
                          <div>
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-slate-500">Score{partial && <span className="ml-1 text-amber-400">(attempted papers only)</span>}</span>
                              <span className="font-mono font-semibold text-emerald-400">{score.toFixed(0)}/{denom} ({pct}%)</span>
                            </div>
                            <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${pct >= 70 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : pct >= 40 ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-red-500 to-red-400'}`} style={{ width: `${pct}%` }} />
                            </div>
                            {partial && (
                              <p className="text-[10px] text-slate-500 mt-1">
                                Some papers locked due to cutoff — denominator excludes them.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-600">MCQ: <span className="text-slate-400">{Number(p.mcqScore).toFixed(0)}</span></span>
                        <span className="text-slate-600">Coding: <span className="text-slate-400">{Number(p.codingScore).toFixed(0)}</span></span>
                        {p.riskScore > 0 && (
                          <span className={`flex items-center gap-1 ${p.riskScore >= 30 ? 'text-red-400' : p.riskScore >= 15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            <Shield className="w-3 h-3" /> {p.riskScore >= 30 ? 'High' : p.riskScore >= 15 ? 'Med' : 'Low'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {isCompleted ? (
                    <button onClick={() => router.push(`/student/results/${test.id}`)}
                      className="w-full py-2.5 rounded-xl text-sm font-medium bg-slate-800/40 text-slate-400 hover:bg-slate-700/50 hover:text-white transition-all duration-200 flex items-center justify-center gap-2 border border-slate-700/30 hover:border-slate-600/50">
                      <BarChart3 className="w-4 h-4" /> View Results
                    </button>
                  ) : isActive ? (
                    <button onClick={() => router.push(`/test/${test.id}`)}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/15">
                      <Play className="w-4 h-4" /> Resume Test <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button onClick={() => setPreviewTest(test)}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/15 group-hover:shadow-blue-500/25">
                      <Sparkles className="w-4 h-4" /> Start Test
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ TEST PREVIEW MODAL ════════════════════════════ */}
      {previewTest && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => { setPreviewTest(null); setSystemCheckDone(false); }}>
          <div className="glass-strong rounded-3xl p-6 lg:p-8 max-w-lg w-full shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {diffBadge(getDifficulty(previewTest))}
                  {(previewTest as any).hasSections && <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">MCQ + Coding</span>}
                </div>
                <h2 className="text-xl font-bold text-white">{previewTest.title}</h2>
              </div>
              <button onClick={() => { setPreviewTest(null); setSystemCheckDone(false); }} className="p-2 rounded-xl hover:bg-slate-800/50 text-slate-500 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-slate-400 text-sm mb-6 leading-relaxed">{previewTest.description || 'No description available'}</p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-slate-800/30 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-white">{previewTest.durationMinutes}</p>
                <p className="text-[11px] text-slate-500">Minutes</p>
              </div>
              <div className="bg-slate-800/30 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-white">{previewTest.totalMarks}</p>
                <p className="text-[11px] text-slate-500">Total Marks</p>
              </div>
            </div>

            {(previewTest as any).hasSections && (
              <div className="bg-slate-800/20 rounded-xl p-4 mb-6 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Sections</p>
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <ListChecks className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>Section 1: MCQ (Aptitude + Reasoning)</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <Code className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Section 2: Coding (unlocked after MCQ cutoff)</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-amber-400">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Cutoff: {(previewTest as any).mcqCutoffPercent}% to unlock coding</span>
                </div>
              </div>
            )}

            {paperStatusByTest[previewTest.id]?.length > 0 && (
              <div className="bg-slate-800/20 rounded-xl p-4 mb-6 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Paper Sequence</p>
                {paperStatusByTest[previewTest.id].map((paper) => (
                  <div key={paper.paperId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">
                      {paper.name} ({paper.durationMinutes} min)
                    </span>
                    <span className={paper.locked ? 'text-slate-500' : 'text-blue-400'}>
                      {paper.locked ? 'Locked' : 'Unlocked'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-slate-800/20 rounded-xl p-4 mb-6 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Rules</p>
              <div className="flex items-center gap-3 text-sm text-slate-300"><Maximize2 className="w-4 h-4 text-slate-500 shrink-0" /> Fullscreen mode required</div>
              <div className="flex items-center gap-3 text-sm text-slate-300"><Eye className="w-4 h-4 text-slate-500 shrink-0" /> Tab switches are monitored</div>
              <div className="flex items-center gap-3 text-sm text-slate-300"><Clipboard className="w-4 h-4 text-slate-500 shrink-0" /> Copy/paste events are logged</div>
              <div className="flex items-center gap-3 text-sm text-slate-300"><Clock className="w-4 h-4 text-slate-500 shrink-0" /> Auto-submit when time expires</div>
            </div>

            {/* System Check */}
            {systemCheckDone && (
              <div className="bg-slate-800/20 rounded-xl p-4 mb-6 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">System Check</p>
                {[
                  { label: 'Browser Compatible', ok: systemChecks.browser, icon: Monitor },
                  { label: 'Internet Connected', ok: systemChecks.internet, icon: Wifi },
                  { label: 'Fullscreen Supported', ok: systemChecks.fullscreen, icon: Maximize2 },
                ].map((c) => (
                  <div key={c.label} className="flex items-center gap-3 text-sm">
                    {c.ok ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                    <span className={c.ok ? 'text-slate-300' : 'text-amber-400'}>{c.label}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => handleStartWithCheck(previewTest.id)}
              className="w-full py-3 rounded-xl font-semibold bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30">
              <Play className="w-5 h-5" /> Begin Assessment <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
