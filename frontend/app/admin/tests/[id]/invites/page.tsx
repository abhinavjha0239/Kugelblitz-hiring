'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Send, RefreshCw, Trash2, Copy, Upload, Mail, Shuffle } from 'lucide-react';
import { magicLinkService, MagicLink, InviteRow, MailQueueStats } from '@/services/magic-link.service';
import { examSetService, ExamSet } from '@/services/exam-set.service';
import { testsService } from '@/services/tests.service';

export default function InvitesPage() {
  const { id: testId } = useParams<{ id: string }>();
  const [test, setTest] = useState<any>(null);
  const [invites, setInvites] = useState<MagicLink[]>([]);
  const [textareaValue, setTextareaValue] = useState('');
  const [csvRows, setCsvRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sets, setSets] = useState<ExamSet[]>([]);
  const [textareaSetId, setTextareaSetId] = useState<string>(''); // '' = auto-pick
  const [mailStats, setMailStats] = useState<MailQueueStats | null>(null);

  useEffect(() => {
    void load();
  }, [testId]);

  // Poll mail-queue stats every 2s while there are pending/active jobs.
  useEffect(() => {
    let id: any;
    const tick = async () => {
      try {
        const s = await magicLinkService.mailQueueStats();
        setMailStats(s);
        const live = (s.waiting || 0) + (s.active || 0) + (s.delayed || 0);
        if (live === 0) {
          // slow down when idle
          if (id) clearInterval(id);
          id = setInterval(tick, 10_000);
        }
      } catch { /* ignore */ }
    };
    void tick();
    id = setInterval(tick, 2_000);
    return () => { if (id) clearInterval(id); };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [t, list, allSets] = await Promise.all([
        testsService.getById(testId).catch(() => null),
        magicLinkService.list(testId),
        examSetService.list(testId),
      ]);
      setTest(t);
      setInvites(list);
      setSets(allSets);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }

  const parsedTextareaRows = useMemo<InviteRow[]>(() => {
    return textareaValue
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((email) => (textareaSetId ? { email, setId: textareaSetId } : { email }));
  }, [textareaValue, textareaSetId]);

  function handleCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return;
      const headerLine = lines[0].toLowerCase();
      const hasHeader = headerLine.includes('email');
      const dataLines = hasHeader ? lines.slice(1) : lines;
      const rows: InviteRow[] = dataLines.map((line) => {
        const cols = line.split(',').map((c) => c.trim());
        const setCode = cols[4];
        const matchedSet = setCode
          ? sets.find(
              (s) =>
                s.code.toUpperCase() === setCode.toUpperCase() ||
                s.name.toLowerCase() === setCode.toLowerCase(),
            )
          : undefined;
        return {
          email: cols[0] ?? '',
          firstName: cols[1] || undefined,
          lastName: cols[2] || undefined,
          mobile: cols[3] || undefined,
          setId: matchedSet?.id,
        };
      }).filter((r) => r.email);
      setCsvRows(rows);
      toast.success(`Parsed ${rows.length} rows from CSV`);
    };
    reader.readAsText(file);
  }

  async function send() {
    const merged = [...parsedTextareaRows, ...csvRows];
    if (merged.length === 0) {
      toast.error('Add at least one email (textarea or CSV)');
      return;
    }
    setSending(true);
    try {
      const res = await magicLinkService.bulkInvite(testId, merged);
      toast.success(`${res.created.length} invites created · ${res.queued} emails queued for background sending`);
      setTextareaValue('');
      setCsvRows([]);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invites');
    } finally {
      setSending(false);
    }
  }

  async function resend(id: string) {
    try {
      const r = await magicLinkService.resend(id);
      toast.success(r.delivered ? 'Email resent' : 'Resend failed; link logged on backend');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this invite? The candidate will not be able to use it again.')) return;
    try {
      await magicLinkService.revoke(id);
      toast.success('Revoked');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function copyLink(token: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/exam/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/admin/tests/${testId}/questions`} className="p-2 hover:bg-dark-800 rounded-lg flex items-center gap-1">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1 className="text-2xl font-bold">Magic-Link Invites</h1>
        {test && <span className="text-dark-400">— {test.title}</span>}
      </div>

      {mailStats && (mailStats.waiting + mailStats.active + mailStats.delayed > 0 || mailStats.failed > 0) && (
        <div className="card mb-6 border border-blue-700/40 bg-blue-950/20">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-blue-300 mb-1 font-semibold">Mail queue</p>
              <p className="text-sm text-dark-200">
                {mailStats.active > 0 ? `Sending ${mailStats.active} now` : 'Idle'}
                {mailStats.waiting > 0 && ` · ${mailStats.waiting} waiting`}
                {mailStats.delayed > 0 && ` · ${mailStats.delayed} delayed (rate-limited)`}
                {mailStats.failed > 0 && (
                  <span className="text-rose-300 ml-1">· {mailStats.failed} failed</span>
                )}
                <span className="text-dark-500 ml-1">· {mailStats.completed} sent</span>
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-dark-400">
              <Stat label="Waiting" value={mailStats.waiting} />
              <Stat label="Sending" value={mailStats.active} />
              <Stat label="Done" value={mailStats.completed} />
              <Stat label="Failed" value={mailStats.failed} className="text-rose-400" />
            </div>
          </div>
        </div>
      )}

      <div className="card mb-6">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Send size={18} /> Add candidates
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-dark-300">Paste emails (one per line)</label>
              <select
                value={textareaSetId}
                onChange={(e) => setTextareaSetId(e.target.value)}
                className="input-field text-xs py-1 max-w-[180px]"
                title="Set assignment for these emails"
              >
                <option value="">Set: Auto-random</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>Set: {s.name}</option>
                ))}
              </select>
            </div>
            <textarea
              rows={6}
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
              placeholder="alice@example.com&#10;bob@example.com&#10;carol@example.com"
              className="input-field font-mono text-sm w-full"
            />
            <p className="text-xs text-dark-400 mt-1">{parsedTextareaRows.length} email(s) ready{textareaSetId ? ` → ${sets.find((s) => s.id === textareaSetId)?.name}` : ' (auto-random)'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">Upload CSV</label>
            <p className="text-xs text-dark-400 mb-2">Format: <code className="bg-dark-800 px-1 rounded">email,firstName,lastName,mobile,setCode</code> (header row optional). Set code matches set's code or name; leave blank for auto-random.</p>
            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-dark-700 rounded-lg px-4 py-8 cursor-pointer hover:bg-dark-800/40 text-dark-300">
              <Upload size={16} />
              <span>Choose CSV file</span>
              <input type="file" accept=".csv,text/csv" onChange={handleCsv} className="hidden" />
            </label>
            <p className="text-xs text-dark-400 mt-1">{csvRows.length} row(s) parsed from CSV</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={send}
            disabled={sending || (parsedTextareaRows.length + csvRows.length === 0)}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Mail size={16} /> {sending ? 'Sending…' : `Send ${parsedTextareaRows.length + csvRows.length} invite(s)`}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Existing invites ({invites.length})</h2>
        {loading ? (
          <p className="text-dark-400">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-dark-400">No invites yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-dark-800 text-left text-xs uppercase tracking-wider text-dark-400">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Set</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Used</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const inviteSet = inv.setId ? sets.find((s) => s.id === inv.setId) : null;
                  return (
                    <tr key={inv.id} className="border-t border-dark-700 hover:bg-dark-800/40">
                      <td className="px-3 py-2 font-mono text-dark-200">{inv.email}</td>
                      <td className="px-3 py-2 text-dark-300">
                        {[inv.prefillFirstName, inv.prefillLastName].filter(Boolean).join(' ') || <span className="text-dark-500">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {inviteSet ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 flex items-center gap-1 w-fit"><Shuffle size={10} /> {inviteSet.name}</span>
                        ) : (
                          <span className="text-xs text-dark-500 italic">auto</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-3 py-2 text-dark-400">{inv.usedAt ? new Date(inv.usedAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 text-dark-400">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2 text-xs">
                          <button onClick={() => copyLink(inv.token)} className="text-blue-400 hover:text-blue-300 flex items-center gap-1" title="Copy link">
                            <Copy size={12} /> Copy
                          </button>
                          <button onClick={() => resend(inv.id)} className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 disabled:opacity-30" disabled={inv.status === 'submitted' || inv.status === 'revoked'} title="Resend email">
                            <RefreshCw size={12} /> Resend
                          </button>
                          <button onClick={() => revoke(inv.id)} className="text-rose-400 hover:text-rose-300 flex items-center gap-1 disabled:opacity-30" disabled={inv.status === 'submitted' || inv.status === 'revoked'} title="Revoke">
                            <Trash2 size={12} /> Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="text-center">
      <p className={`text-base font-mono font-bold leading-none ${className || ''}`}>{value}</p>
      <p className="text-[9px] text-dark-500 mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: MagicLink['status'] }) {
  const colors: Record<string, string> = {
    pending: 'bg-dark-800 text-dark-300',
    active: 'bg-blue-900/40 text-blue-300',
    submitted: 'bg-emerald-900/40 text-emerald-300',
    expired: 'bg-yellow-900/40 text-yellow-300',
    revoked: 'bg-rose-900/40 text-rose-300',
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-dark-800'}`}>
      {status}
    </span>
  );
}
