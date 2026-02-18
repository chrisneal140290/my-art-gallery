// Hamburger Menu Toggle
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');
const navLinks = document.querySelectorAll('.nav-link');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
});

// Close menu when clicking on a link
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    });
});

// Lightbox Functionality
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');

// Gallery images data (you can replace this with CMS data)
const galleryImages = {
    food: [
        'images/oranges.jpg',
        'images/food2.jpg',
        'images/food3.jpg'
    ],
    animals: [
        'images/giraffes.jpg',
        'images/animal2.jpg',
        'images/animal3.jpg'
    ],
    olympics: [
        'images/skier.jpg',
        'images/olympic2.jpg',
        'images/olympic3.jpg'
    ]
};

let currentCategory = '';
let currentImageIndex = 0;

// Open lightbox when clicking on gallery cards
document.querySelectorAll('.gallery-card').forEach(card => {
    card.addEventListener('click', () => {
        currentCategory = card.getAttribute('data-category');
        currentImageIndex = 0;
        openLightbox();
    });
});

function openLightbox() {
    const images = galleryImages[currentCategory];
    if (images && images.length > 0) {
        lightboxImage.src = images[currentImageIndex];
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function showPrevImage() {
    const images = galleryImages[currentCategory];
    currentImageIndex = (currentImageIndex - 1 + images.length) % images.length;
    lightboxImage.src = images[currentImageIndex];
}

function showNextImage() {
    const images = galleryImages[currentCategory];
    currentImageIndex = (currentImageIndex + 1) % images.length;
    lightboxImage.src = images[currentImageIndex];
}

// Lightbox controls
lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', showPrevImage);
lightboxNext.addEventListener('click', showNextImage);

// Close lightbox when clicking outside image
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        closeLightbox();
    }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showPrevImage();
    if (e.key === 'ArrowRight') showNextImage();
});

// Video Thumbnails
const videoThumbs = document.querySelectorAll('.video-thumb');
const mainVideo = document.getElementById('mainVideo');

videoThumbs.forEach(thumb => {
    thumb.addEventListener('click', () => {
        const videoSrc = thumb.getAttribute('data-video');
        mainVideo.src = videoSrc;
        mainVideo.play();
    });
});

// Smooth scroll offset for fixed header
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offset = 80; // Header height
            const targetPosition = target.offsetTop - offset;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});
