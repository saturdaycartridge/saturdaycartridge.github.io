// Small interactions shared by every page. Each one is opt-in through a data attribute, does
// nothing without its markup, and stays still for people who prefer reduced motion.
//
//   [data-reveal]          fades and rises into view (stagger with style="--i: n")
//   [data-count="1234"]    counts up from zero the first time it is seen
//   [data-scramble]        letters shuffle and resolve on hover or focus
//   [data-magnetic]        leans toward the pointer
//   [data-tilt]            tilts toward the pointer with a moving sheen (--mx, --my)
//   [data-cursor="Label"]  the cursor becomes a labelled disc; [data-cursor-dark] flips its colours
//   [data-preview="src"]   a floating image follows the pointer while hovering
//   [data-wordmark]        letters swell in weight and width near the pointer
//   [data-clock]           live weekday and time, colon blinking
//   [data-copy="text"]     copies text and confirms with a toast

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
const lerp = (a, b, t) => a + (b - a) * t;
const pointer = { x: innerWidth / 2, y: innerHeight / 2, seen: false };

addEventListener(
  "pointermove",
  (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.seen = true;
  },
  { passive: true },
);

function once(el, key) {
  if (el.dataset[key]) return false;
  el.dataset[key] = "1";
  return true;
}

// ------------------------------------------------------------------ reveal and counters

function reveal(root) {
  const items = root.querySelectorAll("[data-reveal]");
  if (!items.length) return;
  if (reduced || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-in"));
    return;
  }
  // Whatever is already on screen starts at once, without waiting for the observer's first callback.
  const fold = innerHeight;
  const pending = [...items].filter((el) => {
    if (el.getBoundingClientRect().top < fold) {
      requestAnimationFrame(() => el.classList.add("is-in"));
      return false;
    }
    return true;
  });
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  pending.forEach((el) => io.observe(el));
}

const fmt = (n) => Math.round(n).toLocaleString("en-GB");

export function countTo(el, to, ms = 1100) {
  const from = Number(el.dataset.shown || 0);
  el.dataset.shown = String(to);
  if (reduced) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(lerp(from, to, e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function counters(root) {
  const items = root.querySelectorAll("[data-count]");
  if (!items.length) return;
  const run = (el) => countTo(el, Number(el.dataset.count));
  if (!("IntersectionObserver" in window)) return items.forEach(run);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        run(e.target);
        io.unobserve(e.target);
      }
    },
    { threshold: 0.6 },
  );
  items.forEach((el) => {
    el.textContent = "0";
    io.observe(el);
  });
}

// ------------------------------------------------------------------ scramble

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/+";

export function scramble(el, text = el.dataset.text || el.textContent, ms = 520) {
  if (reduced) {
    el.textContent = text;
    return;
  }
  el.dataset.text = text;
  const t0 = performance.now();
  cancelAnimationFrame(el._scr);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const fixed = Math.floor(k * text.length);
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      out += i < fixed || c === " " ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (k < 1) el._scr = requestAnimationFrame(step);
  };
  el._scr = requestAnimationFrame(step);
}

function scrambles(root) {
  root.querySelectorAll("[data-scramble]").forEach((el) => {
    if (!once(el, "scrInit")) return;
    const target = el.querySelector("[data-scramble-text]") || el;
    target.dataset.text = target.textContent;
    const go = () => scramble(target);
    el.addEventListener("pointerenter", go);
    el.addEventListener("focus", go);
  });
}

// ------------------------------------------------------------------ pointer-driven effects

function magnetic(root) {
  if (reduced || !fine) return;
  root.querySelectorAll("[data-magnetic]").forEach((el) => {
    if (!once(el, "magInit")) return;
    const pull = Number(el.dataset.magnetic) || 0.25;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.translate = `${dx * pull}px ${dy * pull}px`;
    });
    el.addEventListener("pointerleave", () => {
      el.style.transition = "translate 600ms var(--spring)";
      el.style.translate = "0 0";
      setTimeout(() => (el.style.transition = ""), 600);
    });
  });
}

function tilt(root) {
  if (reduced || !fine) return;
  root.querySelectorAll("[data-tilt]").forEach((el) => {
    if (!once(el, "tiltInit")) return;
    const max = Number(el.dataset.tilt) || 4;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      el.style.setProperty("--mx", `${(u * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(v * 100).toFixed(1)}%`);
      el.style.transform = `perspective(900px) rotateX(${((0.5 - v) * max).toFixed(2)}deg) rotateY(${((u - 0.5) * max).toFixed(2)}deg)`;
    });
    el.addEventListener("pointerleave", () => {
      el.style.transform = "";
    });
  });
}

