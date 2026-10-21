const https = require('https');

const url = 'https://www.facebook.com/plugins/post.php?href=' + encodeURIComponent('https://www.facebook.com/drbryankek/posts/pfbid0pSrr6tF6uB89tDHT3ie1Edv46iui3B7Gp7Ptpb3gdogj3GKhbaB2tz7WR3hEBwbdl') + '&show_text=1';

https.get(url, { headers: { 'User-Agent': 'curl/8.0.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode, 'len:', d.length);
    // Print all links
    const linkRegex = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    console.log('Links in post:');
    while ((m = linkRegex.exec(d)) !== null) {
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (text) {
        console.log(`  href: ${m[1]} -> text: "${text}"`);
      }
    }
    const clean = d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('Snippet:', clean.slice(0, 1000));
  });
});
