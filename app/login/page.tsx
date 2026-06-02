"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock1, User, Eye, EyeSlash, ArrowRight } from "iconsax-react";
import { useToast } from "@/components/Toast";

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Kirishda xatolik");
        return;
      }
      toast("Xush kelibsiz!");
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
      {/* Animated gradient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-blob absolute -left-20 top-0 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="animate-blob animation-delay-2000 absolute -right-20 top-10 h-96 w-96 rounded-full bg-violet-600/40 blur-3xl" />
        <div className="animate-blob animation-delay-4000 absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-sky-500/30 blur-3xl" />
      </div>

      {/* Grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="animate-float mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-3xl font-bold text-white shadow-2xl shadow-brand-600/40 ring-1 ring-white/20">
            V
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Visa CRM
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Admin paneliga xush kelibsiz
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Login
            </label>
            <div className="relative">
              <User
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-brand-400 focus:bg-white/10 focus:ring-2 focus:ring-brand-500/30"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Parol
            </label>
            <div className="relative">
              <Lock1
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-brand-400 focus:bg-white/10 focus:ring-2 focus:ring-brand-500/30"
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                aria-label="Parolni ko'rsatish"
              >
                {showPass ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/15 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <button
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition-all hover:from-brand-400 hover:to-brand-500 hover:shadow-brand-500/40 active:scale-[.98] disabled:opacity-60"
            disabled={loading}
          >
            {loading ? (
              "Kirilyapti..."
            ) : (
              <>
                Kirish
                <ArrowRight
                  size={18}
                  className="transition-transform group-hover:translate-x-1"
                />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          © 2026 Visa CRM · Barcha huquqlar himoyalangan
        </p>
      </div>
    </div>
  );
}
