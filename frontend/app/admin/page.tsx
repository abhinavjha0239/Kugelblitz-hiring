'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { testsService } from '@/services/tests.service';
import { Test } from '@/types';
import { formatDate } from '@/lib/utils';
import { Plus, FileText, Users, Activity, Eye, Trash2, Monitor, ShieldAlert, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminDashboard() {
  const [tests, setTests] = useState<Test[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

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
    if (!confirm('Are you sure you want to delete this test?')) return;
    try {
      await testsService.delete(id);
      toast.success('Test deleted');
      loadTests();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-dark-400 mt-1">Manage your coding assessments</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/question-bank" className="btn-secondary flex items-center gap-2">
            <Upload className="w-5 h-5" /> Upload PDF
          </Link>
          <Link href="/admin/tests/new" className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" /> Create Test
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="card flex items-center gap-4">
          <div className="p-3 bg-accent/10 rounded-lg"><FileText className="w-6 h-6 text-accent" /></div>
          <div><p className="text-2xl font-bold">{total}</p><p className="text-sm text-dark-400">Total Tests</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="p-3 bg-success/10 rounded-lg"><Activity className="w-6 h-6 text-success" /></div>
          <div><p className="text-2xl font-bold">{tests.filter(t => t.isActive).length}</p><p className="text-sm text-dark-400">Active Tests</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="p-3 bg-warning/10 rounded-lg"><Users className="w-6 h-6 text-warning" /></div>
          <div><p className="text-2xl font-bold">{tests.reduce((a, t) => a + (t.totalMarks || 0), 0)}</p><p className="text-sm text-dark-400">Total Marks</p></div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-dark-400">Loading tests...</div>
      ) : tests.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-dark-600 mx-auto mb-4" />
          <p className="text-dark-400 mb-4">No tests yet. Create your first test!</p>
          <Link href="/admin/tests/new" className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-5 h-5" /> Create Test
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {tests.map((test) => (
            <div key={test.id} className="card flex items-center justify-between hover:border-dark-600 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">{test.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${test.isActive ? 'bg-success/10 text-success' : 'bg-dark-700 text-dark-400'}`}>
                    {test.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-sm text-dark-400 mt-1">{test.description || 'No description'}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-dark-400">
                  <span>{test.durationMinutes} min</span>
                  <span>{test.totalMarks} marks</span>
                  <span>{formatDate(test.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <Link href={`/admin/tests/${test.id}/questions`} className="p-2 hover:bg-dark-700 rounded-lg transition-colors" title="Questions">
                  <Eye className="w-5 h-5 text-dark-400" />
                </Link>
                <Link href={`/admin/tests/${test.id}/monitor`} className="p-2 hover:bg-dark-700 rounded-lg transition-colors" title="Monitor">
                  <Monitor className="w-5 h-5 text-dark-400" />
                </Link>
                <Link href={`/admin/results/${test.id}`} className="p-2 hover:bg-dark-700 rounded-lg transition-colors" title="Results">
                  <Activity className="w-5 h-5 text-dark-400" />
                </Link>
                <Link href={`/admin/proctoring/${test.id}`} className="p-2 hover:bg-dark-700 rounded-lg transition-colors" title="Proctoring">
                  <ShieldAlert className="w-5 h-5 text-warning" />
                </Link>
                <button onClick={() => handleDelete(test.id)} className="p-2 hover:bg-dark-700 rounded-lg transition-colors" title="Delete">
                  <Trash2 className="w-5 h-5 text-danger" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
