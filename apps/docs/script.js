const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add("visible"));
}

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxClose = document.getElementById("lightbox-close");
let lastTrigger = null;

function openLightbox(img, trigger) {
  lightboxImg.src = img.currentSrc || img.src;
  lightboxImg.alt = img.alt || "Screenshot";
  lastTrigger = trigger || img;
  if (typeof lightbox.showModal === "function") {
    lightbox.showModal();
  } else {
    lightbox.setAttribute("open", "");
  }
  lightboxClose.focus();
}

function closeLightbox() {
  if (typeof lightbox.close === "function" && lightbox.open) {
    lightbox.close();
  } else {
    lightbox.removeAttribute("open");
  }
  if (lastTrigger && typeof lastTrigger.focus === "function") {
    lastTrigger.focus();
  }
}

document.querySelectorAll(".shot-frame img").forEach((img) => {
  const frame = img.closest(".shot-frame");
  if (!frame || frame.querySelector(":scope > .shot-zoom")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "shot-zoom";
  btn.setAttribute("aria-label", `View fullscreen: ${img.alt || "screenshot"}`);
  img.replaceWith(btn);
  btn.appendChild(img);

  btn.addEventListener("click", () => openLightbox(img, btn));
});

if (lightbox && lightboxClose) {
  lightboxClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox || e.target.classList.contains("lightbox-inner")) {
      closeLightbox();
    }
  });

  lightbox.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeLightbox();
  });
}
