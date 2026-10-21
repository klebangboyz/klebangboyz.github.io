const https = require('https');

const postUrl = 'https://www.facebook.com/drbryankek/posts/pfbid02szW323sTkHhoPKyke2KCk4PMCFw6EZzMGcuj2SzRtkgQVHKJ5WN2nzNstw2EBvkxl';
const pluginUrl = 'https://www.facebook.com/plugins/post.php?href=' + encodeURIComponent(postUrl) + '&show_text=1';

https.get(pluginUrl, { headers: { 'User-Agent': 'curl/8.0.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    // 1. Look for all <img> tags
    const imgRegex = /<img[^>]+src=["'](https:\/\/[^"'>]*?scontent[^"'>]*?)["'][^>]*>/gi;
    let match;
    const candidates = [];
    while ((match = imgRegex.exec(d)) !== null) {
      const u = match[1].replace(/&amp;/g, '&');
      if (!u.includes('s40x40') && !u.includes('30808-1/') && !u.includes('/picture')) {
        candidates.push(u);
      }
    }

    // 2. Also search for any JSON-embedded scontent image URLs
    const jsonRegex = /https:[\\\/A-Za-z0-9_.\-%?=&;]+scontent[\\\/A-Za-z0-9_.\-%?=&;]+/gi;
    const jsonMatches = d.match(jsonRegex) || [];
    for (let m of jsonMatches) {
      m = m.replace(/\\u002526/g, '&').replace(/\\u00253D/g, '=').replace(/\\u00252F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
      if (m.endsWith('\\')) m = m.slice(0, -1);
      if (!m.includes('s40x40') && !m.includes('30808-1/') && !m.includes('/picture') && (m.includes('.jpg') || m.includes('.png') || m.includes('dst-jpg') || m.includes('stp='))) {
        candidates.push(m);
      }
    }

    // Deduplicate by filename / photo ID
    const photoMap = new Map();
    for (const url of candidates) {
      // Extract unique photo identifier like 833890497_122145695925151390
      const idMatch = url.match(/\/(\d+_\d+_\d+_[a-z0-9]+)/i) || url.match(/\/([^\/?#]+\.(?:jpg|png|webp))/i);
      const key = idMatch ? idMatch[1] : url.split('?')[0];
      if (!photoMap.has(key)) {
        photoMap.set(key, url);
      } else {
        // Prefer higher resolution: e.g. without small thumbnail constraints
        const existing = photoMap.get(key);
        // If current has bigger dimension or higher quality
        if (existing.includes('s280x280') || existing.includes('s414x') || existing.includes('p417x417')) {
          photoMap.set(key, url);
        }
      }
    }

    console.log('Unique photos count:', photoMap.size);
    Array.from(photoMap.values()).forEach((u, i) => {
      console.log(`\nPhoto [${i}]:`);
      console.log('Original:', u);
      // Can we get high-res by removing or upgrading stp parameter?
      // Notice: `stp=dst-jpg_s552x414_tt6` downscales it!
      // If we remove the `stp` constraint or change to higher res:
      const highRes = u.replace(/stp=[^&]+&?/g, '').replace(/[?&]$/, '');
      console.log('Cleaned high-res candidate:', highRes);
    });
  });
});
