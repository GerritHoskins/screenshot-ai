/**
 * Capture review: covered boxes are drawn solid black, exactly as they will be sent.
 * Click a detected box to uncover or re-cover it; drag on the image to cover more;
 * click a box you drew to remove it.
 */

import type { ShieldPreviewBox, ShieldPreviewPayload } from '../preload/shield';

interface ShieldApi {
  onPreview: (cb: (payload: ShieldPreviewPayload) => void) => void;
  submit: (boxes: ShieldPreviewBox[]) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    shieldApi: ShieldApi;
  }
}

type EditableBox = ShieldPreviewBox & { covered: boolean };

const NOTICES: Record<ShieldPreviewPayload['notice'], string | null> = {
  none: null,
  'scan-failed': 'ScreenshotAI could not scan this capture for secrets. Check it yourself and cover anything sensitive.',
  'scan-unavailable': 'Automatic secret detection is not available on this system. Cover anything sensitive yourself.',
  'shield-off': 'The secret shield is off, so nothing was covered automatically.',
};
const MIN_DRAG = 6;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = el<HTMLDivElement>('stage');
// Created here so the page never ships an <img> without a source.
const image = document.createElement('img');
image.alt = 'Your capture';
const summary = el<HTMLSpanElement>('summary');
const sendButton = el<HTMLButtonElement>('send');

let payload: ShieldPreviewPayload | null = null;
let boxes: EditableBox[] = [];
let finished = false;

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function render(): void {
  if (!payload) return;
  stage.querySelectorAll('.box').forEach((node) => node.remove());
  boxes.forEach((box, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `box ${box.covered ? 'covered' : 'uncovered'}`;
    Object.assign(button.style, {
      left: pct(box.x, payload!.width), top: pct(box.y, payload!.height),
      width: pct(box.w, payload!.width), height: pct(box.h, payload!.height),
    });
    const label = box.source === 'manual' ? 'Area you covered' : box.label ?? 'Possible secret';
    const action = box.source === 'manual' ? 'Click to remove' : box.covered ? 'Click to uncover' : 'Click to cover again';
    button.setAttribute('aria-label', `${label}. ${action}.`);
    button.setAttribute('aria-pressed', String(box.covered));
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `${label} · ${action}`;
    button.appendChild(tag);
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', () => {
      if (box.source === 'manual') boxes.splice(index, 1);
      else box.covered = !box.covered;
      render();
    });
    stage.appendChild(button);
  });

  const detected = boxes.filter((b) => b.source === 'detected');
  const coveredDetected = detected.filter((b) => b.covered).length;
  const manual = boxes.filter((b) => b.source === 'manual').length;
  const parts: string[] = [];
  if (detected.length > 0) {
    const kinds = [...new Set(detected.map((b) => b.label ?? 'Possible secret'))].join(', ');
    parts.push(`${coveredDetected} of ${detected.length} possible ${detected.length === 1 ? 'secret' : 'secrets'} covered (${kinds}).`);
  } else if (payload.notice === 'none') {
    parts.push('No secrets found.');
  }
  if (manual > 0) parts.push(`${manual} ${manual === 1 ? 'area' : 'areas'} covered by you.`);
  parts.push('Drag on the image to cover more.');
  summary.textContent = parts.join(' ');
}

function fitStage(): void {
  if (!payload) return;
  const main = stage.parentElement!;
  const availableW = main.clientWidth - 32;
  const availableH = main.clientHeight - 32;
  const scale = Math.min(1, availableW / payload.width, availableH / payload.height);
  stage.style.width = `${Math.max(1, Math.floor(payload.width * scale))}px`;
  stage.style.height = `${Math.max(1, Math.floor(payload.height * scale))}px`;
}

function toImagePoint(event: PointerEvent): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
  return { x: (x / rect.width) * payload!.width, y: (y / rect.height) * payload!.height };
}

let dragStart: { x: number; y: number } | null = null;
let draft: HTMLDivElement | null = null;

stage.addEventListener('pointerdown', (event) => {
  if (!payload || event.button !== 0) return;
  dragStart = toImagePoint(event);
  stage.setPointerCapture(event.pointerId);
  draft = document.createElement('div');
  draft.className = 'draft';
  stage.appendChild(draft);
});

stage.addEventListener('pointermove', (event) => {
  if (!dragStart || !draft || !payload) return;
  const point = toImagePoint(event);
  Object.assign(draft.style, {
    left: pct(Math.min(dragStart.x, point.x), payload.width), top: pct(Math.min(dragStart.y, point.y), payload.height),
    width: pct(Math.abs(point.x - dragStart.x), payload.width), height: pct(Math.abs(point.y - dragStart.y), payload.height),
  });
});

stage.addEventListener('pointerup', (event) => {
  if (!dragStart || !payload) return;
  const point = toImagePoint(event);
  const box = {
    x: Math.min(dragStart.x, point.x), y: Math.min(dragStart.y, point.y),
    w: Math.abs(point.x - dragStart.x), h: Math.abs(point.y - dragStart.y),
  };
  draft?.remove();
  draft = null;
  dragStart = null;
  const rect = stage.getBoundingClientRect();
  const minW = (MIN_DRAG / rect.width) * payload.width;
  const minH = (MIN_DRAG / rect.height) * payload.height;
  if (box.w >= minW && box.h >= minH) {
    boxes.push({ ...box, source: 'manual', covered: true });
    render();
  }
});

function finish(send: boolean): void {
  if (finished || !payload) return;
  finished = true;
  if (send) {
    window.shieldApi.submit(boxes.filter((b) => b.covered).map(({ x, y, w, h, source }) => ({ x, y, w, h, source })));
  } else {
    window.shieldApi.cancel();
  }
}

el<HTMLButtonElement>('cancel').addEventListener('click', () => finish(false));
sendButton.addEventListener('click', () => finish(true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') finish(false);
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) finish(true);
});
window.addEventListener('resize', fitStage);

window.shieldApi.onPreview((data) => {
  payload = data;
  boxes = data.boxes.map((box) => ({ ...box, covered: true }));
  image.src = data.dataUrl;
  stage.prepend(image);

  if (data.agent) {
    el<HTMLHeadingElement>('title').textContent = `${data.agent.clientName} is asking for this capture`;
    sendButton.textContent = `Send to ${data.agent.clientName}`;
    const reason = el<HTMLParagraphElement>('reason');
    reason.hidden = false;
    reason.textContent = '';
    if (data.agent.reason) {
      reason.append('Reason given: ');
      const quote = document.createElement('q');
      quote.textContent = data.agent.reason;
      reason.append(quote);
    } else {
      reason.textContent = 'The agent gave no reason.';
    }
  } else {
    sendButton.textContent = 'Send for analysis';
  }

  const noticeText = NOTICES[data.notice];
  const notice = el<HTMLParagraphElement>('notice');
  notice.hidden = !noticeText;
  notice.textContent = noticeText ?? '';

  fitStage();
  render();
  sendButton.focus();
});
