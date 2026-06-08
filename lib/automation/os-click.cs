// ====================================================================
//  OS-DARAJASIDAGI SICHQONCHA KLIK (Windows) — kichik C# CONSOLE/WIN .exe
// ====================================================================
//  Nega .exe? powershell.exe + Add-Type HAR klikda ~3-5s (sovuq start 1.8s +
//  .NET tip yuklash 1.5s). Bu "vaqt juda ko'p" ning ASOSIY sababi edi. Bu
//  C# kichik .exe ga BIR MARTA (umrida) kompilyatsiya qilinadi (TEMP'ga cache),
//  keyin HAR klik to'g'ridan-to'g'ri .exe ni chaqiradi: .NET console start
//  ~0.1s + kursor harakati ~0.4s = JAMI ~0.5s (birinchi klikda ham).
//
//  Ishlatish:  VfsOsClick.exe <x> <y> [pid]
//    x, y : FIZIK ekran piksellari (devicePixelRatio bilan ko'paytirilgan).
//    pid  : chrome.exe PID — oynani foreground'ga ko'tarish uchun (ixtiyoriy).
//
//  WindowsApplication subsystem (konsol oynasi chaqnamaydi). Kursorni inson
//  kabi (tasodifiy burchak + egri yo'l + mikro-tebranish) ko'chirib chap bosadi.
// ====================================================================
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public class VfsOsClick
{
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);

    const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
    static readonly Random rng = new Random();

    static void Main(string[] args)
    {
        if (args.Length < 2) return;
        int x, y, pid = 0;
        if (!int.TryParse(args[0], out x)) return;
        if (!int.TryParse(args[1], out y)) return;
        if (args.Length >= 3) int.TryParse(args[2], out pid);

        // Fizik piksellar bilan ishlash uchun per-monitor DPI-aware (aks holda
        // SetCursorPos mantiqiy piksel kutadi — koordinata noto'g'ri tushadi).
        try { SetProcessDpiAwareness(2); } catch { }

        Focus(FindChrome(pid));
        Thread.Sleep(60);
        Click(x, y);
    }

    // Chrome oynasini TEZ topadi (uzun siklsiz). pid'da MainWindowHandle bo'lmasa
    // (CDP-Chrome'da ko'p uchraydi) — sarlavhasi bor istalgan chrome.exe oynasi.
    static IntPtr FindChrome(int pid)
    {
        try
        {
            if (pid > 0)
            {
                var p = Process.GetProcessById(pid);
                if (p != null && p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle;
            }
        }
        catch { }
        try
        {
            foreach (var p in Process.GetProcessesByName("chrome"))
                if (p.MainWindowHandle != IntPtr.Zero && !string.IsNullOrEmpty(p.MainWindowTitle))
                    return p.MainWindowHandle;
        }
        catch { }
        return IntPtr.Zero;
    }

    // Oynani ENG USTGA ko'taradi (foreground-lock'ni AttachThreadInput bilan chetlab).
    static void Focus(IntPtr h)
    {
        if (h == IntPtr.Zero) return;
        try
        {
            uint FLAGS = 0x0001 | 0x0002 | 0x0040; // NOSIZE|NOMOVE|SHOWWINDOW
            ShowWindow(h, 9);                       // SW_RESTORE
            uint fgPid;
            IntPtr fg = GetForegroundWindow();
            uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
            uint myThread = GetCurrentThreadId();
            AttachThreadInput(fgThread, myThread, true);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, FLAGS);
            AttachThreadInput(fgThread, myThread, false);
        }
        catch { }
    }

    // Kursorni INSON KABI (tasodifiy burchak + EGRI yo'l + tebranish) ko'chirib bosadi.
    static void Click(int x, int y)
    {
        int tx = x + rng.Next(-3, 4);   // nishonga ±3px tasodifiy siljish
        int ty = y + rng.Next(-3, 4);
        double ang = rng.NextDouble() * Math.PI * 2;   // har gal boshqa tomondan
        int dist = rng.Next(28, 56);
        int sx = (int)(tx + Math.Cos(ang) * dist);
        int sy = (int)(ty + Math.Sin(ang) * dist);
        SetCursorPos(sx, sy);
        Thread.Sleep(rng.Next(18, 40));

        double dx = tx - sx, dy = ty - sy;
        double len = Math.Sqrt(dx * dx + dy * dy); if (len < 1) len = 1;
        double px = -dy / len, py = dx / len;          // perpendikulyar (egrilik)
        int bow = rng.Next(-12, 13);
        int steps = rng.Next(6, 10);
        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            double te = t * t * (3 - 2 * t);            // smoothstep (boshi/oxiri sekin)
            double curve = Math.Sin(t * Math.PI) * bow; // o'rtada eng ko'p egiladi
            int mx = (int)(sx + dx * te + px * curve + rng.Next(-1, 2));
            int my = (int)(sy + dy * te + py * curve + rng.Next(-1, 2));
            SetCursorPos(mx, my);
            Thread.Sleep(rng.Next(5, 12));
        }
        SetCursorPos(tx, ty);
        Thread.Sleep(rng.Next(35, 70));
        mouse_event(LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(rng.Next(28, 60));
        mouse_event(LEFTUP, 0, 0, 0, IntPtr.Zero);
    }
}
