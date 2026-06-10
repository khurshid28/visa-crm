"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Category,
  Profile2User,
  People,
  Chart,
  DocumentText,
  Calendar,
  Ticket,
  Box,
  Setting2,
} from "iconsax-react";

const LINKS = [
  { href: "/dashboard", label: "Boshqaruv paneli", icon: Category },
  { href: "/slots", label: "Slotlar", icon: Calendar },
  { href: "/groups", label: "Guruhlar", icon: Profile2User },
  { href: "/users", label: "Userlar", icon: People },
  { href: "/documents", label: "Hujjatlar", icon: DocumentText },
  { href: "/monitoring", label: "Monitoring", icon: Chart },
  { href: "/workers", label: "Workerlar", icon: Box },
];

// Eng pastda turadigan havola(lar).
const BOTTOM_LINKS = [
  { href: "/tickets", label: "Tiketlar", icon: Ticket },
  { href: "/settings", label: "Sozlamalar", icon: Setting2 },
];

export default function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const renderLink = (link: (typeof LINKS)[number]) => {
    const active =
      pathname === link.href || pathname.startsWith(link.href + "/");
    const Icon = link.icon;
    return (
      <Link
        key={link.href}
        href={link.href}
        onClick={onNavigate}
        title={collapsed ? link.label : undefined}
        className={`group relative flex items-center rounded-xl text-sm font-medium transition-all ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
        } ${
          active
            ? "bg-brand-600 text-white shadow-sm"
            : "text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-400 dark:hover:bg-brand-500/10 dark:hover:text-brand-300"
        }`}
      >
        <Icon
          size={19}
          variant={active ? "Bold" : "Linear"}
          className={active ? "text-white" : ""}
        />
        {!collapsed && link.label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-1 flex-col gap-1">
      {LINKS.map(renderLink)}

      {/* Eng pastdagi havolalar (mt-auto bilan pastga suriladi) */}
      <div className="mt-auto flex flex-col gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
        {BOTTOM_LINKS.map(renderLink)}
      </div>
    </nav>
  );
}
