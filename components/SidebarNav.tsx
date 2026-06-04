"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Category, Profile2User, People, Chart } from "iconsax-react";

const LINKS = [
  { href: "/dashboard", label: "Boshqaruv paneli", icon: Category },
  { href: "/groups", label: "Guruhlar", icon: Profile2User },
  { href: "/users", label: "Userlar", icon: People },
  { href: "/monitoring", label: "Monitoring", icon: Chart },
];

export default function SidebarNav() {
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
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              active
                ? "bg-brand-600 text-white shadow-sm"
                : "text-slate-500 hover:bg-brand-50 hover:text-brand-700"
            }`}
          >
            <Icon
              size={19}
              variant={active ? "Bold" : "Linear"}
              className={active ? "text-white" : ""}
            />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
