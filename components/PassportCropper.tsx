"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { DocumentDownload, Scissor } from "iconsax-react";

// Normalizatsiyalangan (0..1) qirqish to'rtburchagi.
export type CropBox = { x: number; y: number; w: number; h: number };

type Handle = "move" | "nw" | "ne" | "sw" | "se";

const PHOTO_SIZE = 600;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Berilgan rasm (img) va normallashtirilgan box bo'yicha kvadrat 600x600 JPEG
// (oq fon) hamda aniq qirqilgan PNG hosil qiladi.
function renderCrops(
  img: HTMLImageElement,
  box: CropBox,
): Promise<{ png: File; jpeg: File }> {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const sx = Math.round(box.x * W);
  const sy = Math.round(box.y * H);
  const sw = Math.max(1, Math.round(box.w * W));
  const sh = Math.max(1, Math.round(box.h * H));

  // 1) Aniq qirqilgan PNG (qo'l bilan tanlangan o'lcham).
  const pngCanvas = document.createElement("canvas");
  pngCanvas.width = sw;
  pngCanvas.height = sh;
  pngCanvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  // 2) Standart 600x600 JPEG (markazlashgan, oq fon).
  const sq = document.createElement("canvas");
  sq.width = PHOTO_SIZE;
  sq.height = PHOTO_SIZE;
  const ctx = sq.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    // Tanlangan sohani kvadratga proporsional joylaymiz (contain).
    const scale = Math.min(PHOTO_SIZE / sw, PHOTO_SIZE / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (PHOTO_SIZE - dw) / 2;
    const dy = (PHOTO_SIZE - dh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  return new Promise((resolve) => {
    pngCanvas.toBlob((pngBlob) => {
      sq.toBlob(
        (jpegBlob) => {
          resolve({
            png: new File(
              [pngBlob ?? new Blob()],
              "passport-foto.png",
              { type: "image/png" },
            ),
            jpeg: new File(
              [jpegBlob ?? new Blob()],
              "passport-photo.jpg",
              { type: "image/jpeg" },
            ),
          });
        },
        "image/jpeg",
        0.92,
      );
    }, "image/png");
  });
}

export default function PassportCropper({
  src,
  initialBox,
  onCropped,
}: {
  src: string; // to'g'rilangan rasm dataURL/objectURL
  initialBox: CropBox;
  onCropped: (png: File, jpeg: File) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [box, setBox] = useState<CropBox>(initialBox);
  const [preview, setPreview] = useState<string | null>(null);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    start: CropBox;
  } | null>(null);

  // Tanlangan sohadan PNG + JPEG yasab, ota komponentga uzatamiz.
  const emit = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    const { png, jpeg } = await renderCrops(img, box);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(png);
    });
    onCropped(png, jpeg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  // Rasm yuklangach yoki box o'zgargach (sudrash tugagach) yangilaymiz.
  function onImgLoad() {
    emit();
  }

  function pointerDown(e: React.PointerEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...box },
    };
  }

  function pointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const s = drag.start;
    let next: CropBox = { ...s };

    if (drag.handle === "move") {
      next.x = clamp(s.x + dx, 0, 1 - s.w);
      next.y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      let x1 = s.x;
      let y1 = s.y;
      let x2 = s.x + s.w;
      let y2 = s.y + s.h;
      if (drag.handle.includes("w")) x1 = clamp(s.x + dx, 0, x2 - 0.05);
      if (drag.handle.includes("e")) x2 = clamp(s.x + s.w + dx, x1 + 0.05, 1);
      if (drag.handle.includes("n")) y1 = clamp(s.y + dy, 0, y2 - 0.05);
      if (drag.handle.includes("s")) y2 = clamp(s.y + s.h + dy, y1 + 0.05, 1);
      next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    setBox(next);
  }

  function pointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    emit();
  }

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handles: { pos: Handle; cls: string }[] = [
    { pos: "nw", cls: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
    { pos: "ne", cls: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize" },
    { pos: "sw", cls: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
    { pos: "se", cls: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" },
  ];

  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <Scissor size={14} variant="Bold" className="text-brand-500" />
        Rasmni qo'lda aniq qirqing — to'rtburchakni suring/cho'zing
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div
          ref={wrapRef}
          className="relative flex-1 select-none overflow-hidden rounded-lg ring-1 ring-slate-200"
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt="passport"
            onLoad={onImgLoad}
            draggable={false}
            className="block w-full"
          />
          {/* Tashqi sohani 4 ta qorong'i chiziq bilan qoplaymiz (tanlov yorug' qoladi) */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 bg-black/45"
            style={{ height: `${box.y * 100}%` }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45"
            style={{ height: `${(1 - box.y - box.h) * 100}%` }}
          />
          <div
            className="pointer-events-none absolute left-0 bg-black/45"
            style={{
              top: `${box.y * 100}%`,
              height: `${box.h * 100}%`,
              width: `${box.x * 100}%`,
            }}
          />
          <div
            className="pointer-events-none absolute right-0 bg-black/45"
            style={{
              top: `${box.y * 100}%`,
              height: `${box.h * 100}%`,
              width: `${(1 - box.x - box.w) * 100}%`,
            }}
          />
          {/* Tanlov to'rtburchagi */}
          <div
            className="absolute cursor-move ring-2 ring-brand-400"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
            onPointerDown={(e) => pointerDown(e, "move")}
          >
            {handles.map((h) => (
              <span
                key={h.pos}
                onPointerDown={(e) => pointerDown(e, h.pos)}
                className={`absolute h-3.5 w-3.5 rounded-full border-2 border-brand-500 bg-white shadow ${h.cls}`}
              />
            ))}
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-2 sm:w-40">
          <div className="h-32 w-32 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="qirqilgan"
                className="h-full w-full object-contain"
              />
            )}
          </div>
          <p className="text-center text-[11px] text-slate-400">
            Natija (saqlanadi)
          </p>
          {preview && (
            <a
              href={preview}
              download="passport-foto.png"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100"
            >
              <DocumentDownload size={14} variant="Bold" /> PNG
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
