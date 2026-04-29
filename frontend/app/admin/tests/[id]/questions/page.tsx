'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { testsService } from '@/services/tests.service';
import { questionsService } from '@/services/questions.service';
import { paperService } from '@/services/paper.service';
import { Test, Question, LANGUAGES } from '@/types';
import { ArrowLeft, Plus, Trash2, Code, ListChecks, Save } from 'lucide-react';

export default function QuestionsPage() {
  const { id: testId } = useParams<{ id: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<'coding' | 'mcq'>('coding');
  const [form, setForm] = useState({
    title: '', description: '', marks: 10, orderIndex: 0,
    allowedLanguages: [71, 63, 54, 62],
    mcqOptions: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }],
    mcqCorrectAnswer: 'a',
    testCases: [{ input: '', expectedOutput: '', isHidden: false }],
  });
  const [saving, setSaving] = useState(false);
  const [papers, setPapers] = useState<any[]>([]);
  const [newPaper, setNewPaper] = useState({
    name: 'Paper 1',
    order: 1,
    totalQuestions: 10,
    durationMinutes: 30,
  });
  const [selectedPaperId, setSelectedPaperId] = useState<string>('');

  useEffect(() => { loadData(); }, [testId]);

  const loadData = async () => {
    try {
      const [t, q] = await Promise.all([testsService.getById(testId), questionsService.getByTest(testId)]);
      const p = await paperService.listByExam(testId);
      setTest(t);
      setQuestions(q);
      setPapers(p || []);
      if ((p || []).length > 0) setSelectedPaperId(p[0].id);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleCreatePaper = async () => {
    try {
      await paperService.createPaper({
        examId: testId,
        name: newPaper.name,
        order: Number(newPaper.order),
        totalQuestions: Number(newPaper.totalQuestions),
        durationMinutes: Number(newPaper.durationMinutes),
      });
      toast.success('Paper created');
      setNewPaper((prev) => ({ ...prev, order: prev.order + 1, name: `Paper ${prev.order + 1}` }));
      await loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleMapQuestions = async () => {
    if (!selectedPaperId) {
      toast.error('Select a paper first');
      return;
    }
    try {
      await paperService.setPaperQuestions(selectedPaperId, questions.map((q) => q.id));
      toast.success('Mapped current question pool to paper');
      await loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data: any = {
        testId,
        type: formType,
        title: form.title,
        description: form.description,
        marks: form.marks,
        orderIndex: questions.length,
        allowedLanguages: form.allowedLanguages,
      };
      if (formType === 'mcq') {
        data.mcqOptions = form.mcqOptions.filter(o => o.text.trim());
        data.mcqCorrectAnswer = form.mcqCorrectAnswer;
      } else {
        data.testCases = form.testCases.filter(tc => tc.input.trim() || tc.expectedOutput.trim());
      }
      await questionsService.create(data);
      toast.success('Question added!');
      setShowForm(false);
      setForm({ title: '', description: '', marks: 10, orderIndex: 0, allowedLanguages: [71, 63, 54, 62], mcqOptions: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }], mcqCorrectAnswer: 'a', testCases: [{ input: '', expectedOutput: '', isHidden: false }] });
      loadData();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDeleteQuestion = async (qId: string) => {
    if (!confirm('Delete this question?')) return;
    try { await questionsService.delete(qId); toast.success('Deleted'); loadData(); } catch (err: any) { toast.error(err.message); }
  };

  const addTestCase = () => setForm(p => ({ ...p, testCases: [...p.testCases, { input: '', expectedOutput: '', isHidden: false }] }));

  const updateTestCase = (idx: number, field: string, value: any) => {
    setForm(p => ({ ...p, testCases: p.testCases.map((tc, i) => i === idx ? { ...tc, [field]: value } : tc) }));
  };

  const updateMcqOption = (idx: number, text: string) => {
    setForm(p => ({ ...p, mcqOptions: p.mcqOptions.map((o, i) => i === idx ? { ...o, text } : o) }));
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{test?.title || 'Loading...'}</h1>
          <p className="text-dark-400 text-sm mt-1">Manage questions · {questions.length} questions · {test?.totalMarks || 0} total marks</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2"><Plus className="w-5 h-5" /> Add Question</button>
      </div>

      <div className="card mb-8">
        <h2 className="text-lg font-semibold mb-4">Paper Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            className="input-field"
            placeholder="Paper name"
            value={newPaper.name}
            onChange={(e) => setNewPaper((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            className="input-field"
            type="number"
            min={1}
            value={newPaper.order}
            onChange={(e) => setNewPaper((p) => ({ ...p, order: Number(e.target.value) }))}
          />
          <input
            className="input-field"
            type="number"
            min={1}
            value={newPaper.totalQuestions}
            onChange={(e) => setNewPaper((p) => ({ ...p, totalQuestions: Number(e.target.value) }))}
          />
          <input
            className="input-field"
            type="number"
            min={1}
            value={newPaper.durationMinutes}
            onChange={(e) => setNewPaper((p) => ({ ...p, durationMinutes: Number(e.target.value) }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleCreatePaper} className="btn-primary">
            Create Paper
          </button>
          <select
            className="input-field max-w-xs"
            value={selectedPaperId}
            onChange={(e) => setSelectedPaperId(e.target.value)}
          >
            <option value="">Select paper</option>
            {papers.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.order}. {paper.name} ({paper.totalQuestions} Q, {paper.durationMinutes}m)
              </option>
            ))}
          </select>
          <button type="button" onClick={handleMapQuestions} className="btn-secondary">
            Map All Current Questions To Selected Paper
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card mb-8 space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <h2 className="text-lg font-semibold">New Question</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => setFormType('coding')} className={`px-3 py-1 rounded-lg text-sm ${formType === 'coding' ? 'bg-accent text-white' : 'bg-dark-800 text-dark-400'}`}>
                <Code className="w-4 h-4 inline mr-1" />Coding
              </button>
              <button type="button" onClick={() => setFormType('mcq')} className={`px-3 py-1 rounded-lg text-sm ${formType === 'mcq' ? 'bg-accent text-white' : 'bg-dark-800 text-dark-400'}`}>
                <ListChecks className="w-4 h-4 inline mr-1" />MCQ
              </button>
            </div>
          </div>
          <input type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className="input-field" placeholder="Question title" required />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="input-field min-h-[120px]" placeholder="Question description (supports markdown-style formatting)" required />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Marks</label>
              <input type="number" value={form.marks} onChange={e => setForm(p => ({ ...p, marks: parseInt(e.target.value) }))} className="input-field" min="1" />
            </div>
          </div>

          {formType === 'mcq' ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-dark-300">Options</h3>
              {form.mcqOptions.map((opt, i) => (
                <div key={opt.id} className="flex items-center gap-3">
                  <input type="radio" name="correct" checked={form.mcqCorrectAnswer === opt.id} onChange={() => setForm(p => ({ ...p, mcqCorrectAnswer: opt.id }))} className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium w-6">{opt.id.toUpperCase()}.</span>
                  <input type="text" value={opt.text} onChange={e => updateMcqOption(i, e.target.value)} className="input-field flex-1" placeholder={`Option ${opt.id.toUpperCase()}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-dark-300">Test Cases</h3>
                <button type="button" onClick={addTestCase} className="text-sm text-accent hover:text-accent-hover">+ Add Test Case</button>
              </div>
              {form.testCases.map((tc, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 p-3 bg-dark-800 rounded-lg">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Input</label>
                    <textarea value={tc.input} onChange={e => updateTestCase(i, 'input', e.target.value)} className="input-field text-sm min-h-[60px]" placeholder="stdin input" />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Expected Output</label>
                    <textarea value={tc.expectedOutput} onChange={e => updateTestCase(i, 'expectedOutput', e.target.value)} className="input-field text-sm min-h-[60px]" placeholder="expected stdout" />
                  </div>
                  <label className="col-span-2 flex items-center gap-2 text-sm text-dark-400">
                    <input type="checkbox" checked={tc.isHidden} onChange={e => updateTestCase(i, 'isHidden', e.target.checked)} className="w-4 h-4 rounded" />
                    Hidden test case
                  </label>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2"><Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Question'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={q.id} className="card hover:border-dark-600 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-dark-800 px-2 py-1 rounded">Q{i + 1}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${q.type === 'coding' ? 'bg-accent/10 text-accent' : 'bg-warning/10 text-warning'}`}>
                    {q.type === 'coding' ? 'Coding' : 'MCQ'}
                  </span>
                  <span className="text-xs text-dark-400">{q.marks} marks</span>
                </div>
                <h3 className="text-lg font-medium mt-2">{q.title}</h3>
                <p className="text-sm text-dark-400 mt-1 line-clamp-2">{q.description}</p>
                {q.type === 'coding' && q.testCases && (
                  <p className="text-xs text-dark-500 mt-2">{q.testCases.length} test cases ({q.testCases.filter(tc => tc.isHidden).length} hidden)</p>
                )}
              </div>
              <button onClick={() => handleDeleteQuestion(q.id)} className="p-2 hover:bg-dark-700 rounded-lg"><Trash2 className="w-4 h-4 text-danger" /></button>
            </div>
          </div>
        ))}
        {questions.length === 0 && !showForm && (
          <div className="text-center py-12 text-dark-400">
            <p>No questions yet. Click &ldquo;Add Question&rdquo; to start.</p>
          </div>
        )}
      </div>
    </div>
  );
}
