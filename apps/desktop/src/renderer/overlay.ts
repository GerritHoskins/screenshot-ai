const bg = document.getElementById("bg") as HTMLDivElement;
const selection = document.getElementById("selection") as HTMLDivElement;

// Use secure API from preload bridge
if (!window.overlay) {
  throw new Error('Overlay API not available - preload script may not have loaded');
}
const { overlay } = window;

let startX = 0;
let startY = 0;
let dragging = false;
let imageWidth = 0;
let imageHeight = 0;

overlay.onImage((dataUrl: string) => {
  bg.style.backgroundImage = `url(${dataUrl})`;
  const img = new Image();
  img.onload = () => {
    imageWidth = img.naturalWidth;
    imageHeight = img.naturalHeight;
  };
  img.src = dataUrl;
});

window.addEventListener("mousedown", (e) => {
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  selection.style.display = "block";
  selection.style.left = `${startX}px`;
  selection.style.top = `${startY}px`;
  selection.style.width = "0px";
  selection.style.height = "0px";
});

window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${w}px`;
  selection.style.height = `${h}px`;
});

window.addEventListener("mouseup", (e) => {
  if (!dragging) return;
  dragging = false;
  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);
  const scaleX = imageWidth > 0 ? imageWidth / window.innerWidth : 1;
  const scaleY = imageHeight > 0 ? imageHeight / window.innerHeight : 1;
  overlay.submitSelection({
    x: Math.round(x * scaleX),
    y: Math.round(y * scaleY),
    w: Math.round(w * scaleX),
    h: Math.round(h * scaleY),
  });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    overlay.cancel();
  }
});
