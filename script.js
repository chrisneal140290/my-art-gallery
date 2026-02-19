// ── HAMBURGER MENU ────────────────────────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
const navLinks  = document.querySelectorAll('.nav-link');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
});

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    });
});

// ── GALLERY IMAGE LISTS ───────────────────────────────────────────────────────
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
    food:     buildImageList('food',   20),
    animals:  buildImageList('nature', 20),
    olympics: buildImageList('winter', 20)
};

// ── DYNAMIC VIDEO LIST FROM ANY SINGLE .csv IN /videos/ ───────────────────────
let videoList = [];  // filled from CSV

async function loadVideosFromFolder() {
    try {
        // Try to list files — GitHub Pages serves directory index if enabled,
        // but more reliably we can try common timestamp patterns or fetch known name.
        // For simplicity: assume only one .csv exists in /videos/
        // We'll try fetching a few likely names, or use a fixed one if you prefer.

        // Option A: fixed name (simplest if upload script always uses same name)
        // let csvUrl = 'videos/mariewatson3371.csv';

        // Option B: dynamic — try to guess / fetch the only .csv (requires server listing or known pattern)
        // Since GitHub Pages doesn't give directory listing easily, best is:
        // 1. Your upload script should create/overwrite a fixed name like videos.csv
        // 2. Or use a known pattern like latest timestamp

        // Recommended: fixed name + upload script overwrites 'videos.csv'
        const csvUrl = 'videos/mariewatson3371.csv';  // ← change if your script uses different fixed name

        const response = await fetch(csvUrl);
        if (!response.ok) {
            throw new Error(`CSV fetch failed: ${response.status}`);
        }

        const text = await response.text();
        const rows = text.trim().split('\n').slice(1); // skip header row

        videoList = rows.map(row => {
            const [id, title] = row.split(',').map(str => str.trim().replace(/^"|"$/g, ''));
            return { id, title };
        }).filter(v => v.id && v.title); // skip bad rows

        console.log(`Loaded ${videoList.length} videos from ${csvUrl}`);
    } catch (err) {
        console.error('Failed to load video CSV:', err);
        videoList = []; // fallback — no videos
    }
}

// Load once when page starts
loadVideosFromCSV();

// ── LIGHTBOX ELEMENTS ─────────────────────────────────────────────────────────
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightboxImage');
const lightboxVideo  = document.getElementById('lightboxVideo');
const lightboxIframe = document.getElementById('lightboxIframe');
const lightboxClose  = document.getElementById('lightboxClose');
const lightboxPrev   = document.getElementById('lightboxPrev');
const lightboxNext   = document.getElementById('lightboxNext');

let lbMode       = 'image';
let currentList  = [];
let currentIndex = 0;

// ── IMAGE LIGHTBOX ────────────────────────────────────────────────────────────
document.querySelectorAll('.gallery-card').forEach(card => {
    card.addEventListener('click', () => {
        lbMode       = 'image';
        currentList  = galleryImages[card.getAttribute('data-category')] || [];
        currentIndex = 0;

        lightboxImg.style.display = 'block';
        lightboxVideo.classList.remove('active');
        lightboxIframe.src = '';
        lightboxPrev.style.display = 'block';
        lightboxNext.style.display = 'block';

        openImageAt(0);
    });
});

function openImageAt(index) {
    if (currentList.length === 0) return;
    lightboxImg.src = currentList[index];
    lightboxImg.onerror = function () {
        this.onerror = null;
        stepImage(index + 1, +1);
    };
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function stepImage(index, direction) {
    let steps = 0;
    const total = currentList.length;
    function tryIndex(i) {
        if (steps >= total) return;
        steps++;
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

// ── VIDEO LIGHTBOX ────────────────────────────────────────────────────────────
document.getElementById('videoFeatured').addEventListener('click', () => {
    if (videoList.length === 0) {
        console.warn('No videos available — CSV not loaded or empty');
        return;
    }
    openVideoAt(0);
});

function openVideoAt(index) {
    lbMode       = 'video';
    currentIndex = index;

    lightboxImg.style.display = 'none';
    lightboxImg.src = '';
    lightboxVideo.classList.add('active');
    lightboxIframe.src = `https://www.youtube.com/embed/${videoList[index].id}?autoplay=1&mute=1&playsinline=1`;
    lightboxPrev.style.display = 'block';
    lightboxNext.style.display = 'block';

    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function stepVideo(direction) {
    const total = videoList.length;
    if (total === 0) return;
    const next  = ((currentIndex + direction) % total + total) % total;
    lightboxIframe.src = '';
    setTimeout(() => openVideoAt(next), 50);
}

// ── CLOSE ─────────────────────────────────────────────────────────────────────
function closeLightbox() {
    lightbox.classList.remove('active');
    lightboxIframe.src = '';
    lightboxImg.src    = '';
    lightboxVideo.classList.remove('active');
    lightboxImg.style.display  = 'block';
    lightboxPrev.style.display = 'block';
    lightboxNext.style.display = 'block';
    document.body.style.overflow = 'auto';
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

// ── NAVIGATION ────────────────────────────────────────────────────────────────
lightboxPrev.addEventListener('click', () => {
    if (lbMode === 'image') stepImage(currentIndex - 1, -1);
    else stepVideo(-1);
});

lightboxNext.addEventListener('click', () => {
    if (lbMode === 'image') stepImage(currentIndex + 1, +1);
    else stepVideo(+1);
});

document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  lbMode === 'image' ? stepImage(currentIndex - 1, -1) : stepVideo(-1);
    if (e.key === 'ArrowRight') lbMode === 'image' ? stepImage(currentIndex + 1, +1) : stepVideo(+1);
});

// ── TOUCH SWIPE FOR LIGHTBOX (images & videos) ────────────────────────────────
let touchStartX = 0;
let touchEndX = 0;
const swipeThreshold = 60;

lightbox.addEventListener('touchstart', (e) => {
    if (!lightbox.classList.contains('active')) return;
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

lightbox.addEventListener('touchend', (e) => {
    if (!lightbox.classList.contains('active')) return;
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;

    if (diff > swipeThreshold) {
        if (lbMode === 'image') stepImage(currentIndex + 1, +1);
        else stepVideo(+1);
    } else if (diff < -swipeThreshold) {
        if (lbMode === 'image') stepImage(currentIndex - 1, -1);
        else stepVideo(-1);
    }

    touchStartX = 0;
    touchEndX = 0;
}, { passive: true });

// ── TRACKPAD TWO-FINGER HORIZONTAL SWIPE (wheel event) ────────────────────────
lightbox.addEventListener('wheel', (e) => {
    if (!lightbox.classList.contains('active')) return;

    const absDeltaX = Math.abs(e.deltaX);
    const absDeltaY = Math.abs(e.deltaY);

    if (absDeltaX > absDeltaY * 1.5 && absDeltaX > 15) {
        e.preventDefault();

        if (lightbox.dataset.swipeLocked === 'true') return;
        lightbox.dataset.swipeLocked = 'true';
        setTimeout(() => { lightbox.dataset.swipeLocked = 'false'; }, 300);

        if (e.deltaX > 0) {
            if (lbMode === 'image') stepImage(currentIndex + 1, +1);
            else stepVideo(+1);
        } else if (e.deltaX < 0) {
            if (lbMode === 'image') stepImage(currentIndex - 1, -1);
            else stepVideo(-1);
        }
    }
}, { passive: false });

// ── SMOOTH SCROLL ─────────────────────────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) window.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
    });
});

// ── SHRINKING HEADER ON SCROLL ────────────────────────────────────────────────
const header = document.querySelector('.header');

window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }
}, { passive: true });
