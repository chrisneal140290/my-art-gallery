// —— HAMBURGER MENU ————————————————————————————————————————————————
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');
const navLinks = document.querySelectorAll('.nav-link');
if (hamburger && navMenu) {
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
  });
}
navLinks.forEach(link => {
  link.addEventListener('click', () => {
    hamburger?.classList.remove('active');
    navMenu?.classList.remove('active');
  });
});

// —— GALLERY IMAGE LISTS (manifest-driven) ————————————————————————
// Each image folder contains a manifest.json listing exactly which files exist.
// This avoids blind 1-20 probing and eliminates failed fetches for missing images.
// Format: { "images": ["1.png", "2.png", "3.png", ...] }
// Generate with the included generate-manifests.js (run once after uploading images).

const galleryImages = {};

async function loadManifest(folder) {
  try {
    const res = await fetch(`images/${folder}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const files = Array.isArray(data.images) ? data.images : [];
    galleryImages[folder] = files.map(f => `images/${folder}/${f}`);
    console.log(`[gallery] ${folder}: ${galleryImages[folder].length} images from manifest`);
  } catch (err) {
    // Manifest missing — fall back to probing 1–40 so the gallery still works
    // while you haven't yet generated manifests. Remove fallback once manifests exist.
    console.warn(`[gallery] No manifest for "${folder}", using probe fallback:`, err.message);
    galleryImages[folder] = [];
    for (let i = 1; i <= 40; i++) galleryImages[folder].push(`images/${folder}/${i}.png`);
  }
}

async function populateGalleryImages() {
  const folders = [...new Set(
    [...document.querySelectorAll('.gallery-category')]
      .map(c => c.getAttribute('data-folder'))
      .filter(Boolean)
  )];
  await Promise.all(folders.map(loadManifest));
}

document.addEventListener('DOMContentLoaded', populateGalleryImages);

// —— DYNAMIC VIDEO LIST FROM CSV ————————————————————————————————————
// CSV columns expected: "Name (Title)", "Video URL"
// File: videos/mariewatson3371.csv  (update this file to add/remove videos)

let videoList = [];

// Parses a single CSV line that may contain quoted fields with commas inside
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function loadVideosFromFolder() {
  try {
    const csvUrl = 'videos/mariewatson3371.csv';
    const response = await fetch(csvUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let text = await response.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
    const rows = text.replace(/\r\n?/g, '\n').trim().split('\n').filter(r => r.trim());
    if (!rows.length) throw new Error('Empty CSV');

    // Find which column is which from the header row
    const headers = parseCSVLine(rows[0]).map(h => h.toLowerCase());
    const titleCol = headers.findIndex(h => h.includes('name') || h.includes('title'));
    const urlCol   = headers.findIndex(h => h.includes('url') || h.includes('video'));
    if (titleCol === -1 || urlCol === -1) throw new Error('CSV columns not found');

    videoList = rows.slice(1).map(row => {
      const fields = parseCSVLine(row);
      const title = fields[titleCol] || '';
      const url   = fields[urlCol]   || '';
      const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
      const id = m ? m[1] : null;
      return (title && id) ? { id, title } : null;
    }).filter(Boolean);

    console.log(`[videos] Loaded ${videoList.length} from CSV`);
  } catch (err) {
    console.warn('[videos] Could not load CSV (normal when viewing locally):', err.message);
    videoList = [];
  }
  return videoList.length;
}

// —— LIGHTBOX ELEMENTS ——————————————————————————————————————————————
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImage');
const lightboxVideo = document.getElementById('lightboxVideo');
const lightboxIframe = document.getElementById('lightboxIframe');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');
let lbMode = 'image';
let currentList = [];
let currentIndex = 0;

// —— NAMED HANDLER FOR GALLERY CLICK (reusable for both delegation and direct) ——
function handleGalleryClick(category) {
  const folder = category.getAttribute('data-folder');
  console.log(`Gallery clicked: ${folder} | Preloaded images: ${galleryImages[folder]?.length || 0}`);

  lbMode = 'image';
  currentList = galleryImages[folder] || [];
  currentIndex = 0;

  if (lightboxImg) lightboxImg.style.display = 'block';
  lightboxVideo?.classList.remove('active');
  if (lightboxIframe) lightboxIframe.src = '';
  if (lightboxPrev) lightboxPrev.style.display = 'block';
  if (lightboxNext) lightboxNext.style.display = 'block';
  openImageAt(0);
}

// —— IMAGE LIGHTBOX – PRIMARY: EVENT DELEGATION ———————————————
document.addEventListener('click', function(e) {
  const category = e.target.closest('.gallery-category');
  if (category) {
    handleGalleryClick(category);
  }
});

function openImageAt(index) {
  if (!lightbox || !lightboxImg || currentList.length === 0) {
    console.warn('Lightbox or currentList empty – cannot open image');
    return;
  }
  console.log('Loading image:', currentList[index]); // debug URL
  lightboxImg.src = currentList[index];
  lightboxImg.onerror = function () {
    this.onerror = null;
    stepImage(index + 1, +1);
  };
  lightbox.classList.remove('visible');
  lightbox.classList.add('active');
  // Small delay lets browser paint display:flex before opacity transition fires
  setTimeout(() => lightbox.classList.add('visible'), 20);
  document.body.style.overflow = 'hidden';
}

function stepImage(index, direction) {
  let attempts = 0;
  const total = currentList.length;
  function tryIndex(i) {
    if (attempts >= total) {
      console.warn('No valid image found after cycling through list');
      return;
    }
    attempts++;
    i = ((i % total) + total) % total;
    currentIndex = i;
    // Cross-fade: fade out, swap, fade in
    lightboxImg.style.opacity = '0';
    setTimeout(() => {
      lightboxImg.onerror = function () {
        this.onerror = null;
        lightboxImg.style.opacity = '1';
        tryIndex(i + direction);
      };
      lightboxImg.src = currentList[i];
      lightboxImg.onload = () => { lightboxImg.style.opacity = '1'; };
    }, 280);
  }
  tryIndex(index);
}

// —— VIDEO LIST UI ————————————————————————————————————————————————
async function buildVideoList() {
  if (!videoList.length) {
    await loadVideosFromFolder();
  }
  const container = document.getElementById('videoList');
  if (!container) return;
  if (!videoList.length) {
    container.innerHTML = '<p class="video-list-loading">Videos available on the live site.</p>';
    return;
  }
  container.innerHTML = '';
  videoList.forEach((video, i) => {
    const item = document.createElement('div');
    item.className = 'video-list-item';
    item.innerHTML = `
      <div class="video-list-play">&#9654;</div>
      <span class="video-list-title">${video.title}</span>
      <span class="video-list-num">${String(i + 1).padStart(2, '0')}</span>
    `;
    item.addEventListener('click', () => openVideoAt(i));
    container.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', buildVideoList);

function openVideoAt(index) {
  lbMode = 'video';
  currentIndex = index;
  if (lightboxImg) {
    lightboxImg.style.display = 'none';
    lightboxImg.src = '';
  }
  lightboxVideo?.classList.add('active');
  if (lightboxIframe) {
    lightboxIframe.src = `https://www.youtube.com/embed/${videoList[index].id}?autoplay=1&mute=1&playsinline=1`;
  }
  if (lightboxPrev) lightboxPrev.style.display = 'block';
  if (lightboxNext) lightboxNext.style.display = 'block';
  lightbox?.classList.remove('visible');
  lightbox?.classList.add('active');
  setTimeout(() => lightbox?.classList.add('visible'), 20);
  document.body.style.overflow = 'hidden';
}

function stepVideo(direction) {
  const total = videoList.length;
  if (!total) return;
  const next = ((currentIndex + direction) % total + total) % total;
  if (lightboxIframe) lightboxIframe.src = '';
  setTimeout(() => openVideoAt(next), 50);
}

// —— CLOSE ————————————————————————————————————————————————————————
function closeLightbox() {
  if (!lightbox?.classList.contains('active')) return;
  lightbox.classList.remove('visible');
  setTimeout(() => {
    lightbox?.classList.remove('active');
    if (lightboxIframe) lightboxIframe.src = '';
    if (lightboxImg) lightboxImg.src = '';
    lightboxVideo?.classList.remove('active');
    if (lightboxImg) lightboxImg.style.display = 'block';
    if (lightboxPrev) lightboxPrev.style.display = 'block';
    if (lightboxNext) lightboxNext.style.display = 'block';
    document.body.style.overflow = 'auto';
  }, 320);
}
lightboxClose?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

// —— NAVIGATION ————————————————————————————————————————————————
lightboxPrev?.addEventListener('click', () => {
  if (lbMode === 'image') stepImage(currentIndex - 1, -1);
  else stepVideo(-1);
});
lightboxNext?.addEventListener('click', () => {
  if (lbMode === 'image') stepImage(currentIndex + 1, +1);
  else stepVideo(+1);
});
document.addEventListener('keydown', (e) => {
  if (!lightbox?.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lbMode === 'image' ? stepImage(currentIndex - 1, -1) : stepVideo(-1);
  if (e.key === 'ArrowRight') lbMode === 'image' ? stepImage(currentIndex + 1, +1) : stepVideo(+1);
});

// —— TOUCH SWIPE FOR LIGHTBOX (velocity + distance gated) ————————
let lbTouchStartX = 0;
let lbTouchStartY = 0;
let lbTouchStartTime = 0;
let lbSwipeLocked = false;

lightbox?.addEventListener('touchstart', (e) => {
  if (!lightbox.classList.contains('active')) return;
  lbTouchStartX    = e.changedTouches[0].clientX;
  lbTouchStartY    = e.changedTouches[0].clientY;
  lbTouchStartTime = Date.now();
}, { passive: true });

lightbox?.addEventListener('touchend', (e) => {
  if (!lightbox.classList.contains('active') || lbSwipeLocked) return;
  const dx       = e.changedTouches[0].clientX - lbTouchStartX;
  const dy       = e.changedTouches[0].clientY - lbTouchStartY;
  const elapsed  = Date.now() - lbTouchStartTime;
  const velocity = Math.abs(dx) / elapsed; // px/ms

  // Reject: vertical scroll, too slow, too short
  if (Math.abs(dy) > Math.abs(dx) * 0.8) return;   // mostly vertical
  if (Math.abs(dx) < 60 && velocity < 0.4) return;  // too short AND too slow

  lbSwipeLocked = true;
  setTimeout(() => { lbSwipeLocked = false; }, 400);

  if (dx < 0) { if (lbMode === 'image') stepImage(currentIndex + 1, +1); else stepVideo(+1); }
  else        { if (lbMode === 'image') stepImage(currentIndex - 1, -1); else stepVideo(-1); }
}, { passive: true });

// —— TRACKPAD TWO-FINGER HORIZONTAL SWIPE (wheel event) ———————————
lightbox?.addEventListener('wheel', (e) => {
  if (!lightbox.classList.contains('active')) return;
  const absDeltaX = Math.abs(e.deltaX);
  const absDeltaY = Math.abs(e.deltaY);
  if (absDeltaX > absDeltaY * 1.5 && absDeltaX > 15) {
    e.preventDefault();
    if (lightbox.dataset.swipeLocked === 'true') return;
    lightbox.dataset.swipeLocked = 'true';
    setTimeout(() => { lightbox.dataset.swipeLocked = 'false'; }, 300);
    if (e.deltaX > 0) { if (lbMode === 'image') stepImage(currentIndex + 1, +1); else stepVideo(+1); }
    else if (e.deltaX < 0) { if (lbMode === 'image') stepImage(currentIndex - 1, -1); else stepVideo(-1); }
  }
}, { passive: false });

// —— SHOP CAROUSEL ————————————————————————————————————————————————
(function () {
  const carousel = document.getElementById('shopCarousel');
  const prevBtn = document.getElementById('shopPrev');
  const nextBtn = document.getElementById('shopNext');
  const dotsWrap = document.getElementById('shopDots');
  if (!carousel || !prevBtn || !nextBtn || !dotsWrap) return;
  let current = 0;
  const slides = () => Array.from(carousel.querySelectorAll('.shop-slide'));
  function buildDots() {
    dotsWrap.innerHTML = '';
    slides().forEach((_, i) => {
      const d = document.createElement('button');
      d.className = 'shop-dot' + (i === 0 ? ' active' : '');
      d.setAttribute('aria-label', 'Product ' + (i + 1));
      d.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(d);
    });
  }
  function updateDots() {
    dotsWrap.querySelectorAll('.shop-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });
  }
  function updateArrows() {
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === slides().length - 1;
  }
  function goTo(index) {
    current = Math.max(0, Math.min(index, slides().length - 1));
    carousel.style.transform = 'translateX(-' + (current * 100) + '%)';
    carousel.style.transition = 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)';
    updateDots();
    updateArrows();
  }
  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));
  let scTouchStartX = 0, scTouchStartY = 0, scTouchTime = 0, scSwipeLocked = false;
  carousel.addEventListener('touchstart', e => {
    scTouchStartX = e.changedTouches[0].clientX;
    scTouchStartY = e.changedTouches[0].clientY;
    scTouchTime   = Date.now();
  }, { passive: true });
  carousel.addEventListener('touchend', e => {
    if (scSwipeLocked) return;
    const dx       = e.changedTouches[0].clientX - scTouchStartX;
    const dy       = e.changedTouches[0].clientY - scTouchStartY;
    const elapsed  = Date.now() - scTouchTime;
    const velocity = Math.abs(dx) / elapsed;
    if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
    if (Math.abs(dx) < 55 && velocity < 0.45) return;
    scSwipeLocked = true;
    setTimeout(() => { scSwipeLocked = false; }, 450);
    goTo(current + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // Trackpad two-finger horizontal scroll
  let scWheelLocked = false;
  carousel.addEventListener('wheel', (e) => {
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);
    if (absX > absY * 1.2 && absX > 10) {
      e.preventDefault();
      if (scWheelLocked) return;
      scWheelLocked = true;
      setTimeout(() => { scWheelLocked = false; }, 500);
      if (e.deltaX > 0) goTo(current + 1);
      else              goTo(current - 1);
    }
  }, { passive: false });

  buildDots();
  updateArrows();
})();

// —— SMOOTH SCROLL ————————————————————————————————————————————————
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) window.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
  });
});

