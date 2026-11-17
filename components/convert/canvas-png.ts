"use client";

import type { ImageConverter } from "@/lib/hwp-browser";

/** 캔버스로 그림을 PNG로 바꾼다(BMP처럼 문서에 넣을 수 없는 래스터). 브라우저 전용. */
export const canvasToPng: ImageConverter = async (bytes, mime) => {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
    const bmp = await createImageBitmap(new Blob([bytes.slice()], { type: mime }));
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height } : null;
  } catch {
    return null;
  }
};
