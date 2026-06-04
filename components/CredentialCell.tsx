"use client";

import { useState } from "react";
import { Sms, Key, Copy, TickCircle, Eye, EyeSlash } from "iconsax-react";

// VFS akkaunt ma'lumotlari: tizim email va generatsiya qilingan parol.
// Ro'yxatda to'liq ko'rinadi, bitta tugma bilan nusxa olinadi.
export default function CredentialCell({
  email,
  password,
}: {
  email: string | null;
  password: string;
}) {
  const [copied, setCopied] = useState<"email" | "pass" | "both" | null>(null);
  const [show, setShow] = useState(false);

  async function copy(text: string, key: "email" | "pass" | "both") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard yo'q bo'lsa jim o'tamiz */
    }
  }

  if (!email) {
    return <span className="text-slate-300">—</span>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => copy(email, "email")}
        title="Emaildan nusxa olish"
        className="group inline-flex items-center gap-1.5 text-left text-xs text-slate-600 transition hover:text-brand-600 dark:text-slate-300"
      >
        <Sms size={13} variant="Bold" className="shrink-0 text-brand-400" />
        <span className="font-mono">{email}</span>
        {copied === "email" ? (
          <TickCircle size={13} variant="Bold" className="text-emerald-500" />
        ) : (
          <Copy
            size={13}
            className="text-slate-300 opacity-0 transition group-hover:opacity-100"
          />
        )}
      </button>

      <button
        type="button"
        onClick={() => copy(password, "pass")}
        title="Paroldan nusxa olish"
        className="group inline-flex items-center gap-1.5 text-left text-xs text-slate-600 transition hover:text-brand-600 dark:text-slate-300"
      >
        <Key size={13} variant="Bold" className="shrink-0 text-amber-400" />
        <span className="font-mono">{show ? password : "••••••••"}</span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setShow((v) => !v);
          }}
          className="text-slate-300 transition hover:text-slate-500"
          title={show ? "Yashirish" : "Ko'rsatish"}
        >
          {show ? <EyeSlash size={13} /> : <Eye size={13} />}
        </span>
        {copied === "pass" ? (
          <TickCircle size={13} variant="Bold" className="text-emerald-500" />
        ) : (
          <Copy
            size={13}
            className="text-slate-300 opacity-0 transition group-hover:opacity-100"
          />
        )}
      </button>
    </div>
  );
}
