# Visa-CRM - Tizim arxitekturasi (DESIGN)

VFS Global viza arizalarini boshqaradigan CRM + avtomatlashtirish platformasi.
Operatorlar arizachilarni (applicant) yuklaydi, tizim VFS saytida ularning
nomidan akkaunt ochadi (register), kiradi (login), slot tekshiradi va buyurtma
(order) qiladi - barchasi anti-detect real Chrome + rezidensial proksi orqali.

> Til eslatmasi: UI va loglar o'zbekcha. Kod izohlari ham o'zbekcha.

---

## 1. Texnologiyalar

| Qatlam | Texnologiya |
| --- | --- |
| Web / API | Next.js 14.2 (App Router), React 18, TailwindCSS |
| ORM / DB | Prisma 5.22 + MySQL 8 |
| Navbat (queue) | RabbitMQ (amqplib) - `order.jobs` |
| Kesh / lock | Redis (ioredis) - profil-lock, heartbeat, dedupe |
| Brauzer avtomatlashtirish | Playwright 1.60 + real Google Chrome (CDP) |
| Anti-detect | playwright-extra + stealth, WebRTC/WebGL/hardware spoof, OS-click Turnstile |
| Proksi | IPRoyal sticky residential (UZ) |
| Bot | Telegram (`scripts/bot.ts`) |
| Pochta | IMAP (imapflow + mailparser) - aktivatsiya xatlari |

---

## 2. Yuqori darajadagi arxitektura

```mermaid
flowchart TB
    subgraph UI["Next.js (web + API)"]
        DASH["Dashboard / panellar"]
        API["/api/* (middleware auth)"]
    end

    subgraph DATA["Malumotlar qatlami"]
        DB[("MySQL - Prisma")]
        MQ[["RabbitMQ - order.jobs"]]
        REDIS[("Redis - lock/heartbeat")]
    end

    subgraph WORKERS["Workerlar (avtomatlashtirish)"]
        POOL["worker-pool (N lane, DB-driven)"]
        ORDER["order-worker (legacy single)"]
        SLOT["slot-worker"]
        MAIL["mail-worker"]
    end

    subgraph EXT["Tashqi"]
        VFS["VFS Global sayti"]
        PROXY["IPRoyal proksi"]
        IMAP["Gmail IMAP"]
        TG["Telegram"]
    end

    DASH --> API
    API --> DB
    API -- enqueue --> MQ
    POOL -- consume --> MQ
    ORDER -- consume --> MQ
    POOL --> REDIS
    POOL --> DB
    SLOT --> DB
    MAIL --> DB
    POOL -- real Chrome + proxy --> VFS
    SLOT --> VFS
    MAIL --> IMAP
    POOL --> PROXY
    TG <--> API
```

**Oqim qisqacha:** operator dashboard yoki Telegram orqali ish (job) qo'yadi ->
ish RabbitMQ `order.jobs` navbatiga tushadi -> worker lane uni oladi, Redisda
arizachining gmail profilini bloklaydi (parallel ziddiyat bo'lmasin) -> real
Chrome + sticky proksi bilan VFSda bosqichni bajaradi -> natija MySQLga
(`AutomationLog`, `Applicant`) yoziladi.

---

## 3. Asosiy malumot modeli (Prisma)

- **Group** - arizachilar guruhi (bitta yuklamada kelganlar). `slotId?` orqali
  `Slot`ga bog'lanadi.
- **Applicant** - bitta arizachi. `generatedEmail` / `generatedPassword` /
  `profileKey` (VFS akkaunt), `status` (NEW->EDITED->BOOKING->REGISTERED->
  ORDERED->BOOKED->FAILED), `activationStatus`, register/order timing maydonlari.
- **Slot** - yo'nalish + vaqt oynasi (`fromCountry`/`toCountry`, `slotAt`,
  `windowMinutes`, `registerLeadMinutes`, `centre`/`category`/`subCategory`).
- **AutomationLog** - har bir bosqich urinishining to'liq logi (stage, ok,
  durationMs, proxy/IP/statusCode, navMs, pageError, `workerProfile`).
