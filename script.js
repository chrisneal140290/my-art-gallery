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
// Builds both lowercase and capitalised variants so case-sensitive live servers
// can find the files regardless of how they were named on upload.
function buildImageList(prefix, max) {
    const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    const list = [];
    // Try lowercase first (food.png, food1.png...), then capitalised (Food.png...)
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

// ── VIDEO LIST ────────────────────────────────────────────────────────────────
const videoList = [
    { id: 'zFdKEW2b8vk', title: 'Taking home gold #winterolympics #goldmedal' },
    { id: 'piCTmgbDqZQ', title: 'Going for gold #WinterOlympics' },
    { id: '8Iq0ZOXVP40', title: '15 February 2026' },
    { id: 'dRvuFUENXHo', title: 'Winter Olympics 2026' },
    { id: '3HUENV19Yfc', title: 'Spring has sprung' },
    { id: 'gYA9AehiZE8', title: 'Turkey time' },
    { id: 'm5onGETteRI', title: 'Eye time lapse' }
];

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
    openVideoAt(0);
});

function openVideoAt(index) {
    lbMode       = 'video';
    currentIndex = index;

    lightboxImg.style.display = 'none';
    lightboxImg.src = '';
    lightboxVideo.classList.add('active');
    // Updated for better autoplay support on mobile (mute required for reliability)
    lightboxIframe.src = `https://www.youtube.com/embed/${videoList[index].id}?autoplay=1&mute=1&playsinline=1`;
    lightboxPrev.style.display = 'block';
    lightboxNext.style.display = 'block';

    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function stepVideo(direction) {
    const total = videoList.length;
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
const swipeThreshold = 60; // pixels — adjust if too sensitive or not sensitive enough

lightbox.addEventListener('touchstart', (e) => {
    if (!lightbox.classList.contains('active')) return;
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

lightbox.addEventListener('touchend', (e) => {
    if (!lightbox.classList.contains('active')) return;
    touchEndX = e.changedTouches[0].screenX;

    const diff = touchStartX - touchEndX;

    // Swipe left → next
    if (diff > swipeThreshold) {
        if (lbMode === 'image') {
            stepImage(currentIndex + 1, +1);
        } else {
            stepVideo(+1);
        }
    }
    // Swipe right → previous
    else if (diff < -swipeThreshold) {
        if (lbMode === 'image') {
            stepImage(currentIndex - 1, -1);
        } else {
            stepVideo(-1);
        }
    }

    // Reset for next swipe
    touchStartX = 0;
    touchEndX = 0;
}, { passive: true });

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
// ── TRACKPAD TWO-FINGER HORIZONTAL SWIPE (wheel event) ────────────────────────
lightbox.addEventListener('wheel', (e) => {
    if (!lightbox.classList.contains('active')) return;

    // Only consider it a horizontal gesture if deltaX is clearly dominant
    const absDeltaX = Math.abs(e.deltaX);
    const absDeltaY = Math.abs(e.deltaY);

    if (absDeltaX > absDeltaY * 1.5 && absDeltaX > 15) {  // lowered threshold + stricter horizontal check
        e.preventDefault();  // stop vertical page scroll during horizontal gesture

        // Add a small debounce-like delay to avoid double triggers on some trackpads
        if (lightbox.dataset.swipeLocked === 'true') return;
        lightbox.dataset.swipeLocked = 'true';
        setTimeout(() => { lightbox.dataset.swipeLocked = 'false'; }, 300);

        if (e.deltaX > 0) {
            // → swipe left = next
            if (lbMode === 'image') {
                stepImage(currentIndex + 1, +1);
            } else {
                stepVideo(+1);
            }
        } else if (e.deltaX < 0) {
            // ← swipe right = previous
            if (lbMode === 'image') {
                stepImage(currentIndex - 1, -1);
            } else {
                stepVideo(-1);
            }
        }
    }
}, { passive: false });
