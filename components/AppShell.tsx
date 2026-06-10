"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  HambergerMenu,
  CloseSquare,
  SidebarLeft,
  SidebarRight,
  ShieldTick,
} from "iconsax-react";
import SidebarNav from "@/components/SidebarNav";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import HighCpuBanner from "@/components/HighCpuBanner";

export default function AppShell({
  username,
  children,
}: {
  username: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Yig'ilgan holatni eslab qolamiz.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar:collapsed") === "1");
    } catch {}
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar:collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  // Sahifa o'zgarsa mobil drawer yopiladi.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Drawer ochiqligida body scroll'ni qulflaymiz.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const initial = username.slice(0, 1).toUpperCase();

  const sidebarInner = (mobile: boolean) => {
    const iconOnly = collapsed && !mobile;
    return (
      <>
        {/* Logo + sarlavha */}
        <div
          className={`mb-6 flex items-center ${
            iconOnly ? "justify-center" : "gap-3"
          }`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <Image
              src="/logo.png"
              alt="Visa CRM"
              width={40}
              height={40}
              className="h-full w-full object-contain"
              priority
              unoptimized
            />
          </div>
          {!iconOnly && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                Visa CRM
              </p>
              <p className="text-xs text-slate-400">Admin panel</p>
            </div>
          )}
          {mobile && (
            <button
              onClick={() => setMobileOpen(false)}
              className="icon-btn ml-auto"
              aria-label="Yopish"
            >
              <CloseSquare size={20} variant="Bold" />
            </button>
          )}
        </div>

        <SidebarNav
          collapsed={iconOnly}
          onNavigate={() => mobile && setMobileOpen(false)}
        />

        <div
          className={`mt-auto space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800 ${
            iconOnly ? "flex flex-col items-center" : ""
          }`}
        >
          <div className={iconOnly ? "" : "w-full"}>
            <ThemeToggle collapsed={iconOnly} />
          </div>

          {iconOnly ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold uppercase text-white shadow-soft ring-2 ring-white dark:ring-slate-800"
                title={username}
              >
                {initial}
              </div>
              <LogoutButton collapsed />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-100 dark:bg-slate-800/50 dark:ring-slate-700/60">
                <div className="relative shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold uppercase text-white shadow-soft">
                    {initial}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-50 bg-emerald-500 dark:border-slate-800" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {username}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-slate-400">
                    <ShieldTick size={12} variant="Bold" className="text-emerald-500" />
                    Administrator
                  </p>
                </div>
              </div>
              <LogoutButton />
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200/80 bg-white/70 p-4 backdrop-blur-xl transition-[width] duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900/50 md:flex ${
          collapsed ? "w-[76px]" : "w-64"
        }`}
      >
        {sidebarInner(false)}

        {/* Yig'ish/yoyish tugmasi */}
        <button
          onClick={toggleCollapse}
          className="absolute -right-3 top-7 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 md:flex"
          aria-label={collapsed ? "Yoyish" : "Yig'ish"}
        >
          {collapsed ? (
            <SidebarRight size={14} variant="Bold" />
          ) : (
            <SidebarLeft size={14} variant="Bold" />
          )}
        </button>
      </aside>

      {/* Mobile drawer + overlay */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200/80 bg-white p-4 shadow-xl transition-transform duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900 md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarInner(true)}
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile topbar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/60 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="icon-btn"
            aria-label="Menyu"
          >
            <HambergerMenu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
              V
            </div>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Visa CRM
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <HighCpuBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