- **SlotEvent** - slot monitoring hodisalari (open/expired/configure/...).
- **Worker** - *(yangi, 4-bobga qarang)* worker registri (id, name, active,
  status, jobsDone...).
- **SlotMonitor** - eski singleton monitoring holati (Telegram boti
  ishlatadi, 6-bobga qarang).

Schema o'zgartirilganda **`npm run db:push`** ishlatiladi (additive nullable
o'zgarishlar xavfsiz; loyiha migration emas, db push usulidan foydalanadi),
so'ng **`npm run db:generate`**.

---

## 4. Worker boshqaruv tizimi (DB-driven pool) - YANGI

### 4.1 Maqsad

Workerlarni bazaga bog'lab boshqarish. Har bir worker o'z **id + name**ini
bazadan oladi. Default bazada **10 ta** worker turadi. Operator nechtasini
ishlatishni boshqaradi: kerak bo'lsa 8 tasini active qiladi, zarur bo'lsa yana
10 ta qo'shib 20 tasini ishlatadi. Soni **CPU yadrolariga** bog'liq.

### 4.2 Komponentlar

| Fayl | Vazifa |
| --- | --- |
| `prisma/schema.prisma` -> `Worker` | Worker registri (id, name, active, status, pid, host, currentJob, jobsDone, lastError, claimedAt, lastSeenAt). |
| `lib/workers.ts` | Registr + CPU mantiqi (seed, list, active count, add, claim, heartbeat, CPU advice). |
| `scripts/worker-pool.ts` (`npm run workers:run`) | Supervisor: active workerlarni o'qiydi va har biriga bitta consumer lane ochadi. |
| `scripts/workers.ts` (`npm run workers ...`) | Boshqaruv CLI (list / on / off / add / enable / disable / cpu). |
| `app/api/workers/route.ts` | GET holat + CPU advice; POST amallar (on/off/add/enable/disable). |
| `components/WorkersPanel.tsx` | Dashboard paneli: jonli holat, CPU banner, boshqaruv tugmalari. |

### 4.3 CPU bilan bog'liqlik (muhim)

Har bir **active worker = 1 ta haqiqiy Chrome** ochadi. Chrome CPU va operativ
xotira sarflaydi. Shuning uchun bir vaqtda nechta worker ishlay olishi
serverning CPU yadrolariga bog'liq:

```
recommendedMax = cpuCores x WORKER_PER_CPU      (WORKER_PER_CPU default = 2)
```

Masalan 16 yadroli serverda tavsiya etilgan maksimal = **32 ta** active worker.

- Active workerlar soni `recommendedMax`dan **oshmasa** - hammasi parallel,
  to'liq tezlikda ishlaydi.
- **Oshsa** - workerlar bir-birini kutadi (CPU yetmaydi), navbat sekinlashadi.
  CLI/panel ogohlantiradi: *"Siz maksimalga yetdingiz. Yana ko'proq parallel
  ishlatmoqchi bo'lsangiz - serverga yana CPU yadro qo'shing."*

