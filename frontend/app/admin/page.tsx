'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { testsService } from '@/services/tests.service';
import { Test } from '@/types';
import { formatDate } from '@/lib/utils';
import {
  Plus, FileText, Activity, Trash2, Mail, ListChecks, Layers,
  Eye, Calendar, Clock, ShieldAlert, BarChart3, AlertCircle, CheckCircle2, Save, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '@/components/ConfirmModal';

export default function AdminDashboard() {
  const [tests, setTests] = useState<Test[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const { node: confirmModal, ask: askConfirm } = useConfirm();

  useEffect(() => {
    loadTests();
  }, []);

  const loadTests = async () => {
    try {
      const res = await testsService.getAll();
      setTests(res.tests);
      setTotal(res.total);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await askConfirm({
      title: 'Delete this test?',
      message: 'All questions, papers, and invites for this test will also be removed. This cannot be undone.',
      confirmLabel: 'Delete test',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await testsService.delete(id);
      toast.success('Test deleted');
      loadTests();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const sections = useMemo(() => {
    const now = Date.now();
    const scheduled: Test[] = [];
    const live: Test[] = [];
    const closed: Test[] = [];
    const drafts: Test[] = [];
    for (const t of tests) {
      if (!t.isActive) {
        drafts.push(t);
        continue;
      }
      const startsMs = t.startsAt ? new Date(t.startsAt).getTime() : null;
      const endsMs = t.endsAt ? new Date(t.endsAt).getTime() : null;
      if (startsMs && now < startsMs) scheduled.push(t);
      else if (endsMs && now > endsMs) closed.push(t);
      else live.push(t);
    }
    return { live, scheduled, closed, drafts };
  }, [tests]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-dark-400 mt-1 text-sm">Manage assessments, invites, and results</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/tests/new" className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" /> Create Test
          </Link>
        </div>
      </div>

      {/* ─── Stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<FileText className="w-5 h-5 text-accent" />} bg="bg-accent/10" label="Total tests" value={total} />
        <StatCard icon={<Activity className="w-5 h-5 text-success" />} bg="bg-success/10" label="Live now" value={sections.live.length} />
        <StatCard icon={<Calendar className="w-5 h-5 text-blue-400" />} bg="bg-blue-500/10" label="Scheduled" value={sections.scheduled.length} />
        <StatCard icon={<Clock className="w-5 h-5 text-dark-400" />} bg="bg-dark-700" label="Drafts" value={sections.drafts.length} />
      </div>

      {/* ─── Loading / Empty ─────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12 text-dark-400">Loading tests…</div>
      ) : tests.length === 0 ? (
        <div className="card text-center py-12 border-dashed">
          <FileText className="w-16 h-16 text-dark-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-1">No tests yet</h2>
          <p className="text-dark-400 mb-4 text-sm">Create your first assessment to send out magic-link invites.</p>
          <Link href="/admin/tests/new" className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-5 h-5" /> Create your first test
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.live.length > 0 && (
            <Section title="Live now" subtitle="Open for candidates right now" tests={sections.live} onDelete={handleDelete} onChange={loadTests} />
          )}
          {sections.scheduled.length > 0 && (
            <Section title="Scheduled" subtitle="Window starts in the future" tests={sections.scheduled} onDelete={handleDelete} onChange={loadTests} />
          )}
          {sections.drafts.length > 0 && (
            <Section title="Drafts (inactive)" subtitle="Toggle isActive on a test to publish it" tests={sections.drafts} onDelete={handleDelete} onChange={loadTests} />
          )}
          {sections.closed.length > 0 && (
            <Section title="Closed" subtitle="Window has ended — results available" tests={sections.closed} onDelete={handleDelete} onChange={loadTests} />
          )}
        </div>
      )}
      {confirmModal}
    </div>
  );
}

function StatCard({ icon, bg, label, value }: { icon: React.ReactNode; bg: string; label: string; value: number }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 ${bg} rounded-lg shrink-0`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-dark-400 mt-1.5 uppercase tracking-wider">{label}</p>
      </div>
    </div>
  );
}

function Section({
  title, subtitle, tests, onDelete, onChange,
}: { title: string; subtitle: string; tests: Test[]; onDelete: (id: string) => void; onChange: () => void }) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider">{title}</h2>
        <p className="text-xs text-dark-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {tests.map((t) => (
          <TestCard key={t.id} test={t} onDelete={onDelete} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function TestCard({ test, onDelete, onChange }: { test: Test; onDelete: (id: string) => void; onChange: () => void }) {
  const startsAt = test.startsAt ? new Date(test.startsAt) : null;
  const endsAt = test.endsAt ? new Date(test.endsAt) : null;
  const hasSchedule = !!(startsAt || endsAt);
  const { node: cardConfirmModal, ask: askConfirm } = useConfirm();

  // ─── Inline schedule editor ───
  const [editingSched, setEditingSched] = useState(!hasSchedule); // auto-open when missing
  const [savingSched, setSavingSched] = useState(false);
  const toLocalInput = (d: Date | null) => {
    if (!d) return '';
    const tzOffset = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };
  const [draftStart, setDraftStart] = useState(toLocalInput(startsAt));
  const [draftEnd, setDraftEnd] = useState(toLocalInput(endsAt));

  const saveSchedule = async () => {
    setSavingSched(true);
    try {
      await testsService.update(test.id, {
        startsAt: draftStart ? new Date(draftStart).toISOString() : null,
        endsAt: draftEnd ? new Date(draftEnd).toISOString() : null,
      } as any);
      toast.success('Schedule saved');
      setEditingSched(false);
      onChange();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save schedule');
    } finally {
      setSavingSched(false);
    }
  };
  const clearSchedule = async () => {
    const ok = await askConfirm({
      title: 'Remove the schedule?',
      message: 'The test will become open as soon as it is Active. Candidates with magic-link invites will be able to start immediately.',
      confirmLabel: 'Remove schedule',
      variant: 'danger',
    });
    if (!ok) return;
    setDraftStart('');
    setDraftEnd('');
    setSavingSched(true);
    try {
      await testsService.update(test.id, { startsAt: null, endsAt: null } as any);
      toast.success('Schedule cleared');
      onChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingSched(false);
    }
  };

  const now = Date.now();
  const startsMs = startsAt?.getTime();
  const endsMs = endsAt?.getTime();
  const scheduleStatus =
    !hasSchedule ? 'none' :
    startsMs && now < startsMs ? 'upcoming' :
    endsMs && now > endsMs ? 'closed' : 'live';

  return (
    <div className="card hover:border-dark-600 transition-colors">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold truncate">{test.title}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              test.isActive ? 'bg-success/10 text-success' : 'bg-dark-700 text-dark-400'
            }`}>
              {test.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {test.description && <p className="text-sm text-dark-400 mt-1 line-clamp-1">{test.description}</p>}
          <div className="flex items-center gap-4 mt-2 text-xs text-dark-500 flex-wrap">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {test.durationMinutes} min</span>
            <span>{test.totalMarks} marks</span>
            <span className="text-dark-700">·</span>
            <span>{formatDate(test.createdAt)}</span>
          </div>
        </div>
        <button onClick={() => onDelete(test.id)} className="p-2 hover:bg-dark-700 rounded-lg shrink-0" title="Delete test">
          <Trash2 className="w-4 h-4 text-danger" />
        </button>
      </div>

      {/* ─── Schedule banner ─────────────────────────────── */}
      <div className={`rounded-lg border p-3 mb-3 ${
        scheduleStatus === 'none' ? 'bg-amber-900/20 border-amber-700/40' :
        scheduleStatus === 'upcoming' ? 'bg-blue-900/20 border-blue-700/40' :
        scheduleStatus === 'live' ? 'bg-emerald-900/20 border-emerald-700/40' :
        'bg-dark-800 border-dark-700'
      }`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            {scheduleStatus === 'none' ? <AlertCircle className="w-4 h-4 text-amber-400" /> :
              scheduleStatus === 'live' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
              <Calendar className="w-4 h-4 text-blue-400" />}
            <span className={`font-medium uppercase tracking-wider text-[11px] ${
              scheduleStatus === 'none' ? 'text-amber-300' :
              scheduleStatus === 'upcoming' ? 'text-blue-300' :
              scheduleStatus === 'live' ? 'text-emerald-300' : 'text-dark-300'
            }`}>
              {scheduleStatus === 'none' ? 'No schedule set' :
                scheduleStatus === 'upcoming' ? `Opens ${startsAt!.toLocaleString()}` :
                scheduleStatus === 'live' ? `Live${endsAt ? ` until ${endsAt.toLocaleString()}` : ' (no end set)'}` :
                `Closed at ${endsAt!.toLocaleString()}`}
            </span>
          </div>
          <button
            onClick={() => setEditingSched((v) => !v)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            {editingSched ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {editingSched ? 'Hide' : 'Edit schedule'}
          </button>
        </div>

        {editingSched && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-dark-300">
              <span className="block mb-1 font-medium">Window starts at</span>
              <input
                type="datetime-local"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className="input-field text-sm w-full"
              />
            </label>
            <label className="text-xs text-dark-300">
              <span className="block mb-1 font-medium">Window ends at</span>
              <input
                type="datetime-local"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="input-field text-sm w-full"
              />
            </label>
            <div className="md:col-span-2 flex items-center gap-2">
              <button onClick={saveSchedule} disabled={savingSched} className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {savingSched ? 'Saving…' : 'Save schedule'}
              </button>
              {hasSchedule && (
                <button onClick={clearSchedule} disabled={savingSched} className="text-xs text-rose-400 hover:text-rose-300">
                  Clear
                </button>
              )}
              <p className="text-[11px] text-dark-500 ml-auto">
                Magic-link invites use this window. Leave blank for always-open.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/tests/${test.id}/questions`} className="btn-secondary text-xs flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" /> Questions
        </Link>
        <Link href={`/admin/tests/${test.id}/papers`} className="btn-secondary text-xs flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" /> Papers & Sets
        </Link>
        <Link href={`/admin/tests/${test.id}/invites`} className="btn-secondary text-xs flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" /> Invites
        </Link>
        <Link href={`/admin/tests/${test.id}/monitor`} className="btn-secondary text-xs flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" /> Live Monitor
        </Link>
        <Link href={`/admin/results/${test.id}`} className="btn-secondary text-xs flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" /> Results
        </Link>
        <Link href={`/admin/proctoring/${test.id}`} className="btn-secondary text-xs flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-warning" /> Proctoring
        </Link>
      </div>
      {cardConfirmModal}
    </div>
  );
}
