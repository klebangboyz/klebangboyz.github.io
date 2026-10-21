/**
 * Build Script for Klebang Boyz Space (klebang.boyz.space)
 * Generates a clean, standalone, production-ready `dist/` directory
 * for deployment to GitHub Pages, Cloudflare Pages, Vercel, or Netlify.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

console.log('🚀 Starting production build for klebang.boyz.space...\n');

// 1. Clean existing dist directory
if (fs.existsSync(distDir)) {
  console.log('🧹 Cleaning existing dist/ directory...');
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. Define files and directories to copy
const copyItems = [
  { src: 'index.html', isDir: false },
  { src: 'CNAME', isDir: false, optional: true },
  { src: 'config.json', isDir: false },
  { src: 'css', isDir: true },
  { src: 'js', isDir: true },
  { src: 'assets', isDir: true },
  { src: 'data', isDir: true }
];

let totalFiles = 0;
let totalBytes = 0;

function calculateStats(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      calculateStats(path.join(targetPath, entry));
    }
  } else {
    totalFiles++;
    totalBytes += stat.size;
  }
}

// 3. Copy items into dist
for (const item of copyItems) {
  const srcPath = path.join(rootDir, item.src);
  const destPath = path.join(distDir, item.src);

  if (!fs.existsSync(srcPath)) {
    if (item.optional) {
      console.log(`⚠️  Skipping optional item (not found): ${item.src}`);
      continue;
    } else {
      console.error(`❌ Required item missing: ${item.src}`);
      process.exit(1);
    }
  }

  if (item.isDir) {
    fs.cpSync(srcPath, destPath, { recursive: true });
    console.log(`📁 Copied directory: ${item.src}/ -> dist/${item.src}/`);
  } else {
    fs.copyFileSync(srcPath, destPath);
    console.log(`📄 Copied file:      ${item.src} -> dist/${item.src}`);
  }
}

// 4. Calculate total stats
calculateStats(distDir);

const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);
console.log('\n========================================');
console.log(`✅ Build Complete!`);
console.log(`📦 Destination: ${distDir}`);
console.log(`📊 Total Files: ${totalFiles}`);
console.log(`💾 Total Size:  ${sizeMB} MB`);
console.log('========================================\n');
console.log('💡 Live GitHub Config Editing:');
console.log('   - You can edit config.json in GitHub directly on the main branch.');
console.log('   - The site fetches config.json with fresh cache-busting headers.');
console.log('   - When pushed or edited, GitHub Actions deploys the new dist/ automatically.');