`WORKER_PER_CPU` env orqali sozlanadi (Chrome og'ir bo'lgani uchun default 2,
ya'ni 1 yadro ~ 2 worker).

### 4.4 Ishlash tartibi ("tartib bilan")

- `ensureSeed()` bazada kamida `WORKER_DEFAULT_COUNT` (10) ta worker borligini
  taminlaydi: `worker-01 ... worker-10`, hammasi `active=true`.
- `worker-pool` **active** workerlarni **id bo'yicha tartib bilan** o'qiydi va
  har biriga RabbitMQ `order.jobs`dan ish oladigan bitta lane ochadi.
- Har bir lane o'z worker identifikatorini (id + name) DBga yozadi va holatini
  (status busy/idle, currentJob, jobsDone, lastSeenAt) yangilab turadi.
- `setActiveCount(8)` = tartib bo'yicha birinchi 8 tasi active, qolgani off.
- `addWorkers(10)` = raqamlashni davom ettirib yana 10 ta qo'shadi
  (`worker-11 ... worker-20`).

### 4.5 Boshqaruv (CLI)

```bash
npm run workers              # ro'yxat + CPU malumot
npm run workers on 8         # tartib bo'yicha birinchi 8 tasini active
npm run workers off 2        # active sonidan 2 tasini o'chiradi
npm run workers add 10       # yana 10 ta worker qo'shadi
npm run workers enable 3     # id=3 ni yoqadi
npm run workers disable 3    # id=3 ni o'chiradi
npm run workers cpu          # CPU sig'imi haqida tushuntirish
npm run workers:run          # poolni ishga tushiradi (N lane)
```

Xuddi shu amallar dashboarddagi **Workerlar (pool)** panelidan ham bajariladi.

### 4.6 `order-worker` bilan munosabat

Eski `scripts/order-worker.ts` (`npm run worker:order`) - bitta consumer,
Docker `replicas`i orqali masshtablanadi (orqaga moslik uchun saqlangan). U
Redis heartbeat ishlatadi, DB Worker identifikatorini olmaydi. Yangi
`worker-pool` esa bitta jarayonda DB-driven N lane beradi - dinamik
"8 active / 20 active" boshqaruvi uchun afzal. Ikkalasi bir vaqtda ishlay
oladi (RabbitMQ ishlarni teng taqsimlaydi).

---

## 5. Booking pipeline (bosqichlar)

`register -> login -> order` (+ `activation` yon-bosqich). `lib/booking.ts`
markaziy: `runStageWithRetry` har bosqichni `ORDER_MAX_ATTEMPTS` marta urinadi,
har urinishni `AutomationLog`ga yozadi.

- **register** - VFS akkaunt ochish (`lib/automation/register.ts`): email/parol/
  telefon + 3 rozilik checkbox + Turnstile -> Register tugmasi. So'ng VFS
  aktivatsiya xati yuboradi.
- **activation** - aktivatsiya linkini userning register profilida ochish
  (`lib/automation/activation.ts`). Linkni Gmail IMAPdan `mail-listener.ts`
  topadi (catch-all `@uzbekvisa.uz`).
- **login** - VFSga kirish (`lib/automation/login.ts` + `login-form.ts`).
- **order** - slot ochiq bo'lsa buyurtma berish.

Har bir user o'z **gmail profili** (sticky proksi IP + persistent Chrome profil
papkasi) bilan ishlaydi -> cookie/sessiya saqlanadi, IP barqaror.

---

## 6. Slot monitoring

Ikki tizim mavjud:

1. **Per-slot engine (joriy)** - `Slot` modeli + `lib/slots.ts` `runSlotTick(id)`.
   `scripts/slot-worker.ts` (`npm run worker:slot`) har `SLOT_WORKER_INTERVAL_MS`
   da active+!paused slotlarni tekshiradi (`lib/automation/calendar.ts`
   `detectCalendar`), slot ochilsa Telegramga screenshot bilan xabar beradi va
   tegishli guruhlarni navbatga qo'shadi.
2. **Singleton monitor (legacy)** - `lib/slot-monitor.ts`. Telegram botining
   `/monitor`, `/pause`, `/go` buyruqlari shuni ishlatadi (`getSlotMonitorState`,
   `setSlotMonitorState`, `runSlotMonitorTick`). Per-slot tizim bilan
   almashtirilgan, lekin bot hali shunga bog'liq - **shuning uchun saqlanadi**.

> Eslatma: eski dashboard UI (`SlotMonitorBar`/`SlotMonitorModal` +
> `/api/slot-monitor`) Phase 25 ning "Saytni qo'lda tekshirish" paneli bilan
> almashtirildi va olib tashlandi. `lib/slot-monitor.ts` esa botda
> ishlatilgani uchun qoldirildi.

---

## 7. Anti-detect / avtomatlashtirish steki

`lib/automation/` ichida:

- **browser.ts** - real Chrome CDP (`connectRealChrome`), persistent profil
  (`profileDirFor`), stealth init (WebRTC/WebGL/hardwareConcurrency/deviceMemory
  spoof - raw CDP `Page.addScriptToEvaluateOnNewDocument` orqali).
