'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { LayoutDashboard, FileText, LogOut, ShieldAlert } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isLoading, loadFromStorage, logout } = useAuth();

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'admin')) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a]">
      <aside className="w-64 glass-strong border-r border-slate-700/20 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-700/20">
          <Link href="/admin" className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/15">
              <span className="text-lg font-bold text-white">G</span>
            </div>
            <div>
              <span className="text-lg font-bold text-white tracking-tight">GRAVITON</span>
              <p className="text-[10px] text-slate-500 -mt-0.5">Admin Console</p>
            </div>
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/admin" className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-slate-800/40 hover:text-white transition-all duration-200">
            <LayoutDashboard className="w-5 h-5" /> Dashboard
          </Link>
          <Link href="/admin/tests" className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-slate-800/40 hover:text-white transition-all duration-200">
            <FileText className="w-5 h-5" /> Tests
          </Link>
        </nav>
        <div className="p-4 border-t border-slate-700/20">
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center text-sm font-bold text-white">
              {user.firstName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{user.firstName} {user.lastName}</p>
              <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button onClick={() => { logout(); router.push('/login'); }}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-500 hover:text-red-400 rounded-xl hover:bg-slate-800/40 transition-all duration-200">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-grid">{children}</main>
    </div>
  );
}
