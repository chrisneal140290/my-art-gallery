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

// —— GALLERY IMAGE LISTS ———————————————————————————————————————————————
function buildImageList(prefix, max) {
  const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  const list = [];
  list.push(`images/${prefix}.png`);
  for (let i = 1; i <= max; i++) list.push(`images/${prefix}${i}.png`);
  list.push(`images/${cap}.png`);
  for (let i = 1; i <= max; i++) list.push(`images/${cap}${i}.png`);
  return list;
}
const galleryImages = {
  food: buildImageList('food', 20),
  animals: buildImageList('nature', 20),
  olympics: buildImageList('winter', 20)
};

// —— DYNAMIC VIDEO LIST FROM CSV ——————————————————————————————————————————
let videoList = [];
async function loadVideosFromFolder() {
  try {
    const csvUrl = 'videos/mariewatson3371.csv';
    const response = await fetch(csvUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`CSV fetch failed: ${response.status} ${response.statusText}`);

    let text = await response.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);            // strip BOM
    const rows = text.replace(/\r\n?/g, '\n').trim().split('\n');

    // Skip header if first row looks like it
    const dataRows = rows.length && /url|video/i.test(rows[0]) ? rows.slice(1) : rows;

    videoList = dataRows.map(row => {
      if (!row) return null;
      const parts = row.split(/,(.+)/);                                  // split into title, url
      if (!parts || parts.length < 2) return null;

      const title = parts[0].trim().replace(/^"(.*)"$/, '$1');
      const url   = parts[1].trim().replace(/^"(.*)"$/, '$1');

      // watch?v=, youtu.be/, or embed/
      const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
      const id = m ? m[1] : null;
      return id ? { id, title } : null;
    }).filter(Boolean);

    console.log(`[videos] Loaded ${videoList.length} entries from CSV`);
  } catch (err) {
    console.error('Failed to load mariewatson3371.csv:', err);
    videoList = [];
  }
  return videoList.length;
}
// Load videos ASAP
loadVideosFromFolder();

// —— LIGHTBOX ELEMENTS ————————————————————————————————————————————————
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

// —— IMAGE LIGHTBOX ————————————————————————————————————————————————
document.querySelectorAll('.gallery-card').forEach(card => {
  card.addEventListener('click', () => {
    lbMode = 'image';
    currentList = galleryImages[card.getAttribute('data-category')] || [];
    currentIndex = 0;

    if (lightboxImg) lightboxImg.style.display = 'block';
    lightboxVideo?.classList.remove('active');
    if (lightboxIframe) lightboxIframe.src = '';
    if (lightboxPrev) lightboxPrev.style.display = 'block';
    if (lightboxNext) lightboxNext.style.display = 'block';

    openImageAt(0);
  });
});

function openImageAt(index) {
  if (!lightbox || !lightboxImg || currentList.length === 0) return;
  lightboxImg.src = currentList[index];
  lightboxImg.onerror = function () {
    this.onerror = null;
    stepImage(index + 1, +1);
  };
  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function stepImage(index, direction) {
  let attempts = 0;
  const total = currentList.length;
  function tryIndex(i) {
    if (attempts >= total) return;
    attempts++;
    i = ((i % total) + total) % total;
    currentIndex = i;
    lightboxImg.onerror = function () {
      this.onerror = null;
      tryIndex(i + direction);
    };
    lightboxImg.src = currentList[i];
  }
  tryIndex(index);
}

// —— VIDEO LIGHTBOX ————————————————————————————————————————————————
const videoFeatured = document.getElementById('videoFeatured');
videoFeatured?.addEventListener('click', async () => {
  // If clicked before CSV load finishes, try once and continue
  if (!videoList.length) {
    const count = await loadVideosFromFolder();
    if (!count) {
      console.warn('No videos available — check videos/mariewatson3371.csv');
      return;
    }
  }
  openVideoAt(0);
});

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

  lightbox?.classList.add('active');
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
  lightbox?.classList.remove('active');
  if (lightboxIframe) lightboxIframe.src = '';
  if (lightboxImg) lightboxImg.src = '';
  lightboxVideo?.classList.remove('active');
  if (lightboxImg) lightboxImg.style.display = 'block';
  if (lightboxPrev) lightboxPrev.style.display = 'block';
  if (lightboxNext) lightboxNext.style.display = 'block';
  document.body.style.overflow = 'auto';
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

// —— TOUCH SWIPE FOR LIGHTBOX ——————————————————————————————————————
let touchStartX = 0;
let touchEndX = 0;
const swipeThreshold = 60;
lightbox?.addEventListener('touchstart', (e) => {
  if (!lightbox.classList.contains('active')) return;
  touchStartX = e.changedTouches[0].screenX;
}, { passive: true });
lightbox?.addEventListener('touchend', (e) => {
  if (!lightbox.classList.contains('active')) return;
  touchEndX = e.changedTouches[0].screenX;
  const diff = touchStartX - touchEndX;
  if (diff > swipeThreshold) { if (lbMode === 'image') stepImage(currentIndex + 1, +1); else stepVideo(+1); }
  else if (diff < -swipeThreshold) { if (lbMode === 'image') stepImage(currentIndex - 1, -1); else stepVideo(-1); }
  touchStartX = 0; touchEndX = 0;
}, { passive: true });

// —— TRACKPAD TWO-FINGER HORIZONTAL SWIPE (wheel event) ——————————————
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

  // Touch swipe for carousel
  let tx = 0;
  carousel.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; }, { passive: true });
  carousel.addEventListener('touchend', e => {
    const diff = tx - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
  }, { passive: true });

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

// —— SHRINKING HEADER ON SCROLL ———————————————————————————————————————
const header = document.querySelector('.header');
window.addEventListener('scroll', () => {
  if (!header) return;
  if (window.scrollY > 60) header.classList.add('scrolled');
  else header.classList.remove('scrolled');
}, { passive: true });