- **turnstile.ts** - Cloudflare Turnstile yechish. Auto-pass bo'lmasa **OS-level
  fizik mishka click** (Windows: kompilyatsiya qilingan `os-click.cs` .exe;
  Linux/Docker: Xvfb + xdotool). Shadow-DOM iframe o'lchash, frame-error detect.
- **login-form.ts** - login formasi yadrosi (login + slot-check ham ishlatadi).
- **session.ts** - VFS token/sessionStorage saqlash/tiklash (token reuse =
  asosiy tezlik yutug'i).
- **proxy** (`lib/proxy.ts`) - IPRoyal sticky residential. `profileKey` bo'yicha
  barqaror IP; salt (`aN`) bilan IP almashtirish (rate-limit bo'lsa).

> esbuild/tsx gotcha: `page.evaluate`/`addInitScript` ichida **nomlangan**
> funksiya yozmang (`__name is not defined`) - faqat anonim inline callback yoki
> source-string ishlating.

---

## 8. Manual "Saytni qo'lda tekshirish" paneli (Phase 25)

Dashboarddagi `components/SiteCheckPanel.tsx` + `app/api/site-check/route.ts`:

- **Umumiy slot tekshiruvi** - `Slot` modelga bog'liq emas, VFS saytini jonli
  tekshiradi (`checkSlotOpen`, sinxron).
- **User bo'yicha** - arizachini qidirib, Register/Login/Activation/Order
  amallarini navbatga qo'shish (worker bajaradi), natija jonli ko'rinadi.

Barcha `/api/*` `middleware.ts` orqali sessiya cookie bilan himoyalangan (admin
auth) - shu sabab worker paneli va site-check paneli ham himoyalangan.

---

## 9. Ishga tushirish (skriptlar)

```bash
# Web
npm run dev                  # Next.js dev
npm run build && npm start   # production

# Workerlar
npm run workers:run          # DB-driven pool (yangi)
npm run worker:order         # bitta order consumer (legacy / Docker)
npm run worker:slot          # slot monitoring
npm run worker:mail          # aktivatsiya pochta listener

# Boshqaruv / DB
npm run workers              # worker boshqaruv CLI
npm run db:push              # schema -> MySQL
npm run db:generate          # Prisma client
npm run db:studio            # Prisma Studio

# Telegram bot
npm run bot

# Diagnostika (zero-VFS, xavfsiz)
npm run proxy:check          # proksi IP/geo
npm run stealth:check        # anti-detect runtime tekshiruv
```

---

## 10. Deployment (Docker)

`docker-compose.yml` servislari: `migrate` (bir martalik prisma generate +
db push), `app`, `bot`, `order-worker` (replicas), `slot-worker`,
`mail-worker`, `mysql`, `rabbitmq`, `redis`.

- Dockerfile real Google Chrome (`npx playwright install chrome`) + Xvfb +
  xdotool o'rnatadi (Linux interaktiv Turnstile uchun).
- Worker/Linux env: `BOOKING_CHROME_CDP=true`, `BOOKING_CHROME_PATH=
  /usr/bin/google-chrome`, `BOOKING_XVFB=true`, `DISPLAY=:99`,
  `BOOKING_HEADLESS=false`, `BOOKING_OS_CLICK=true`.
- `.env` gitignored (sirlar). Faqat kod commit qilinadi.

---

## 11. Asosiy environment o'zgaruvchilar (worker tizimi)

| Var | Default | Mano |
| --- | --- | --- |
| `WORKER_DEFAULT_COUNT` | 10 | Bazadagi default worker soni |
| `WORKER_PER_CPU` | 2 | 1 CPU yadrosiga to'g'ri keladigan worker |
| `WORKER_STALE_MS` | 60000 | Worker "stale" deb hisoblanadigan vaqt (heartbeat) |
| `ORDER_QUEUE_NAME` | order.jobs | RabbitMQ navbat nomi |
| `ORDER_WORKER_PREFETCH` | 1 | Har consumer bir vaqtda oladigan ish |
| `RABBITMQ_URL` | amqp://guest:guest@127.0.0.1:5672 | RabbitMQ |
| `REDIS_URL` | redis://127.0.0.1:6379 | Redis |

(Booking/anti-detect/proksi envlari uchun `.env` izohlariga qarang.)
