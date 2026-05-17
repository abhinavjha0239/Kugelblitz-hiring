'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Trash2, Plus, Settings, Layers, FileQuestion, Code, ListChecks, ChevronRight, ArrowUp, ArrowDown, Wand2, MoveRight, Shuffle, Power, Pencil } from 'lucide-react';
import {
  paperService,
  PaperConfig,
  CutoffType,
  CutoffFailBehavior,
} from '@/services/paper.service';
import { examSetService, ExamSet } from '@/services/exam-set.service';
import { testsService } from '@/services/tests.service';
import { Test } from '@/types';

interface MappingQuestion {
  id: string;
  title: string;
  type: string;
  marks: number;
  orderIndex: number;
  paperId: string | null;
}
interface MappingPaper {
  id: string;
  name: string;
  order: number;
  totalMarks: number;
  mappedCount: number;
}

export default function PapersConfigPage() {
  const { id: testId } = useParams<{ id: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [papers, setPapers] = useState<PaperConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Question mapping
  const [mapQuestions, setMapQuestions] = useState<MappingQuestion[]>([]);
  const [mapPapers, setMapPapers] = useState<MappingPaper[]>([]);
  const [mappingFilter, setMappingFilter] = useState<'all' | 'unmapped' | string>('all');
  const [busyQid, setBusyQid] = useState<string | null>(null);
  const [selectedQids, setSelectedQids] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // Sets
  const [sets, setSets] = useState<ExamSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string>('');
  const [newSetName, setNewSetName] = useState('');
  const [newSetCode, setNewSetCode] = useState('');
  const [creatingSet, setCreatingSet] = useState(false);

  // Test-level settings
  const [testSettings, setTestSettings] = useState({
    timerMode: 'per_paper' as 'overall' | 'per_paper',
    overallDurationMinutes: 0,
    timeCarryOver: false,
    startsAt: '',
    endsAt: '',
    requireSafeExamBrowser: false,
    sebQuitUrl: '',
    sebExtraProhibitedProcesses: '',
  });

  // New paper form
  const [newPaper, setNewPaper] = useState({
    name: '',
    order: 1,
    totalQuestions: 10,
    durationMinutes: 30,
    cutoffType: 'none' as CutoffType,
    cutoffValue: 0,
    cutoffFailBehavior: 'lock_next' as CutoffFailBehavior,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
  }, [testId]);

  async function load() {
    setLoading(true);
    try {
      const [t, p, allSets] = await Promise.all([
        testsService.getById(testId),
        paperService.listByExam(testId),
        examSetService.list(testId),
      ]);
      setSets(allSets);
      const targetSet = activeSetId && allSets.find((s) => s.id === activeSetId)
        ? activeSetId
        : (allSets.find((s) => s.isDefault)?.id || allSets[0]?.id || '');
      setActiveSetId(targetSet);
      const mapping = await paperService.getQuestionMapping(testId, targetSet || undefined);
      setTest(t);
      setPapers([...p].sort((a, b) => a.order - b.order));
      setMapQuestions(mapping.questions);
      setMapPapers(mapping.papers);
      setTestSettings({
        timerMode: (t.timerMode as any) || 'per_paper',
        overallDurationMinutes: t.overallDurationMinutes || 0,
        timeCarryOver: !!t.timeCarryOver,
        startsAt: t.startsAt ? new Date(t.startsAt).toISOString().slice(0, 16) : '',
        endsAt: t.endsAt ? new Date(t.endsAt).toISOString().slice(0, 16) : '',
        requireSafeExamBrowser: !!(t as any).requireSafeExamBrowser,
        sebQuitUrl: (t as any).sebQuitUrl || '',
        sebExtraProhibitedProcesses: (t as any).sebExtraProhibitedProcesses || '',
      });
      setNewPaper((s) => ({ ...s, order: (p?.length || 0) + 1, name: `Paper ${(p?.length || 0) + 1}` }));
    } catch (e: any) {
      toast.error(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function reloadMapping() {
    try {
      const mapping = await paperService.getQuestionMapping(testId, activeSetId || undefined);
      setMapQuestions(mapping.questions);
      setMapPapers(mapping.papers);
      const p = await paperService.listByExam(testId);
      setPapers([...p].sort((a, b) => a.order - b.order));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  // Re-fetch mapping when active set changes
  useEffect(() => {
    if (!activeSetId) return;
    void reloadMapping();
    setSelectedQids(new Set());
  }, [activeSetId]);

  async function createSet() {
    if (!newSetName.trim()) {
      toast.error('Set name required');
      return;
    }
    setCreatingSet(true);
    try {
      const created = await examSetService.create(testId, {
        name: newSetName.trim(),
        code: newSetCode.trim() || undefined,
      });
      toast.success(`Created ${created.name}`);
      setNewSetName('');
      setNewSetCode('');
      const updated = await examSetService.list(testId);
      setSets(updated);
      setActiveSetId(created.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingSet(false);
    }
  }

  async function toggleSetActive(set: ExamSet) {
    const next = !set.isActive;
    const verb = next ? 'Activate' : 'Deactivate';
    const note = next
      ? `${verb} "${set.name}"? New auto-random invites will start including it.`
      : `${verb} "${set.name}"? New auto-random invites will skip it. Existing pinned candidates are unaffected.`;
    if (!confirm(note)) return;
    try {
      await examSetService.update(set.id, { isActive: next });
      const updated = await examSetService.list(testId);
      setSets(updated);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function renameSet(set: ExamSet) {
    const name = prompt('New name for this set:', set.name);
    if (!name || name === set.name) return;
    try {
      await examSetService.update(set.id, { name });
      const updated = await examSetService.list(testId);
      setSets(updated);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function deleteSet(set: ExamSet) {
    if (set.isDefault) return toast.error('Cannot delete the default set');
    if (!confirm(`Delete "${set.name}"? Its question mappings will be removed.`)) return;
    try {
      await examSetService.remove(set.id);
      const updated = await examSetService.list(testId);
      setSets(updated);
      if (activeSetId === set.id) {
        setActiveSetId(updated.find((s) => s.isDefault)?.id || '');
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function changeQuestionPaper(qid: string, currentPaperId: string | null, targetPaperId: string | null) {
    if (currentPaperId === targetPaperId) return;
    setBusyQid(qid);
    try {
      if (targetPaperId === null) {
        if (!currentPaperId) return;
        await paperService.removeQuestionFromPaper(currentPaperId, qid, activeSetId || undefined);
      } else {
        await paperService.addQuestionToPaper(targetPaperId, qid, activeSetId || undefined);
      }
      await reloadMapping();
    } catch (e: any) {
      toast.error(e.message || 'Failed to move question');
    } finally {
      setBusyQid(null);
    }
  }

  function toggleSelect(qid: string) {
    setSelectedQids((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }

  function selectAllVisible(visible: MappingQuestion[]) {
    setSelectedQids(new Set(visible.map((q) => q.id)));
  }

  function clearSelection() {
    setSelectedQids(new Set());
  }

  async function bulkMove() {
    if (!bulkTarget || selectedQids.size === 0) {
      toast.error('Pick a target paper and at least one question');
      return;
    }
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedQids);
      if (bulkTarget === '__unmap__') {
        for (const qid of ids) {
          const q = mapQuestions.find((x) => x.id === qid);
          if (q?.paperId) {
            await paperService.removeQuestionFromPaper(q.paperId, qid, activeSetId || undefined);
          }
        }
        toast.success(`Unmapped ${ids.length} question(s)`);
      } else {
        const r = await paperService.bulkAddToPaper(bulkTarget, ids, activeSetId || undefined);
        toast.success(`Moved ${r.added} question(s) (${r.skipped} skipped)`);
      }
      clearSelection();
      await reloadMapping();
    } catch (e: any) {
      toast.error(e.message || 'Bulk move failed');
    } finally {
      setBulkBusy(false);
    }
  }

  async function reorder(qid: string, direction: 'up' | 'down', filteredList: MappingQuestion[]) {
    const idx = filteredList.findIndex((q) => q.id === qid);
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= filteredList.length) return;
    const reorderedIds = [...filteredList.map((q) => q.id)];
    [reorderedIds[idx], reorderedIds[swap]] = [reorderedIds[swap], reorderedIds[idx]];
    const target = filteredList[idx];
    if (!target.paperId) return;
    setBusyQid(qid);
    try {
      await paperService.reorderPaperQuestions(target.paperId, reorderedIds, activeSetId || undefined);
      await reloadMapping();
    } catch (e: any) {
      toast.error(e.message || 'Reorder failed');
    } finally {
      setBusyQid(null);
    }
  }

  async function autoAssign() {
    if (!confirm(`Auto-assign questions to papers by section index for "${activeSet?.name}"? (section=1 → Paper 1, etc.)`)) return;
    try {
      const r = await paperService.autoAssignBySection(testId, activeSetId || undefined);
      const total = Object.values(r.assigned).reduce((s, n) => s + n, 0);
      toast.success(`Auto-assigned ${total} question(s) to ${activeSet?.name || 'set'}`);
      await reloadMapping();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function saveTestSettings() {
    try {
      await testsService.update(testId, {
        timerMode: testSettings.timerMode,
        overallDurationMinutes: Number(testSettings.overallDurationMinutes) || 0,
        timeCarryOver: testSettings.timeCarryOver,
        startsAt: testSettings.startsAt ? new Date(testSettings.startsAt).toISOString() : undefined,
        endsAt: testSettings.endsAt ? new Date(testSettings.endsAt).toISOString() : undefined,
        requireSafeExamBrowser: testSettings.requireSafeExamBrowser,
        sebQuitUrl: testSettings.sebQuitUrl?.trim() || undefined,
        sebExtraProhibitedProcesses: testSettings.sebExtraProhibitedProcesses?.trim() || undefined,
      } as any);
      toast.success('Test settings saved');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function savePaper(p: PaperConfig) {
    try {
      await paperService.updatePaper(p.id, {
        name: p.name,
        order: Number(p.order),
        totalQuestions: Number(p.totalQuestions),
        durationMinutes: Number(p.durationMinutes),
        cutoffType: p.cutoffType,
        cutoffValue: Number(p.cutoffValue),
        cutoffFailBehavior: p.cutoffFailBehavior,
      });
      toast.success(`${p.name} saved`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function createPaper() {
    if (!newPaper.name.trim()) {
      toast.error('Paper name required');
      return;
    }
    setCreating(true);
    try {
      await paperService.createPaper({
        examId: testId,
        name: newPaper.name,
        order: Number(newPaper.order),
        totalQuestions: Number(newPaper.totalQuestions),
        durationMinutes: Number(newPaper.durationMinutes),
        cutoffType: newPaper.cutoffType,
        cutoffValue: Number(newPaper.cutoffValue),
        cutoffFailBehavior: newPaper.cutoffFailBehavior,
      });
      toast.success('Paper created');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function deletePaper(p: PaperConfig) {
    if (!confirm(`Delete "${p.name}"? Questions in it will be unmapped.`)) return;
    try {
      await paperService.deletePaper(p.id);
      toast.success('Deleted');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function updateLocal(idx: number, patch: Partial<PaperConfig>) {
    setPapers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  const activeSet = sets.find((s) => s.id === activeSetId);

  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/admin/tests/${testId}/questions`} className="p-2 hover:bg-dark-800 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6" /> Papers Configuration</h1>
          <p className="text-dark-400 text-sm mt-1">{test?.title} · {papers.length} paper(s)</p>
        </div>
        <Link href={`/admin/tests/${testId}/invites`} className="btn-secondary">Invites →</Link>
      </div>

      {/* ─── Test-level Settings ────────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Settings className="w-5 h-5" /> Exam-level settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Timer mode</label>
            <select
              className="input-field"
              value={testSettings.timerMode}
              onChange={(e) => setTestSettings({ ...testSettings, timerMode: e.target.value as any })}
            >
              <option value="per_paper">Per-paper (each paper has its own timer)</option>
              <option value="overall">Overall (one timer for entire exam)</option>
            </select>
          </div>
          {testSettings.timerMode === 'overall' && (
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Overall duration (minutes)</label>
              <input
                type="number"
                min={1}
                className="input-field"
                value={testSettings.overallDurationMinutes}
                onChange={(e) => setTestSettings({ ...testSettings, overallDurationMinutes: Number(e.target.value) })}
              />
            </div>
          )}
          {testSettings.timerMode === 'per_paper' && (
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-dark-300">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={testSettings.timeCarryOver}
                  onChange={(e) => setTestSettings({ ...testSettings, timeCarryOver: e.target.checked })}
                />
                Carry leftover time from previous paper
              </label>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Window starts at</label>
            <input
              type="datetime-local"
              className="input-field"
              value={testSettings.startsAt}
              onChange={(e) => setTestSettings({ ...testSettings, startsAt: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Window ends at</label>
            <input
              type="datetime-local"
              className="input-field"
              value={testSettings.endsAt}
              onChange={(e) => setTestSettings({ ...testSettings, endsAt: e.target.value })}
            />
          </div>
        </div>

        {/* ─── Safe Exam Browser lockdown ───────────────────── */}
        <div className="mt-6 p-4 rounded-lg border border-amber-700/40 bg-amber-950/20">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 mt-1"
              checked={testSettings.requireSafeExamBrowser}
              onChange={(e) =>
                setTestSettings({ ...testSettings, requireSafeExamBrowser: e.target.checked })
              }
            />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-200">🔒 Require Safe Exam Browser (lockdown mode)</div>
              <div className="text-xs text-amber-300/70 mt-0.5">
                Candidates must download <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer" className="underline">Safe Exam Browser</a> and open the auto-generated <code>.seb</code> config from their invite email. Inside SEB:
                fullscreen-only, no app switching, no copy-paste outside, no screenshots/screen-share, no virtual machines, no remote-desktop tools (TeamViewer/AnyDesk/RDP/etc), no WebRTC. Cannot quit until they submit. Server verifies a per-candidate
                cryptographic header on every API call.
              </div>
            </div>
          </label>
          {testSettings.requireSafeExamBrowser && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-amber-200 mb-1">Extra prohibited processes (comma-separated, optional)</label>
                <input
                  type="text"
                  className="input-field text-xs"
                  placeholder="e.g. notepad.exe, custom-tool"
                  value={testSettings.sebExtraProhibitedProcesses}
                  onChange={(e) =>
                    setTestSettings({ ...testSettings, sebExtraProhibitedProcesses: e.target.value })
                  }
                />
                <p className="text-[10px] text-amber-300/60 mt-1">
                  Built-in defaults already block: TeamViewer, AnyDesk, RDP, VNC, Parsec, Sunshine, Zoom, Teams, OBS, Discord, Slack, ScreenFlow, Loom, ShareX, VirtualBox, VMware, Parallels, Wireshark, Fiddler, plus more.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-amber-200 mb-1">Custom quit URL (optional)</label>
                <input
                  type="text"
                  className="input-field text-xs"
                  placeholder="(leave blank for default — your results page)"
                  value={testSettings.sebQuitUrl}
                  onChange={(e) => setTestSettings({ ...testSettings, sebQuitUrl: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <a
                  href={`/api/admin/tests/${testId}/seb-config-preview`}
                  className="btn-secondary text-xs"
                  target="_blank"
                  rel="noreferrer"
                >
                  Download preview .seb
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <button onClick={saveTestSettings} className="btn-primary flex items-center gap-2"><Save className="w-4 h-4" /> Save exam settings</button>
        </div>
      </div>

      {/* ─── Sets ─────────────────────────────────────────── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shuffle className="w-5 h-5" /> Sets (variants)
          </h2>
          <span className="text-xs text-dark-400">
            Each set has its own per-paper question mapping. Students get one set; can't see the others.
          </span>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {sets.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-all ${
                activeSetId === s.id ? 'bg-blue-600 text-white border-blue-500' : 'bg-dark-800 text-dark-300 border-dark-700 hover:border-dark-600'
              }`}
            >
              <button onClick={() => setActiveSetId(s.id)} className="flex items-center gap-1.5">
                <span>{s.name}</span>
                {s.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200">default</span>}
                {!s.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-dark-900 text-dark-500">inactive</span>}
              </button>
              <button onClick={() => renameSet(s)} title="Rename" className="hover:opacity-80"><Pencil className="w-3 h-3" /></button>
              <button onClick={() => toggleSetActive(s)} title={s.isActive ? 'Deactivate' : 'Activate'} className="hover:opacity-80"><Power className="w-3 h-3" /></button>
              {!s.isDefault && (
                <button onClick={() => deleteSet(s)} title="Delete" className="hover:text-red-300"><Trash2 className="w-3 h-3" /></button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input-field text-sm py-1.5 max-w-xs"
            placeholder="New set name (e.g. Set B)"
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
          />
          <input
            className="input-field text-sm py-1.5 w-24"
            placeholder="Code"
            value={newSetCode}
            onChange={(e) => setNewSetCode(e.target.value)}
          />
          <button onClick={createSet} disabled={creatingSet} className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50">
            <Plus className="w-3 h-3" /> {creatingSet ? 'Creating…' : 'Add set'}
          </button>
          <span className="text-xs text-dark-400 ml-auto">
            Editing mappings for: <strong className="text-blue-300">{activeSet?.name || '—'}</strong>
          </span>
        </div>
      </div>

      {/* ─── Per-paper config ───────────────────────────────── */}
      <h2 className="text-lg font-semibold mb-3">Papers (sequential unlock by order)</h2>
      <div className="space-y-4 mb-6">
        {papers.map((p, idx) => (
          <div key={p.id} className="card">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono bg-dark-800 px-2 py-1 rounded">#{p.order}</span>
              <input
                className="input-field flex-1 max-w-md"
                value={p.name}
                onChange={(e) => updateLocal(idx, { name: e.target.value })}
              />
              <span className="text-xs text-dark-400">{p.totalMarks ?? 0} total marks</span>
              <button onClick={() => deletePaper(p)} className="p-2 hover:bg-dark-700 rounded-lg">
                <Trash2 className="w-4 h-4 text-danger" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Order</label>
                <input
                  type="number"
                  min={1}
                  className="input-field text-sm"
                  value={p.order}
                  onChange={(e) => updateLocal(idx, { order: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Question pool size</label>
                <input
                  type="number"
                  min={1}
                  className="input-field text-sm"
                  value={p.totalQuestions}
                  onChange={(e) => updateLocal(idx, { totalQuestions: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Duration (min)</label>
                <input
                  type="number"
                  min={1}
                  className="input-field text-sm"
                  value={p.durationMinutes}
                  onChange={(e) => updateLocal(idx, { durationMinutes: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="border-t border-dark-700 pt-3">
              <p className="text-xs uppercase tracking-wider text-dark-500 mb-2">Cutoff</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Type</label>
                  <select
                    className="input-field text-sm"
                    value={p.cutoffType || 'none'}
                    onChange={(e) => updateLocal(idx, { cutoffType: e.target.value as CutoffType })}
                  >
                    <option value="none">None — always unlocks next paper</option>
                    <option value="percent">Percentage of paper marks</option>
                    <option value="marks">Absolute marks</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">
                    Cutoff value {p.cutoffType === 'percent' ? '(%)' : p.cutoffType === 'marks' ? '(marks)' : ''}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!p.cutoffType || p.cutoffType === 'none'}
                    className="input-field text-sm disabled:opacity-50"
                    value={p.cutoffValue || 0}
                    onChange={(e) => updateLocal(idx, { cutoffValue: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">If cutoff fails</label>
                  <select
                    className="input-field text-sm"
                    disabled={!p.cutoffType || p.cutoffType === 'none'}
                    value={p.cutoffFailBehavior || 'lock_next'}
                    onChange={(e) =>
                      updateLocal(idx, { cutoffFailBehavior: e.target.value as CutoffFailBehavior })
                    }
                  >
                    <option value="lock_next">Lock next paper (review-only)</option>
                    <option value="end_exam">End the exam immediately</option>
                    <option value="none">Continue anyway</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => savePaper(p)} className="btn-primary flex items-center gap-2 text-sm">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
        ))}
        {papers.length === 0 && (
          <div className="text-center py-8 text-dark-400 border border-dashed border-dark-700 rounded-lg">
            No papers yet. Create one below.
          </div>
        )}
      </div>

      {/* ─── Question Mapping ─────────────────────────────── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileQuestion className="w-5 h-5" /> Question → Paper mapping
            {activeSet && (
              <span className="text-xs text-blue-300 bg-blue-900/30 border border-blue-700/40 rounded px-2 py-0.5">
                {activeSet.name}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-dark-400">
              {mapQuestions.filter((q) => !q.paperId).length} unmapped · {mapQuestions.length} total
            </span>
            <button onClick={autoAssign} className="btn-secondary text-xs flex items-center gap-1">
              <Wand2 className="w-3 h-3" /> Auto-assign by section
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <button
            onClick={() => setMappingFilter('all')}
            className={`px-3 py-1.5 rounded-full ${mappingFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
          >
            All ({mapQuestions.length})
          </button>
          <button
            onClick={() => setMappingFilter('unmapped')}
            className={`px-3 py-1.5 rounded-full ${mappingFilter === 'unmapped' ? 'bg-amber-600 text-white' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
          >
            Unmapped ({mapQuestions.filter((q) => !q.paperId).length})
          </button>
          {mapPapers.map((mp) => (
            <button
              key={mp.id}
              onClick={() => setMappingFilter(mp.id)}
              className={`px-3 py-1.5 rounded-full ${mappingFilter === mp.id ? 'bg-emerald-600 text-white' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
            >
              {mp.name} ({mp.mappedCount})
            </button>
          ))}
        </div>

        {mapQuestions.length === 0 ? (
          <p className="text-sm text-dark-400 text-center py-6">No questions yet. Add questions from the Questions page first.</p>
        ) : (() => {
          const filtered = mapQuestions.filter((q) => {
            if (mappingFilter === 'all') return true;
            if (mappingFilter === 'unmapped') return !q.paperId;
            return q.paperId === mappingFilter;
          });
          const isPaperFilter = mappingFilter !== 'all' && mappingFilter !== 'unmapped';
          const allVisibleSelected = filtered.length > 0 && filtered.every((q) => selectedQids.has(q.id));

          return (
            <>
              {selectedQids.size > 0 && (
                <div className="flex items-center gap-3 bg-blue-900/30 border border-blue-700 rounded-lg p-3 mb-3">
                  <span className="text-sm text-blue-200 font-medium">{selectedQids.size} selected</span>
                  <select
                    className="input-field text-sm py-1 max-w-xs"
                    value={bulkTarget}
                    onChange={(e) => setBulkTarget(e.target.value)}
                  >
                    <option value="">Move to…</option>
                    {mapPapers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    <option value="__unmap__">— Unmap (remove from paper) —</option>
                  </select>
                  <button
                    onClick={bulkMove}
                    disabled={bulkBusy || !bulkTarget}
                    className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                  >
                    <MoveRight className="w-3 h-3" /> {bulkBusy ? 'Moving…' : 'Apply'}
                  </button>
                  <button onClick={clearSelection} className="text-xs text-dark-300 hover:text-white">Clear</button>
                </div>
              )}

              <div className="border border-dark-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-dark-800 text-left text-xs uppercase tracking-wider text-dark-400">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={() => allVisibleSelected ? clearSelection() : selectAllVisible(filtered)}
                          className="w-4 h-4"
                        />
                      </th>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Question</th>
                      <th className="px-3 py-2">Marks</th>
                      <th className="px-3 py-2">Currently in</th>
                      <th className="px-3 py-2">Move to</th>
                      <th className="px-3 py-2">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((q, i) => {
                      const currentPaper = mapPapers.find((p) => p.id === q.paperId);
                      const checked = selectedQids.has(q.id);
                      return (
                        <tr key={q.id} className={`border-t border-dark-700 hover:bg-dark-800/40 ${checked ? 'bg-blue-900/10' : ''}`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={checked} onChange={() => toggleSelect(q.id)} className="w-4 h-4" />
                          </td>
                          <td className="px-3 py-2 text-dark-500 font-mono text-xs">{i + 1}</td>
                          <td className="px-3 py-2">
                            {q.type === 'mcq' ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-warning/10 text-warning">
                                <ListChecks className="w-3 h-3" /> MCQ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-accent/10 text-accent">
                                <Code className="w-3 h-3" /> Coding
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 max-w-md truncate" title={q.title}>{q.title}</td>
                          <td className="px-3 py-2 text-dark-300">{q.marks}</td>
                          <td className="px-3 py-2">
                            {currentPaper ? (
                              <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300">{currentPaper.name}</span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-300">Unmapped</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              disabled={busyQid === q.id}
                              value={q.paperId || ''}
                              onChange={(e) => changeQuestionPaper(q.id, q.paperId, e.target.value || null)}
                              className="input-field text-xs py-1 w-full"
                            >
                              <option value="">— Unmapped —</option>
                              {mapPapers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => reorder(q.id, 'up', filtered)}
                                disabled={!isPaperFilter || i === 0 || busyQid === q.id || !q.paperId}
                                className="p-1 rounded hover:bg-dark-700 disabled:opacity-20 disabled:cursor-not-allowed"
                                title={isPaperFilter ? 'Move up within paper' : 'Filter by a paper to enable reorder'}
                              >
                                <ArrowUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => reorder(q.id, 'down', filtered)}
                                disabled={!isPaperFilter || i === filtered.length - 1 || busyQid === q.id || !q.paperId}
                                className="p-1 rounded hover:bg-dark-700 disabled:opacity-20 disabled:cursor-not-allowed"
                                title={isPaperFilter ? 'Move down within paper' : 'Filter by a paper to enable reorder'}
                              >
                                <ArrowDown className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-dark-500 mt-2">
                ↑↓ buttons reorder questions <strong>within a paper</strong> — filter by a paper above to enable.
              </p>
            </>
          );
        })()}

        {mapPapers.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-4 text-xs text-dark-400">
            {mapPapers.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3" />
                <span>{p.name}: {p.mappedCount} questions, {p.totalMarks} marks</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ─── New paper ──────────────────────────────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Plus className="w-5 h-5" /> Add a new paper</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="input-field" placeholder="Paper name" value={newPaper.name} onChange={(e) => setNewPaper({ ...newPaper, name: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <input type="number" className="input-field" placeholder="Order" value={newPaper.order} onChange={(e) => setNewPaper({ ...newPaper, order: Number(e.target.value) })} />
            <input type="number" className="input-field" placeholder="# Questions" value={newPaper.totalQuestions} onChange={(e) => setNewPaper({ ...newPaper, totalQuestions: Number(e.target.value) })} />
            <input type="number" className="input-field" placeholder="Min" value={newPaper.durationMinutes} onChange={(e) => setNewPaper({ ...newPaper, durationMinutes: Number(e.target.value) })} />
          </div>
          <select className="input-field" value={newPaper.cutoffType} onChange={(e) => setNewPaper({ ...newPaper, cutoffType: e.target.value as CutoffType })}>
            <option value="none">No cutoff</option>
            <option value="percent">Cutoff: percentage</option>
            <option value="marks">Cutoff: absolute marks</option>
          </select>
          <input
            type="number"
            className="input-field"
            placeholder="Cutoff value"
            disabled={newPaper.cutoffType === 'none'}
            value={newPaper.cutoffValue}
            onChange={(e) => setNewPaper({ ...newPaper, cutoffValue: Number(e.target.value) })}
          />
          <select
            className="input-field md:col-span-2"
            disabled={newPaper.cutoffType === 'none'}
            value={newPaper.cutoffFailBehavior}
            onChange={(e) => setNewPaper({ ...newPaper, cutoffFailBehavior: e.target.value as CutoffFailBehavior })}
          >
            <option value="lock_next">If failed: lock next paper</option>
            <option value="end_exam">If failed: end exam</option>
            <option value="none">If failed: continue anyway</option>
          </select>
        </div>
        <div className="mt-4">
          <button onClick={createPaper} disabled={creating} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create paper'}
          </button>
        </div>
      </div>
    </div>
  );
}
