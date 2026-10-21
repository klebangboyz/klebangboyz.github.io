const fs = require('fs');
const https = require('https');

const url = 'https://www.facebook.com/drbryankek/posts/pfbid0pSrr6tF6uB89tDHT3ie1Edv46iui3B7Gp7Ptpb3gdogj3GKhbaB2tz7WR3hEBwbdl';

https.get(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    fs.writeFileSync('scripts/debug-collab-ext.html', d);
    console.log('Saved debug-collab-ext.html len:', d.length);
    const ogDesc = d.match(/<meta property="og:description" content="([^"]*)"/i);
    if (ogDesc) console.log('og:description:', ogDesc[1]);
    const ogTitle = d.match(/<meta property="og:title" content="([^"]*)"/i);
    if (ogTitle) console.log('og:title:', ogTitle[1]);
  });
});