let cursorEl;
function cursor() {
  if (reduced || !fine || cursorEl) return;
  cursorEl = document.createElement("div");
  cursorEl.className = "cursor";
  cursorEl.setAttribute("aria-hidden", "true");
  cursorEl.append(document.createElement("span"));
  document.body.append(cursorEl);
  const label = cursorEl.firstChild;
  let x = pointer.x,
    y = pointer.y;
  const tick = () => {
    x = lerp(x, pointer.x, 0.28);
    y = lerp(y, pointer.y, 0.28);
    cursorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  addEventListener("pointermove", (e) => {
    cursorEl.classList.toggle("is-on", e.pointerType === "mouse");
    const t = e.target instanceof Element ? e.target : null;
    const labelled = t?.closest("[data-cursor]");
    const hover = t?.closest("a, button, [role='button'], input, label, summary, [data-cursor-hover]");
    cursorEl.classList.toggle("is-label", !!labelled);
    cursorEl.classList.toggle("is-hover", !labelled && !!hover);
    cursorEl.classList.toggle("is-dark", !!t?.closest("[data-cursor-dark]"));
    if (labelled) label.textContent = labelled.dataset.cursor;
  });
  document.addEventListener("pointerleave", () => cursorEl.classList.remove("is-on"));
  addEventListener("pointerdown", () => cursorEl.classList.add("is-down"));
  addEventListener("pointerup", () => cursorEl.classList.remove("is-down"));
}

let previewEl;
function previews(root) {
  if (reduced || !fine) return;
  const items = root.querySelectorAll("[data-preview]");
  if (!items.length) return;
  if (!previewEl) {
    previewEl = document.createElement("div");
    previewEl.className = "float-preview";
    previewEl.setAttribute("aria-hidden", "true");
    previewEl.append(new Image());
    document.body.append(previewEl);
    let x = pointer.x,
      y = pointer.y,
      vx = 0;
    const tick = () => {
      const nx = lerp(x, pointer.x, 0.14);
      vx = lerp(vx, nx - x, 0.2);
      x = nx;
      y = lerp(y, pointer.y, 0.14);
      previewEl.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${Math.max(-8, Math.min(8, vx * 0.6)).toFixed(2)}deg)`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const img = previewEl.firstChild;
  items.forEach((el) => {
    if (!once(el, "prevInit")) return;
    const pre = new Image();
    pre.src = el.dataset.preview;
    el.addEventListener("pointerenter", () => {
      img.src = el.dataset.preview;
      previewEl.classList.add("is-on");
    });
    el.addEventListener("pointerleave", () => previewEl.classList.remove("is-on"));
  });
}

function wordmarks(root) {
  root.querySelectorAll("[data-wordmark]").forEach((el) => {
    if (!once(el, "wmInit")) return;
    // Split into letters, keeping words together for wrapping and the text whole for screen readers.
    const text = el.textContent.trim();
    el.setAttribute("aria-label", text);
    el.textContent = "";
    const letters = [];
    text.split(" ").forEach((word, wi) => {
      const w = document.createElement("span");
      w.className = "wm-word";
      w.setAttribute("aria-hidden", "true");
      for (const ch of word) {
        const s = document.createElement("span");
        s.className = "wm-letter";
        s.textContent = ch;
        s.style.setProperty("--d", `${letters.length * 35}ms`);
        w.append(s);
        letters.push(s);
      }
      el.append(w);
      if (wi < text.split(" ").length - 1) el.append(" ");
    });
    el.classList.add("wm-ready");
    if (reduced || !fine) return;
    let active = false;
    // Matches .wm-letter in CSS: medium and wide at rest, heavy and condensed under the pointer.
    const base = { w: 560, s: 112 };
    const state = letters.map(() => ({ w: base.w, s: base.s }));
    const tick = () => {
      const near = pointer.seen && el.matches(":hover") ? 1 : 0;
      let moving = false;
      letters.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const d = Math.hypot(pointer.x - (r.left + r.width / 2), pointer.y - (r.top + r.height / 2));
        const k = near * Math.max(0, 1 - d / (r.height * 1.6));
        const tw = base.w + k * 340;
        const ts = base.s - k * 34;
        state[i].w = lerp(state[i].w, tw, 0.18);
        state[i].s = lerp(state[i].s, ts, 0.18);
        if (Math.abs(state[i].w - tw) > 0.5) moving = true;
        s.style.fontWeight = state[i].w.toFixed(0);
        s.style.fontStretch = `${state[i].s.toFixed(1)}%`;
      });
      if (moving || near) requestAnimationFrame(tick);
      else active = false;
    };
    el.addEventListener("pointermove", () => {
      if (!active) {
        active = true;
        requestAnimationFrame(tick);
      }
    });
  });
}

// ------------------------------------------------------------------ clock, copy, progress

function clocks(root) {
  const items = root.querySelectorAll("[data-clock]");
  if (!items.length) return;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const draw = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    items.forEach((el) => {
      el.innerHTML = `<span class="clock-day">${days[d.getDay()]}</span> ${hh}<span class="clock-colon">:</span>${mm}`;
      el.dataset.saturday = d.getDay() === 6 ? "yes" : "no";
      el.setAttribute("datetime", `${hh}:${mm}`);
    });
  };
  draw();
  setInterval(draw, 15000);
}

let toastEl, toastTimer;
export function toast(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.setAttribute("role", "status");
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 1800);
}

function copies(root) {
  root.querySelectorAll("[data-copy]").forEach((el) => {
    if (!once(el, "copyInit")) return;
    el.addEventListener("click", async (e) => {
      if (!navigator.clipboard) return;
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        toast(`Copied ${el.dataset.copy}`);
        el.classList.add("is-copied");
        setTimeout(() => el.classList.remove("is-copied"), 1600);
      } catch {
        location.href = `mailto:${el.dataset.copy}`;
      }
    });
  });
}

function progress() {
  const bar = document.querySelector(".progress");
  if (!bar) return;
  const draw = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty("--p", max > 0 ? (scrollY / max).toFixed(4) : 0);
  };
  addEventListener("scroll", draw, { passive: true });
  addEventListener("resize", draw);
  draw();
}

export function enhance(root = document) {
  reveal(root);
  counters(root);
  scrambles(root);
  magnetic(root);
  tilt(root);
  previews(root);
  wordmarks(root);
  clocks(root);
  copies(root);
}

enhance();
cursor();
progress();
