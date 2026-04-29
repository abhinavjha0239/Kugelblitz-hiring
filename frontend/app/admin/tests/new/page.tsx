'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { testsService } from '@/services/tests.service';
import { LANGUAGES } from '@/types';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';

export default function CreateTestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    durationMinutes: 60,
    isActive: false,
    startsAt: '',
    endsAt: '',
    allowedLanguages: [71, 63, 54, 62] as number[],
  });

  const update = (field: string, value: any) => setForm((p) => ({ ...p, [field]: value }));

  const toggleLang = (langId: number) => {
    setForm((p) => ({
      ...p,
      allowedLanguages: p.allowedLanguages.includes(langId)
        ? p.allowedLanguages.filter((l) => l !== langId)
        : [...p.allowedLanguages, langId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data: any = {
        title: form.title,
        description: form.description,
        durationMinutes: form.durationMinutes,
        isActive: form.isActive,
        allowedLanguages: form.allowedLanguages,
      };
      if (form.startsAt) data.startsAt = new Date(form.startsAt).toISOString();
      if (form.endsAt) data.endsAt = new Date(form.endsAt).toISOString();

      const test = await testsService.create(data);
      toast.success('Test created!');
      router.push(`/admin/tests/${test.id}/questions`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg"><ArrowLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold">Create New Test</h1>
          <p className="text-dark-400 text-sm mt-1">Configure your assessment</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">Basic Info</h2>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Title</label>
            <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} className="input-field" placeholder="e.g. JavaScript Fundamentals Test" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} className="input-field min-h-[100px]" placeholder="Describe this test..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Duration (minutes)</label>
              <input type="number" value={form.durationMinutes} onChange={(e) => update('durationMinutes', parseInt(e.target.value))} className="input-field" min="1" required />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={(e) => update('isActive', e.target.checked)} className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-accent" />
                <span className="text-sm font-medium">Active (visible to students)</span>
              </label>
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">Schedule (Optional)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Starts At</label>
              <input type="datetime-local" value={form.startsAt} onChange={(e) => update('startsAt', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Ends At</label>
              <input type="datetime-local" value={form.endsAt} onChange={(e) => update('endsAt', e.target.value)} className="input-field" />
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">Allowed Languages</h2>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(LANGUAGES).map(([id, lang]) => (
              <label key={id} className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg cursor-pointer hover:bg-dark-700 transition-colors">
                <input type="checkbox" checked={form.allowedLanguages.includes(Number(id))} onChange={() => toggleLang(Number(id))} className="w-4 h-4 rounded border-dark-600 bg-dark-800 text-accent" />
                <span className="text-sm">{lang.name}</span>
              </label>
            ))}
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
          <Save className="w-5 h-5" /> {loading ? 'Creating...' : 'Create Test'}
        </button>
      </form>
    </div>
  );
}
