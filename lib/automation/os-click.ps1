# ====================================================================
#  OS-DARAJASIDAGI SICHQONCHA KLIK (Windows) — Turnstile uchun
# ====================================================================
#  Cloudflare Turnstile checkbox'ini HAQIQIY OS kursori bilan bosadi.
#  page.mouse.click (CDP) EMAS — user32.dll SetCursorPos + mouse_event.
#  Bu inson klikidan farq qilmaydi (isTrusted, CDP izi yo'q).
#
#  Ishlatish:
#    powershell -File os-click.ps1 -x 1234 -y 567 -procId 4242
#    powershell -File os-click.ps1 -procId 4242 -focusOnly   (faqat fokus)
#
#  -x, -y     : FIZIK ekran piksellari (devicePixelRatio bilan ko'paytirilgan).
#  -procId    : chrome.exe PID — oynani foreground'ga ko'tarish uchun (ixtiyoriy).
#  -focusOnly : faqat oynani fokuslaydi, klik qilmaydi.
# ====================================================================

param(
  [int]$x = 0,
  [int]$y = 0,
  [int]$procId = 0,
  [switch]$focusOnly
)

# ── user32 P/Invoke C# ni BIR MARTA kompilyatsiya qilib, DLL'ni CACHE qilamiz ──
# Add-Type HAR spawn'da C# manbani csc.exe bilan QAYTADAN kompilyatsiya qiladi
# (~2-3s) — "vaqt juda ko'p" ning ASOSIY sababi aynan shu edi. DLL'ni bir marta
# TEMP'ga yozib, keyingi HAR klikda tayyor DLL'ni yuklaymiz (~0.2s) => ~3s tez.
$src = @"
using System;
using System.Runtime.InteropServices;
public class OsClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

# Cache: DLL yo'q bo'lsa BIR MARTA kompilyatsiya qilib yozamiz, keyin yuklaymiz.
$dll = Join-Path $env:TEMP "VfsOsClick_v1.dll"
if (-not (Test-Path $dll)) {
  try { Add-Type -TypeDefinition $src -OutputAssembly $dll -OutputType Library -ErrorAction Stop } catch {}
}
if (Test-Path $dll) {
  try { Add-Type -Path $dll -ErrorAction Stop } catch {}
}
# Zaxira: cache yozilmasa/yuklanmasa — to'g'ridan-to'g'ri (sekin, lekin ishlaydi).
if (-not ([System.Management.Automation.PSTypeName]'OsClick').Type) {
  Add-Type -TypeDefinition $src
}

# Fizik piksellar bilan ishlash uchun jarayonni per-monitor DPI-aware qilamiz.
# (Aks holda SetCursorPos mantiqiy piksel kutadi — koordinata noto'g'ri tushadi.)
try { [OsClick]::SetProcessDpiAwareness(2) | Out-Null } catch {}

# ── Oynani MAJBURAN eng ustga ko'taramiz (chrome.exe PID orqali) ──────────────
# Windows "foreground lock" SetForegroundWindow'ni bloklaydi — shuning uchun
# AttachThreadInput bilan oldingi foreground thread'ga ulanib, qulfni chetlab
# o'tamiz, so'ng SetWindowPos(HWND_TOP) bilan oynani hamma narsa USTIGA chiqaramiz
# (VS Code/terminal ostida qolib ketmasligi uchun — klik aynan shu sabab xato edi).
if ($procId -gt 0) {
  try {
    $h = [IntPtr]::Zero
    for ($i = 0; $i -lt 20; $i++) {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $h = $p.MainWindowHandle; break }
      Start-Sleep -Milliseconds 150
    }
    if ($h -ne [IntPtr]::Zero) {
      $HWND_TOP = [IntPtr]::Zero
      $HWND_NOTOPMOST = [IntPtr](-2)
      $SWP_FLAGS = 0x0001 -bor 0x0002 -bor 0x0040   # NOSIZE|NOMOVE|SHOWWINDOW

      [OsClick]::ShowWindow($h, 9) | Out-Null        # SW_RESTORE (minimized bo'lsa)

      $fgPid = [uint32]0
      $fg = [OsClick]::GetForegroundWindow()
      $fgThread = [OsClick]::GetWindowThreadProcessId($fg, [ref]$fgPid)
      $myThread = [OsClick]::GetCurrentThreadId()

      [OsClick]::AttachThreadInput($fgThread, $myThread, $true) | Out-Null
      [OsClick]::BringWindowToTop($h) | Out-Null
      [OsClick]::SetForegroundWindow($h) | Out-Null
      # Oynani z-tartibda ENG USTGA qo'yamiz (boshqa oynalar ostida qolmasin).
      [OsClick]::SetWindowPos($h, $HWND_TOP, 0, 0, 0, 0, $SWP_FLAGS) | Out-Null
      [OsClick]::AttachThreadInput($fgThread, $myThread, $false) | Out-Null
      Start-Sleep -Milliseconds 120
    }
  } catch {}
}

