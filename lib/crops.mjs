import { PNG } from "pngjs";

/** Clamp a document-space rectangle into an image of the given size. */
export function clampRect(rect, width, height) {
  const x = Math.max(0, Math.min(Math.round(rect?.x ?? 0), width));
  const y = Math.max(0, Math.min(Math.round(rect?.y ?? 0), height));
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.round(rect?.width ?? 0), width - x)),
    height: Math.max(0, Math.min(Math.round(rect?.height ?? 0), height - y)),
  };
}

/**
 * Slice a section out of an already captured full-page screenshot. Cropping
 * the stored image (instead of re-rendering the element) guarantees the crop
 * is exactly the pixels the full-page diff scored.
 */
export function cropPng(buffer, rect) {
  const image = PNG.sync.read(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const view = clampRect(rect, image.width, image.height);
  if (view.width < 1 || view.height < 1) return null;
  const cropped = new PNG({ width: view.width, height: view.height });
  PNG.bitblt(image, cropped, view.x, view.y, view.width, view.height, 0, 0);
  return PNG.sync.write(cropped);
}
