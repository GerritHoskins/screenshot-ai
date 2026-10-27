export {};
const grid = document.getElementById("grid") as HTMLDivElement;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement;
const api = window.chooserApi;

api.onList((payload) => {
  const { displays, thumbnails } = payload;
  grid.innerHTML = "";
  displays.forEach((d, idx) => {
    const card = document.createElement("div");
    card.className = "card";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.backgroundImage = `url(${thumbnails[idx] ?? ""})`;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${idx + 1}: ${d.name}`;

    const btn = document.createElement("button");
    btn.textContent = "Select";
    btn.addEventListener("click", () => api.choose(idx));

    card.appendChild(thumb);
    card.appendChild(label);
    card.appendChild(btn);
    grid.appendChild(card);
  });
});

cancelBtn.addEventListener("click", () => api.cancel());

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") api.cancel();
});
