const fs = require('fs');

// Fetch live drbryankek page and find the story node for 122145642801151390
const https = require('https');

https.get('https://www.facebook.com/drbryankek', { headers: { 'User-Agent': 'curl/8.0.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode, 'len:', d.length);
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(d)) !== null) {
      const text = match[1];
      if (text.includes('122145642801151390') || text.includes('KONTROVERSI JEJANTAS') || text.includes('Tun Teja')) {
        console.log('Found script tag! Length:', text.length);
        try {
          const parsed = JSON.parse(text);
          findStory(parsed);
        } catch (e) {
          console.log('Parse error');
        }
      }
    }
  });
});

function findStory(o) {
  if (!o || typeof o !== 'object') return;
  if (o.id && (o.id.includes('122145642801151390') || (o.post_id && o.post_id.includes('122145642801151390')))) {
    console.log('Found story node! Keys:', Object.keys(o));
    if (o.comet_sections) {
      console.log('comet_sections:', Object.keys(o.comet_sections));
      const title = o.comet_sections.title || o.comet_sections.context_layout?.story?.comet_sections?.title;
      console.log('Title section:', JSON.stringify(title, null, 2).slice(0, 1000));
      const actors = o.comet_sections.context_layout?.story?.comet_sections?.actor_photo;
      console.log('Actor photo section:', JSON.stringify(actors, null, 2).slice(0, 500));
    }
    if (o.actors) console.log('actors:', JSON.stringify(o.actors, null, 2).slice(0, 500));
    if (o.to) console.log('to:', JSON.stringify(o.to, null, 2).slice(0, 500));
    if (o.with_tags) console.log('with_tags:', JSON.stringify(o.with_tags, null, 2).slice(0, 500));
    return;
  }
  for (const k of Object.keys(o)) findStory(o[k]);
}
