/**
 * Cover shield boxes with solid fills. Solid boxes, not blur: blurred or
 * pixelated text can often be recovered.
 */

import sharp from 'sharp';
import type { ShieldBox } from './detect';

export async function getImageSize(png: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) throw new Error('Image has no dimensions');
  return { width: meta.width, height: meta.height };
}

/** Return a new PNG with every box painted solid black. Boxes must already be clamped. */
export async function applyRedactions(png: Buffer, boxes: ShieldBox[]): Promise<Buffer> {
  if (boxes.length === 0) return png;
  const overlays = boxes.map((box) => ({
    input: { create: { width: box.w, height: box.h, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 1 } } },
    left: box.x,
    top: box.y,
  }));
  return sharp(png).composite(overlays).png().toBuffer();
}