if ($focusOnly) { exit 0 }

# ── Kursorni INSON KABI (tasodifiy, EGRI yo'l bilan) ko'chirib, chap klik ─────
# Turnstile/anti-bot kursor TRAEKTORIYASINI kuzatadi. Har safar AYNAN bir xil
# yo'l + bir xil tezlik + bir xil nuqta = bot izi. Shuning uchun HAR safar:
#   • nishonga ±3px tasodifiy siljish (aynan o'sha piksel emas),
#   • tasodifiy YO'NALISH va masofadan yaqinlashish (har gal boshqa tomondan),
#   • EGRI yo'l (perpendikulyar "bow") + smoothstep (boshi/oxiri sekin, inson kabi),
#   • har qadamda mikro-tebranish + tasodifiy kechikishlar,
#   • tasodifiy bosib-turish (down→up) vaqti.
$rng = New-Object System.Random

# Nishonga kichik tasodifiy siljish — checkbox ~24px, ±3px xavfsiz.
$tx = $x + $rng.Next(-3, 4)
$ty = $y + $rng.Next(-3, 4)

# Tasodifiy burchak + masofadan boshlaymiz (har safar boshqa tomondan keladi).
$ang = $rng.NextDouble() * [math]::PI * 2
$dist = $rng.Next(28, 56)
$startX = [int]($tx + [math]::Cos($ang) * $dist)
$startY = [int]($ty + [math]::Sin($ang) * $dist)
[OsClick]::SetCursorPos($startX, $startY) | Out-Null
Start-Sleep -Milliseconds $rng.Next(20, 45)

# Yo'nalish va unga PERPENDIKULYAR birlik vektor (egrilik uchun).
$dx = $tx - $startX
$dy = $ty - $startY
$len = [math]::Sqrt($dx * $dx + $dy * $dy); if ($len -lt 1) { $len = 1 }
$px = -$dy / $len
$py = $dx / $len
$bow = $rng.Next(-12, 13)           # egrilik amplitudasi (px), yo'nalishi tasodifiy
$steps = $rng.Next(6, 10)           # qadamlar soni ham tasodifiy (snappy, sekin emas)
for ($i = 1; $i -le $steps; $i++) {
  $t = $i / $steps
  $te = $t * $t * (3 - 2 * $t)                    # smoothstep — boshi/oxiri sekin
  $curve = [math]::Sin($t * [math]::PI) * $bow    # o'rtada eng ko'p egiladi
  $cx = [int]($startX + $dx * $te + $px * $curve + $rng.Next(-1, 2))
  $cy = [int]($startY + $dy * $te + $py * $curve + $rng.Next(-1, 2))
  [OsClick]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds $rng.Next(5, 13)
}
[OsClick]::SetCursorPos($tx, $ty) | Out-Null
Start-Sleep -Milliseconds $rng.Next(40, 80)
[OsClick]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero) | Out-Null   # LEFTDOWN
Start-Sleep -Milliseconds $rng.Next(30, 65)
[OsClick]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero) | Out-Null   # LEFTUP
exit 0
