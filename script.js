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

// —— GALLERY IMAGE LISTS ———————————————————————————————————————————
function loadGalleryImages(folder) {
  const list = [];
  const maxImages = 20; // increase to 50–100 once confirmed working
  for (let i = 1; i <= maxImages; i++) {
    list.push(`images/${folder}/${i}.png`);
    // If some folders use 01.png etc., uncomment:
    // list.push(`images/${folder}/${String(i).padStart(2, '0')}.png`);
  }
  return list;
}

const galleryImages = {};

function populateGalleryImages() {
  document.querySelectorAll(".gallery-category").forEach(cat => {
    const folder = cat.getAttribute("data-folder");
    if (folder && !galleryImages[folder]) {
      galleryImages[folder] = loadGalleryImages(folder);
      console.log(`Registered gallery folder: ${folder} with ${galleryImages[folder].length} potential images`);
    }
  });
}

// Run population after DOM ready + short delay (carousel needs time to layout)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(populateGalleryImages, 300); // 300ms is usually enough
});

// —— DYNAMIC VIDEO LIST FROM CSV ————————————————————————————————————
let videoList = [];
async function loadVideosFromFolder() {
  try {
    const csvUrl = 'videos/mariewatson3371.csv';
    const response = await fetch(csvUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`CSV fetch failed: ${response.status} ${response.statusText}`);
    let text = await response.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    const rows = text.replace(/\r\n?/g, '\n').trim().split('\n');
    const dataRows = rows.length && /url|video/i.test(rows[0]) ? rows.slice(1) : rows;
    videoList = dataRows
      .map(row => {
        if (!row) return null;
        const parts = row.split(/,(.+)/);
        if (!parts || parts.length < 2) return null;
        const title = parts[0].trim().replace(/^"(.+)"$/, '$1');
        const url = parts[1].trim().replace(/^"(.+)"$/, '$1');
        const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
        const id = m ? m[1] : null;
        return id ? { id, title } : null;
      })
      .filter(Boolean);
    console.log(`[videos] Loaded ${videoList.length} entries from CSV`);
  } catch (err) {
    console.error('Failed to load mariewatson3371.csv:', err);
    videoList = [];
  }
  return videoList.length;
}
loadVideosFromFolder();

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
  lightbox.classList.add('active');
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
    lightboxImg.onerror = function () {
      this.onerror = null;
      tryIndex(i + direction);
    };
    console.log('Stepping to image:', currentList[i]); // debug
    lightboxImg.src = currentList[i];
  }
  tryIndex(index);
}

// —— VIDEO LIGHTBOX ————————————————————————————————————————————————
const videoFeatured = document.getElementById('videoFeatured');
videoFeatured?.addEventListener('click', async () => {
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

// —— TOUCH SWIPE FOR LIGHTBOX ————————————————————————————————————
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

  let touchX = 0;
  carousel.addEventListener("touchstart", e => {
    touchX = e.changedTouches[0].screenX;
  }, { passive: true });
  carousel.addEventListener("touchend", e => {
    const diff = touchX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
  }, { passive: true });

  buildDots();
  updateArrows();

})();
