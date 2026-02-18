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
    nature:  buildImageList('nature', 20),
    winter: buildImageList('winter', 20)
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
        currentList  = galleryImages[card.getAttribute('data-category')] ||;
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
    lightboxIframe.src = `https://www.youtube.com/embed/${videoList[index].id}?autoplay=1`;
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
