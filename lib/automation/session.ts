// ====================================================================
//  SESSION — VFS token/sessiya saqlash, tiklash, marker fayllar
// ====================================================================
//  Bu modul VFS avtomatlashtirish uchun BARCHA disk-holatini bir joyda
//  saqlaydi — token (localStorage + sessionStorage), dropdown variantlari
//  va backoff/cooldown markerlari. calendar.ts (slot-check), order-worker,
//  va web (Next.js API) — hammasi shu moduldan foydalanadi.
//
//  Hammasi profileKey bo'yicha alohida fayllarda, slotMonitorProfileBase()
//  papkasida (default: uploads/slot-monitor-profiles).
//
//  DIQQAT: saveSession/restoreSession Playwright Page talab qiladi (brauzer
//  kerak). Qolgan funksiyalar (marker, options o'qish) toza Node — web'da
//  brauzersiz ham ishlaydi.
// ====================================================================

import * as fs from "fs";
import * as path from "path";
import type { Page } from "playwright";

function envStr(name: string, fallback = ""): string {
  return (process.env[name] || "").trim() || fallback;
}

/** profileKey'ni fayl nomi uchun xavfsiz ko'rinishga keltiradi. */
function safeKey(profileKey: string): string {
  return profileKey.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
}

/**
 * Slot-monitor uchun ALOHIDA, doimiy profil/holatlar bazasi. Bu yerda token,
 * dropdown variantlari va markerlar saqlanadi. register/order profilidan
 * ajratilgan. .env: SLOT_MONITOR_PROFILE_DIR (default uploads/slot-monitor-profiles).
 */
export function slotMonitorProfileBase(): string {
  const rel =
    envStr("SLOT_MONITOR_PROFILE_DIR") ||
    path.join("uploads", "slot-monitor-profiles");
  return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
}

// ====================================================================
//  TOKEN / SESSIYA (localStorage + sessionStorage)
// ====================================================================

/** Saqlangan sessiya (token) fayli — har profileKey uchun alohida. */
export function sessionStorePath(profileKey: string): string {
  return path.join(
    slotMonitorProfileBase(),
    `session-${safeKey(profileKey)}.json`,
  );
}

/** Diskda saqlangan sessiya fayli bormi? (brauzersiz tekshiruv.) */
export function hasStoredSession(profileKey: string): boolean {
  try {
    return fs.existsSync(sessionStorePath(profileKey));
  } catch {
    return false;
  }
}

/**
 * Sahifadan localStorage + sessionStorage'ni o'qib, diskka saqlaydi. VFS token'ni
 * sessionStorage'da saqlaydi — u brauzer yopilganda yo'qoladi. Shuni faylga
 * yozib qo'yamiz, keyingi tekshiruvda qayta tiklaymiz (qayta login KERAK EMAS).
 */
export async function saveSession(
  page: Page,
  profileKey: string,
): Promise<void> {
  try {
    const data = await page.evaluate(() => {
      const ls: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) ls[k] = localStorage.getItem(k) ?? "";
      }
      const ss: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k) ss[k] = sessionStorage.getItem(k) ?? "";
      }
      return { ls, ss };
    });
    // Token bormi? (bo'sh sessiyani saqlamaymiz.)
    const hasAny =
      Object.keys(data.ls).length > 0 || Object.keys(data.ss).length > 0;
    if (!hasAny) return;
    const file = sessionStorePath(profileKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ savedAt: Date.now(), ...data }),
      "utf8",
    );
  } catch {
    /* sessiyani saqlay olmadik — muhim emas, keyingi safar login bo'ladi */
  }
}

/**
 * Diskdagi saqlangan sessiyani (localStorage + sessionStorage) sahifaga TIKLAYDI.
 * DIQQAT: sahifa AYNI origin'da ochilgan bo'lishi kerak (storage origin'ga bog'liq).
 * Tiklangan bo'lsa true qaytaradi.
 */
