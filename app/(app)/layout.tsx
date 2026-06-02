import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import SidebarNav from "@/components/SidebarNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-200/80 bg-white/80 p-5 backdrop-blur md:flex">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-soft">
            V
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Visa CRM</p>
            <p className="text-xs text-slate-400">Admin panel</p>
          </div>
        </div>

        <SidebarNav />

        <div className="mt-auto border-t border-slate-100 pt-4">
          <div className="mb-3 flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold uppercase text-brand-600">
              {session.username.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-700">
                {session.username}
              </p>
              <p className="text-xs text-slate-400">Administrator</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl p-6 md:p-10">{children}</div>
      </main>
    </div>
  );
}
