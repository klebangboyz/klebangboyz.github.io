const https = require('https');

const pageUrl = 'https://www.facebook.com/drbryankek';

https.get(pageUrl, { headers: { 'User-Agent': 'curl/8.0.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    // Find scripts with comet_sections or timeline_list_feed_units
    const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(d)) !== null) {
      const text = match[1];
      if (text.includes('122145695925151390') || text.includes('122145642639151390')) {
        console.log('Found script containing photo IDs! Length:', text.length);
        try {
          const parsed = JSON.parse(text);
          findPhotoObjects(parsed);
        } catch (e) {
          // If not pure JSON, find JSON substrings
          console.log('Not direct JSON, searching regex...');
          const photoUrls = text.match(/https:[\\\/A-Za-z0-9_.\-%?=&;]+scontent[\\\/A-Za-z0-9_.\-%?=&;]+/gi) || [];
          console.log('Photo URLs in script:', photoUrls.length);
          const cleaned = Array.from(new Set(photoUrls.map(u => u.replace(/\\u002526/g, '&').replace(/\\u00253D/g, '=').replace(/\\u00252F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&'))));
          cleaned.forEach((u, i) => console.log(i, u));
        }
      }
    }
  });
});

function findPhotoObjects(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 20) return;
  if (obj.photo_image || obj.all_subattachments || obj.subattachments || (obj.__typename === 'Photo' && obj.image)) {
    console.log('Found media obj:', JSON.stringify(obj).slice(0, 300));
  }
  for (const k of Object.keys(obj)) {
    findPhotoObjects(obj[k], depth + 1);
  }
}