export async function restoreSession(
  page: Page,
  profileKey: string,
): Promise<boolean> {
  try {
    const file = sessionStorePath(profileKey);
    if (!fs.existsSync(file)) return false;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      ls?: Record<string, string>;
      ss?: Record<string, string>;
    };
    await page.evaluate((d) => {
      try {
        for (const [k, v] of Object.entries(d.ls || {}))
          localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(d.ss || {}))
          sessionStorage.setItem(k, v);
      } catch {
        /* storage yozib bo'lmadi */
      }
    }, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saqlangan sessiya faylini O'CHIRADI. Token eskirib 401 ("Session Expired")
 * bersa chaqiriladi — shunda keyingi tekshiruv uni qayta SINAMAYDI (sekin 401
 * yo'lini takrorlamasin) va toza login qiladi.
 */
export function clearSession(profileKey: string): void {
  try {
    const file = sessionStorePath(profileKey);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* o'chira olmadik — muhim emas */
  }
}

// ====================================================================
//  VFS DROPDOWN VARIANTLARI (centre / category / subCategory)
// ====================================================================

export type VfsOptionsSelected = {
  centre: string | null;
  category: string | null;
  subCategory: string | null;
};

export type VfsOptionsData = {
  centre: string[];
  category: string[];
  subCategory: string[];
  selected: VfsOptionsSelected;
};

export type VfsOptionsFile = {
  savedAt: string;
  selected: VfsOptionsSelected;
  centre: string[];
  category: string[];
  subCategory: string[];
};

/** VFS dropdown variantlari (centre/category/subCategory) saqlanadigan fayl. */
export function vfsOptionsPath(profileKey: string): string {
  return path.join(
    slotMonitorProfileBase(),
    `vfs-options-${safeKey(profileKey)}.json`,
  );
}

/**
 * VFS application-detail dropdownlaridan o'qilgan variantlar ro'yxatini diskka
 * saqlaydi — KELAJAKDA formalar (centre/category/subCategory tanlash) uchun.
 * Har tekshiruvda yangilanadi; bo'sh ro'yxatlar eski qiymatni o'chirmaydi.
 */
export function saveVfsOptions(profileKey: string, data: VfsOptionsData): void {
  try {
    const hasAny =
      data.centre.length > 0 ||
      data.category.length > 0 ||
      data.subCategory.length > 0;
    if (!hasAny) return;
    const file = vfsOptionsPath(profileKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Eski faylni o'qib, bo'sh kelgan ro'yxatni eski qiymat bilan to'ldiramiz
    // (bog'liq dropdown ochilmay qolsa, oldingi ro'yxat yo'qolmasin).
    let prev: {
      centre?: string[];
      category?: string[];
      subCategory?: string[];
    } = {};
    try {
      if (fs.existsSync(file)) prev = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* eski fayl buzuq — e'tibor bermaymiz */
    }
    const merged: VfsOptionsFile = {
      savedAt: new Date().toISOString(),
      selected: data.selected,
      centre: data.centre.length ? data.centre : prev.centre || [],
      category: data.category.length ? data.category : prev.category || [],
      subCategory: data.subCategory.length
        ? data.subCategory
        : prev.subCategory || [],
    };
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), "utf8");
  } catch {
    /* saqlay olmadik — muhim emas */
  }
}

/**
 * Saqlangan VFS dropdown variantlarini o'qiydi (web formalarida ishlatish uchun).
 * Fayl yo'q yoki buzuq bo'lsa null.
 */
export function loadVfsOptions(profileKey: string): VfsOptionsFile | null {
  try {
    const file = vfsOptionsPath(profileKey);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as VfsOptionsFile;
  } catch {
    return null;
  }
}

/**
 * BARCHA profillardagi VFS dropdown variantlarini (centre/category/subCategory)
 * o'qib, birlashtiradi (web forma — Sozlamalardagi dropdownlar uchun). Hech bir
 * fayl bo'lmasa bo'sh ro'yxatlar qaytadi. Brauzersiz (toza Node) ishlaydi.
 */
export function loadAllVfsOptions(): {
  centre: string[];
  category: string[];
  subCategory: string[];
} {
  const out = {
    centre: [] as string[],
    category: [] as string[],
    subCategory: [] as string[],
  };
  try {
    const base = slotMonitorProfileBase();
    if (!fs.existsSync(base)) return out;
    const seen = {
      centre: new Set<string>(),
      category: new Set<string>(),
      subCategory: new Set<string>(),
    };
    for (const f of fs.readdirSync(base)) {
      if (!/^vfs-options-.*\.json$/.test(f)) continue;
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(base, f), "utf8"),
        ) as Partial<VfsOptionsFile>;
        for (const key of ["centre", "category", "subCategory"] as const) {
          for (const v of data[key] || []) {
            const t = (v || "").trim();
            if (t && !seen[key].has(t)) {
              seen[key].add(t);
              out[key].push(t);
            }
          }
        }
      } catch {
        /* buzuq fayl — o'tkazib yuboramiz */
      }
    }
  } catch {
    /* muhim emas — bo'sh ro'yxat qaytadi */
  }
  return out;
}