// —— SHRINKING HEADER ON SCROLL ————————————————————————————————
const header = document.querySelector('.header');
window.addEventListener('scroll', () => {
  if (!header) return;
  if (window.scrollY > 60) header.classList.add('scrolled');
  else header.classList.remove('scrolled');
}, { passive: true });

// —— GALLERY CAROUSEL ———————————————————————————————————————————
(function () {
  const carousel = document.getElementById('galleryCarousel');
  const track = document.getElementById('galleryTrack');
  const prevBtn = document.querySelector('.gallery-arrow--prev');
  const nextBtn = document.querySelector('.gallery-arrow--next');
  const dotsWrap = document.getElementById('galleryDots');
  if (!carousel || !track || !prevBtn || !nextBtn || !dotsWrap) return;

  let current = 0;
  const slides = () => Array.from(track.querySelectorAll('.gallery-slide'));

  // How many slides fit in the viewport at once
  function perPage() {
    return window.innerWidth >= 640 ? 2 : 1;
  }

  // Total number of "stops" (last stop shows final perPage slides)
  function pageCount() {
    return Math.max(1, slides().length - perPage() + 1);
  }

  function buildDots() {
    dotsWrap.innerHTML = "";
    const pages = pageCount();
    for (let i = 0; i < pages; i++) {
      const d = document.createElement("button");
      d.className = "gallery-dot" + (i === 0 ? " active" : "");
      d.addEventListener("click", () => goTo(i));
      dotsWrap.appendChild(d);
    }
  }
  function updateDots() {
    dotsWrap.querySelectorAll(".gallery-dot").forEach((d, i) => {
      d.classList.toggle("active", i === current);
    });
  }
  function updateArrows() {
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current >= pageCount() - 1;
  }
  function goTo(index) {
    current = Math.max(0, Math.min(index, pageCount() - 1));
    // Each slide is (100/perPage)% of the track viewport, shift by that amount per step
    const slideWidthPct = 100 / perPage();
    track.style.transform = `translateX(-${current * slideWidthPct}%)`;
    track.style.transition = "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)";
    updateDots();
    updateArrows();
  }
  prevBtn.addEventListener("click", () => goTo(current - 1));
  nextBtn.addEventListener("click", () => goTo(current + 1));

  // Rebuild on resize so dots/arrows reflect new perPage
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      current = Math.min(current, pageCount() - 1);
      buildDots();
      goTo(current);
    }, 150);
  });

  let gcTouchStartX = 0, gcTouchStartY = 0, gcTouchTime = 0, gcSwipeLocked = false;
  carousel.addEventListener("touchstart", e => {
    gcTouchStartX = e.changedTouches[0].clientX;
    gcTouchStartY = e.changedTouches[0].clientY;
    gcTouchTime   = Date.now();
  }, { passive: true });
  carousel.addEventListener("touchend", e => {
    if (gcSwipeLocked) return;
    const dx       = e.changedTouches[0].clientX - gcTouchStartX;
    const dy       = e.changedTouches[0].clientY - gcTouchStartY;
    const elapsed  = Date.now() - gcTouchTime;
    const velocity = Math.abs(dx) / elapsed;
    // Must be predominantly horizontal AND (long enough OR fast enough)
    if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
    if (Math.abs(dx) < 55 && velocity < 0.45) return;
    gcSwipeLocked = true;
    setTimeout(() => { gcSwipeLocked = false; }, 450);
    if (dx < 0) goTo(current + 1);
    else        goTo(current - 1);
  }, { passive: true });

  // Trackpad two-finger horizontal scroll
  let gcWheelLocked = false;
  carousel.addEventListener('wheel', (e) => {
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);
    if (absX > absY * 1.2 && absX > 10) {
      e.preventDefault();
      if (gcWheelLocked) return;
      gcWheelLocked = true;
      setTimeout(() => { gcWheelLocked = false; }, 500);
      if (e.deltaX > 0) goTo(current + 1);
      else              goTo(current - 1);
    }
  }, { passive: false });

  buildDots();
  updateArrows();

})();
