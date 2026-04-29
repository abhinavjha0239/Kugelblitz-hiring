'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Upload, CheckCircle2, Loader2 } from 'lucide-react';
import { testsService } from '@/services/tests.service';
import { pdfIngestionService } from '@/services/pdf-ingestion.service';
import { ParsedPdfQuestion, PdfUploadPreview, Test } from '@/types';

export default function QuestionBankUploadPage() {
  const [tests, setTests] = useState<Test[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState('');
  const [preview, setPreview] = useState<PdfUploadPreview | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [questions, setQuestions] = useState<ParsedPdfQuestion[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await testsService.getAll(1, 200);
        setTests(res.tests);
        if (res.tests.length) setSelectedTestId(res.tests[0].id);
      } catch (error: any) {
        toast.error(error.message);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!uploadId || !processing) return;
    const timer = setInterval(async () => {
      try {
        const res = await pdfIngestionService.getUpload(uploadId);
        setPreview(res);
        if (res.parsedQuestions) setQuestions(res.parsedQuestions);
        if (['preview_ready', 'partial', 'failed', 'confirmed'].includes(res.status)) {
          setProcessing(false);
          if (res.status === 'failed') toast.error(res.errorMessage || 'Parsing failed');
        }
      } catch (error: any) {
        setProcessing(false);
        toast.error(error.message);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [uploadId, processing]);

  const validCount = useMemo(() => questions.filter((q) => q.status === 'valid').length, [questions]);

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please choose a PDF first');
      return;
    }
    setProcessing(true);
    setPreview(null);
    setQuestions([]);
    try {
      const res = await pdfIngestionService.uploadPdf(file);
      setUploadId(res.uploadId);
      toast.success('Upload started. Parsing in background...');
    } catch (error: any) {
      setProcessing(false);
      toast.error(error.message);
    }
  };

  const updateQuestion = (idx: number, next: Partial<ParsedPdfQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...next } : q)));
  };

  const updateOption = (qIdx: number, optionIdx: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx) return q;
        const options = [...q.options] as [string, string, string, string];
        options[optionIdx] = value;
        return { ...q, options };
      }),
    );
  };

  const removeQuestion = (idx: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleConfirm = async () => {
    if (!uploadId || !selectedTestId) {
      toast.error('Select test and upload first');
      return;
    }
    setSaving(true);
    try {
      const payloadQuestions = questions
        .map((q) => pdfIngestionService.normalizeQuestionForSave(q))
        .filter((q) => q.text.trim() && q.options.every((opt) => opt.trim()));
      const res = await pdfIngestionService.confirmUpload({
        uploadId,
        testId: selectedTestId,
        questions: payloadQuestions,
      });
      toast.success(`Saved ${res.inserted} questions to test`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">PDF Question Bank Ingestion</h1>
          <p className="text-dark-400 text-sm mt-1">Upload PDF, preview parsed MCQs, then save to a test.</p>
        </div>
      </div>

      <div className="card space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-dark-300 mb-1.5">Target Test</label>
          <select
            className="input-field"
            value={selectedTestId}
            onChange={(e) => setSelectedTestId(e.target.value)}
          >
            {tests.map((test) => (
              <option key={test.id} value={test.id}>
                {test.title} ({test.durationMinutes} min)
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-dark-300 mb-1.5">PDF File</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="input-field"
            />
          </div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={processing}
            className="btn-primary flex items-center gap-2"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {processing ? 'Processing...' : 'Upload PDF'}
          </button>
        </div>

        {preview && (
          <div className="bg-dark-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span>Status: <strong>{preview.status}</strong></span>
              <span>{preview.progress}%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2">
              <div className="bg-accent h-2 rounded-full" style={{ width: `${preview.progress}%` }} />
            </div>
            <div className="mt-3 text-dark-300">
              Parsing {preview.stats?.total || 0} questions... Valid: {preview.stats?.valid || 0}, Invalid: {preview.stats?.invalid || 0}
            </div>
            {preview.errorMessage && <p className="mt-2 text-danger">{preview.errorMessage}</p>}
          </div>
        )}
      </div>

      {questions.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Preview ({questions.length} questions)</h2>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving || validCount === 0}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Saving...' : `Confirm Save (${validCount} valid)`}
            </button>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-dark-400 border-b border-dark-700">
                  <th className="py-2 pr-3">Question</th>
                  <th className="py-2 pr-3">Options</th>
                  <th className="py-2 pr-3">Correct</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q, idx) => (
                  <tr key={`${idx}-${q.text.slice(0, 20)}`} className="border-b border-dark-800 align-top">
                    <td className="py-3 pr-3 min-w-[260px]">
                      <textarea
                        className="input-field min-h-[110px]"
                        value={q.text}
                        onChange={(e) => updateQuestion(idx, { text: e.target.value })}
                      />
                    </td>
                    <td className="py-3 pr-3 min-w-[320px]">
                      <div className="space-y-2">
                        {q.options.map((opt, optIdx) => (
                          <input
                            key={optIdx}
                            className="input-field"
                            value={opt}
                            onChange={(e) => updateOption(idx, optIdx, e.target.value)}
                            placeholder={`Option ${optIdx + 1}`}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <select
                        className="input-field"
                        value={q.correctOption ?? ''}
                        onChange={(e) =>
                          updateQuestion(idx, {
                            correctOption: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="0">Option 1</option>
                        <option value="1">Option 2</option>
                        <option value="2">Option 3</option>
                        <option value="3">Option 4</option>
                      </select>
                    </td>
                    <td className="py-3 pr-3">
                      <div className={q.status === 'valid' ? 'text-success' : 'text-warning'}>
                        {q.status}
                      </div>
                      {q.issues?.length > 0 && (
                        <p className="text-xs text-warning mt-1">{q.issues.join(', ')}</p>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => removeQuestion(idx)}
                        className="text-danger hover:text-danger/80"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