// ====================================================================
//  429001 BACKOFF MARKER (akkaunt vaqtincha bloklangan)
// ====================================================================

/** 429001 backoff marker fayli — akkaunt necha vaqtgacha tinch qoldirilsin. */
export function restrictedMarkerPath(profileKey: string): string {
  return path.join(
    slotMonitorProfileBase(),
    `restricted-${safeKey(profileKey)}.json`,
  );
}

/** 429001 aniqlansa — backoff yozamiz (default 720 min urinmaymiz). */
export function markRestricted(profileKey: string): void {
  try {
    const min = Number(process.env.SLOT_RESTRICTED_BACKOFF_MIN || 720);
    const file = restrictedMarkerPath(profileKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ until: Date.now() + Math.max(1, min) * 60_000 }),
      "utf8",
    );
  } catch {
    /* muhim emas */
  }
}

/** Backoff hali tugamaganmi? Tugamagan bo'lsa necha daqiqa qolganini qaytaradi. */
export function restrictedRemainingMin(profileKey: string): number {
  try {
    const file = restrictedMarkerPath(profileKey);
    if (!fs.existsSync(file)) return 0;
    const { until } = JSON.parse(fs.readFileSync(file, "utf8")) as {
      until?: number;
    };
    if (!until) return 0;
    const remMs = until - Date.now();
    if (remMs <= 0) {
      fs.rmSync(file, { force: true });
      return 0;
    }
    return Math.ceil(remMs / 60_000);
  } catch {
    return 0;
  }
}

/** 429001 backoff markerini O'CHIRADI (qo'lda qayta urinishga ruxsat). */
export function clearRestricted(profileKey: string): void {
  try {
    const file = restrictedMarkerPath(profileKey);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* muhim emas */
  }
}

// ====================================================================
//  LOGIN COOLDOWN MARKER (akkauntni tez-tez login qilib charchatmaslik)
// ====================================================================

/** Oxirgi login urinishi vaqti yoziladigan fayl. */
export function lastLoginPath(profileKey: string): string {
  return path.join(
    slotMonitorProfileBase(),
    `lastlogin-${safeKey(profileKey)}.json`,
  );
}

/** Login urinilganini yozamiz (cooldown hisoblash uchun). */
export function markLoginAttempt(profileKey: string): void {
  try {
    const file = lastLoginPath(profileKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: Date.now() }), "utf8");
  } catch {
    /* muhim emas */
  }
}

/**
 * Login COOLDOWN: oxirgi login'dan beri SLOT_LOGIN_COOLDOWN_MIN (default 30)
 * daqiqa o'tmagan bo'lsa — QAYTA LOGIN QILMAYMIZ (har login VFS 429001 blokini
 * uzaytiradi). Qolgan daqiqani qaytaradi (0 = login qilsa bo'ladi).
 */
export function loginCooldownRemainingMin(profileKey: string): number {
  try {
    const min = Number(process.env.SLOT_LOGIN_COOLDOWN_MIN || 30);
    if (min <= 0) return 0;
    const file = lastLoginPath(profileKey);
    if (!fs.existsSync(file)) return 0;
    const { at } = JSON.parse(fs.readFileSync(file, "utf8")) as { at?: number };
    if (!at) return 0;
    const remMs = at + min * 60_000 - Date.now();
    return remMs <= 0 ? 0 : Math.ceil(remMs / 60_000);
  } catch {
    return 0;
  }
}

/** Login cooldown markerini O'CHIRADI (darrov qayta login qilishga ruxsat). */
export function clearLoginAttempt(profileKey: string): void {
  try {
    const file = lastLoginPath(profileKey);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* muhim emas */
  }
}
