"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Category,
  Profile2User,
  People,
  Chart,
  DocumentText,
} from "iconsax-react";

const LINKS = [
  { href: "/dashboard", label: "Boshqaruv paneli", icon: Category },
  { href: "/groups", label: "Guruhlar", icon: Profile2User },
  { href: "/users", label: "Userlar", icon: People },
  { href: "/documents", label: "Hujjatlar", icon: DocumentText },
  { href: "/monitoring", label: "Monitoring", icon: Chart },
];

export default function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1">
      {LINKS.map((link) => {
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
      })}
    </nav>
  );
}
