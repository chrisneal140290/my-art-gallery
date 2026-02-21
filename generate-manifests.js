/**
 * generate-manifests.js
 * ─────────────────────
 * Run this once from your website's root folder after uploading images.
 * It scans each gallery subfolder inside /images and writes a manifest.json
 * listing every image file found. The website then reads these manifests
 * instead of blindly probing for 1.png, 2.png... 20.png.
 *
 * USAGE (run from your website root folder):
 *   node generate-manifests.js
 *
 * REQUIREMENTS:
 *   Node.js installed (https://nodejs.org) — no extra packages needed.
 *
 * WHAT IT DOES:
 *   Reads every subfolder inside ./images/
 *   Finds all .png, .jpg, .jpeg, .webp files
 *   Sorts them naturally (1, 2, 3... 10, 11 — not 1, 10, 11, 2...)
 *   Writes images/<folder>/manifest.json for each subfolder
 *
 * RE-RUN whenever you add or remove images from a folder.
 */

const fs   = require('fs');
const path = require('path');

const IMAGES_DIR     = path.join(__dirname, 'images');
const IMAGE_EXTS     = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MANIFEST_FILE  = 'manifest.json';

// Natural sort so "10.png" comes after "9.png" not after "1.png"
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function run() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`✗  Could not find images folder at: ${IMAGES_DIR}`);
    console.error('   Make sure you run this script from your website root folder.');
    process.exit(1);
  }

  const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
  const subfolders = entries.filter(e => e.isDirectory()).map(e => e.name);

  if (!subfolders.length) {
    console.warn('⚠  No subfolders found inside /images — nothing to do.');
    return;
  }

  let totalWritten = 0;

  subfolders.forEach(folder => {
    const folderPath = path.join(IMAGES_DIR, folder);
    const files = fs.readdirSync(folderPath)
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort(naturalSort);

    if (!files.length) {
      console.log(`  ⚪  ${folder}/  — no image files, skipping`);
      return;
    }

    const manifest = { images: files };
    const manifestPath = path.join(folderPath, MANIFEST_FILE);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  ✓  ${folder}/manifest.json  (${files.length} image${files.length !== 1 ? 's' : ''})`);
    totalWritten++;
  });

  console.log(`\nDone — wrote ${totalWritten} manifest${totalWritten !== 1 ? 's' : ''}.`);
  console.log('Upload the manifest.json files alongside your images.\n');
}

run();
