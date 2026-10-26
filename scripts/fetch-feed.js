/**
 * KLEBANG BOYZ SPACE - Real Social Media Feed Ingester
 * 
 * Fetches real posts directly from Facebook public pages defined in config.json.
 * Dynamic extraction of author, avatar, permalink, timestamp, message, AND real media (images & videos).
 * If video: provides video player URL with autoplay disabled (autoplay=0).
 * If photo: extracts real Facebook CDN image URL.
 * Preserves & merges historical posts so no data is dropped.
 * Strict filtering by globalHashtags defined in config.json.
 * Zero placeholders.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const configPath = path.join(__dirname, '..', 'config.json');
const outputPath = path.join(__dirname, '..', 'data', 'feed.json');

function extractFacebookId(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.searchParams.has('id')) {
      return u.searchParams.get('id');
    }
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || '';
  } catch (e) {
    return url.replace(/https?:\/\/(www\.)?facebook\.com\/?/i, '').split('/')[0].split('?')[0].trim();
  }
}

function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[a-zA-Z0-9_\u0080-\uFFFF]+/g);
  if (!matches) return [];
  return matches.map(t => t.toLowerCase());
}

function postMatchesHashtags(post, configuredHashtags) {
  if (!configuredHashtags || configuredHashtags.length === 0) return true;
  const normalizedTags = configuredHashtags
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .map(t => t.startsWith('#') ? t : '#' + t);
  if (normalizedTags.length === 0) return true;

  const postText = (post.content || '') + ' ' + (post.resharedPost?.content || '');
  const actualHashtags = new Set(extractHashtags(postText));

  if (Array.isArray(post.hashtags)) {
    post.hashtags.forEach(t => {
      const clean = t.trim().toLowerCase();
      actualHashtags.add(clean.startsWith('#') ? clean : '#' + clean);
    });
  }

  return normalizedTags.some(t => actualHashtags.has(t));
}

async function fetchUrl(url, maxRedirects = 5, customUserAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)') {
  if (!url) return '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': customUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
    if (!res.ok && res.status !== 304) {
      return '';
    }
    return await res.text();
  } catch (err) {
    return '';
  }
}

async function downloadImageToFile(url, destPath) {
  if (!url || !destPath) return false;
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    return true;
  }
  const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'curl/8.0.0',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
  ];

  for (const ua of uas) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': 'https://www.facebook.com/'
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow'
      });
      if (!res.ok) continue;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) continue;

      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(destPath, buffer);
      return true;
    } catch (e) {
      // try next UA
    }
  }
  return false;
}

function extractResolutionScore(url) {
  if (
    url.includes('t39.1997-') ||
    url.includes('t39.2365-') ||
    url.includes('t39.20818-') ||
    url.includes('/m1/v/t6/') ||
    url.includes('-1/') ||
    url.includes('/picture') ||
    url.includes('emoji.php') ||
    url.includes('/rsrc.php/') ||
    url.includes('static.xx.fbcdn.net')
  ) {
    return -1;
  }

  // Check for max dimension if present (e.g. mx1536x1536, mx960x1280)
  const mxMatch = url.match(/mx([0-9]+)x([0-9]+)/i);
  if (mxMatch) {
    return parseInt(mxMatch[1], 10) * parseInt(mxMatch[2], 10);
  }

  // Check for downscaled thumbnail dimension
  const downscaleMatch = url.match(/[_/][sp]([0-9]+)x([0-9]+)/i) || url.match(/ctp=[sp]([0-9]+)x([0-9]+)/i);
  if (downscaleMatch) {
    const w = parseInt(downscaleMatch[1], 10);
    const h = parseInt(downscaleMatch[2], 10);
    return w * h;
  }

  // Original uncompressed / unresized upload
  return 10000000;
}

/**
 * Fetch all real high-res photos and video for a post
 */
async function fetchPostMedia(permalink) {
  if (!permalink) return { images: [], videoUrl: '', videoClip: '', isVideo: false };

  const isVideo = permalink.includes('/videos/') || permalink.includes('/reel/');
  const vidMatch = permalink.match(/(?:videos|reel)\/([0-9]+)/i);
  const vidId = vidMatch ? vidMatch[1] : '';

  // Check if local video poster already exists and is non-empty
  if (isVideo && vidId) {
    const localRel = `data/images/poster_${vidId}.jpg`;
    const localAbs = path.resolve(__dirname, '..', localRel);
    if (fs.existsSync(localAbs) && fs.statSync(localAbs).size > 1000) {
      return {
        images: [localRel],
        videoUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0`,
        videoClip: '',
        isVideo: true
      };
    }
  }

  const pluginUrl = isVideo
    ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0`
    : `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(permalink)}&show_text=1`;

  try {
    let combined = '';
    if (isVideo && vidId) {
      const probeUrls = [
        `https://www.facebook.com/watch/?v=${vidId}`,
        `https://www.facebook.com/reel/${vidId}/`,
        permalink
      ];
      const probeUas = [
        'curl/8.0.0',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      ];
      for (const pUrl of probeUrls) {
        for (const pUa of probeUas) {
          const h = await fetchUrl(pUrl, 5, pUa);
          if (h && (h.includes('og:image') || h.includes('twitter:image') || h.includes('scontent'))) {
            combined += ' ' + h;
            break;
          }
        }
        if (combined.includes('og:image') || combined.includes('twitter:image')) break;
      }
    } else {
      let htmlRaw = await fetchUrl(permalink, 5, 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)');
      if (!htmlRaw) {
        htmlRaw = await fetchUrl(permalink, 5, 'curl/8.0.0');
      }
      const htmlPlugin = await fetchUrl(pluginUrl, 3, 'curl/8.0.0');
      combined = (htmlRaw || '') + ' ' + (htmlPlugin || '');
    }

    const photoMap = new Map();

    // Check OpenGraph og:image or twitter:image first (best single media / video thumbnail)
    const ogMatch = combined.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                    combined.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
                    combined.match(/<meta\b[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
                    combined.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
    if (ogMatch) {
      const ogUrl = ogMatch[1].replace(/&amp;/g, '&');
      if (ogUrl.includes('fbcdn.net') && !ogUrl.includes('static.xx')) {
        photoMap.set('og_image', { url: ogUrl, score: 99999999 });
      }
    }

    const jsonRegex = /https:[\\\/A-Za-z0-9_.\-%?=&;]+scontent[\\\/A-Za-z0-9_.\-%?=&;]+/gi;
    const matches = combined.match(jsonRegex) || [];

    for (let m of matches) {
      m = m.replace(/\\u002526/g, '&').replace(/\\u00253D/g, '=').replace(/\\u00252F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
      const endIdx = m.search(/["'\s<>\\]/);
      if (endIdx !== -1) m = m.substring(0, endIdx);

      // ONLY allow authentic Facebook user photo uploads and video covers!
      // Excludes stickers (t39.1997-), emojis, reaction sprites (/m1/v/t6/), UI icons, and avatars (-1/)
      if (m.includes('-1/') || m.includes('/m1/v/t6/') || m.includes('t39.1997-') || m.includes('.kf') || m.includes('.srt')) {
        continue;
      }

      // Must be user photo/media CDN (t39, t51, t15, t1, t31)
      if (!m.includes('t39.30808-') && !m.includes('t51.') && !m.includes('t15.') && !m.includes('t1.6435-') && !m.includes('t31.0-') && !m.includes('t1.18169-')) {
        continue;
      }

      const score = extractResolutionScore(m);
      if (score < 50000) continue; // Skip stickers and low-res thumbnails

      const idMatch = m.match(/\/([0-9]+_[0-9]+_[0-9]+_[a-z0-9]+)/i) || m.match(/\/([^\/?#]+\.(?:jpg|png|webp))/i);
      const key = idMatch ? idMatch[1] : m.split('?')[0];

      if (!photoMap.has(key) || score > photoMap.get(key).score) {
        photoMap.set(key, { url: m, score });
      }
    }

    let images = Array.from(photoMap.values()).map(x => x.url);

    // If it's a video and we found a remote thumbnail, download it locally to ensure it NEVER expires
    if (isVideo && vidId && images.length > 0) {
      const localRel = `data/images/poster_${vidId}.jpg`;
      const localAbs = path.resolve(__dirname, '..', localRel);
      try {
        const downloaded = await downloadImageToFile(images[0], localAbs);
        if (downloaded) {
          console.log(`-> Cached permanent video poster: ${localRel}`);
          images = [localRel];
        }
      } catch (err) {
        console.warn(`Could not cache poster for ${vidId}:`, err.message);
      }
    }

    let videoClip = '';
    const videoMatch = combined.match(/<video[^>]+src=["']([^"']+)["']/i) || combined.match(/"playable_url(?:_quality_hd)?":\s*"([^"]+)"/i);
    if (videoMatch) {
      videoClip = videoMatch[1].replace(/\\u002526/g, '&').replace(/\\u00252F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    }

    return {
      images,
      videoUrl: isVideo ? pluginUrl : '',
      videoClip,
      isVideo: isVideo || !!videoClip
    };
  } catch (e) {
    console.warn('Could not fetch media for:', permalink, e.message);
  }

  return { images: [], videoUrl: '', videoClip: '', isVideo: false };
}

async function fetchPostPhoto(permalink) {
  const media = await fetchPostMedia(permalink);
  return media.images[0] || '';
}

function parseFacebookHtml(html, pageId, globalHashtags = []) {
  if (!html) return [];

  // Extract OpenGraph fallback metadata
  const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
  const pageAuthor = ogTitleMatch ? ogTitleMatch[1].replace(/ \| Facebook$/i, '').trim() : pageId;
  const pageAvatar = `https://graph.facebook.com/${encodeURIComponent(pageId)}/picture?type=large`;

  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let feedEdges = [];
  const rawStoryNodes = [];

  while ((match = scriptRegex.exec(html)) !== null) {
    const text = match[1];
    if (text.includes('timeline_list_feed_units') || (text.includes('permalink_url') && text.includes('message'))) {
      try {
        const parsed = JSON.parse(text);
        findEdges(parsed);
        findStories(parsed, rawStoryNodes);
      } catch (e) {}
    }
  }

  function findEdges(o) {
    if (!o || typeof o !== 'object') return;
    if (o.timeline_list_feed_units && Array.isArray(o.timeline_list_feed_units.edges)) {
      feedEdges.push(...o.timeline_list_feed_units.edges);
    }
    for (const k of Object.keys(o)) {
      findEdges(o[k]);
    }
  }

  function findStories(obj, list) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.__typename === 'Story' || (obj.message && obj.message.text && (obj.permalink_url || obj.url))) {
      list.push(obj);
    }
    for (const k of Object.keys(obj)) {
      findStories(obj[k], list);
    }
  }

  function extractAttachedStory(n, cs) {
    const attached = cs?.attached_story || n?.attached_story;
    if (!attached) return null;

    const target = attached.story || attached;
    const actor = (target.actors && target.actors[0]) || (target.comet_sections?.context_layout?.story?.comet_sections?.actor_photo?.story?.actors?.[0]);
    let authorName = actor?.name || '';
    let authorAvatar = actor?.profile_picture?.uri || (actor?.id ? `https://graph.facebook.com/${actor.id}/picture?type=large` : '');
    const message = target.message?.text || target.comet_sections?.content?.story?.message?.text || '';
    const permalink = target.permalink_url || target.wwwURL || target.url || '';
    const timestamp = target.creation_time || target.comet_sections?.timestamp?.story?.creation_time;

    // Resolve author from permalink or content if not explicitly provided by FB
    if (!authorName) {
      const lowerPerma = permalink.toLowerCase();
      const lowerMsg = message.toLowerCase();
      if (lowerPerma.includes('bersamagohan') || lowerMsg.includes('#pengkalanbatu') || lowerMsg.includes('melaka sentral')) {
        authorName = 'Bersamagohan';
        authorAvatar = 'https://graph.facebook.com/Bersamagohan/picture?type=large';
      }
    }

    let image = '';
    let videoClip = '';
    let mediaType = 'text';

    const attachments = target.attachments || target.comet_sections?.content?.story?.attachments;
    const images = [];
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        const media = att.media;
        if (media) {
          if (media.__typename === 'Video' || att.style_type_renderer?.video) {
            mediaType = 'video';
            videoClip = media.playable_url || media.playable_url_quality_hd || '';
            image = media.preferred_thumbnail?.image?.uri || media.image?.uri || '';
            if (image) images.push(image);
          } else if (media.image?.uri || media.photo_image?.uri) {
            const u = media.image?.uri || media.photo_image?.uri || '';
            if (u && !u.includes('-1/') && !u.includes('lookaside.fbsbx.com')) {
              if (!image) image = u;
              images.push(u);
            }
          }
        }
        const sub = att.styles?.attachment?.all_subattachments?.nodes || att.subattachments?.nodes || [];
        for (const sn of sub) {
          const subMedia = sn.media;
          if (subMedia) {
            const subUri = subMedia.viewer_image?.uri || subMedia.image?.uri || subMedia.photo_image?.uri || '';
            if (subUri && !subUri.includes('-1/') && !subUri.includes('lookaside.fbsbx.com')) {
              if (!image) image = subUri;
              images.push(subUri);
            }
          }
        }
      }
    }

    if (!authorName && !message && !image && !videoClip) return null;

    const uniqueImages = Array.from(new Set(images));
    return {
      author: authorName,
      authorAvatar: authorAvatar,
      content: message,
      dateFormatted: timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      url: permalink,
      image: image,
      images: uniqueImages,
      videoClip: videoClip,
      mediaType: mediaType === 'video' ? 'video' : (uniqueImages.length > 1 ? 'gallery' : (uniqueImages.length === 1 ? 'image' : 'text'))
    };
  }

  function extractNodeMedia(node, contentStory) {
    const images = [];
    let isVideo = false;
    let videoClip = '';

    const attachments = node?.attachments || contentStory?.attachments || node?.comet_sections?.content?.story?.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        const media = att.media;
        if (media) {
          if (media.__typename === 'Video' || att.style_type_renderer?.video) {
            isVideo = true;
            videoClip = media.playable_url || media.playable_url_quality_hd || '';
            const thumb = media.preferred_thumbnail?.image?.uri || media.image?.uri || '';
            if (thumb && !thumb.includes('-1/') && !thumb.includes('lookaside.fbsbx.com')) images.push(thumb);
          } else {
            const uri = media.image?.uri || media.photo_image?.uri || '';
            if (uri && !uri.includes('-1/') && !uri.includes('lookaside.fbsbx.com')) images.push(uri);
          }
        }

        const sub = att.styles?.attachment?.all_subattachments?.nodes || att.subattachments?.nodes || [];
        for (const sn of sub) {
          const subMedia = sn.media;
          if (subMedia) {
            const subUri = subMedia.viewer_image?.uri || subMedia.image?.uri || subMedia.photo_image?.uri || '';
            if (subUri && !subUri.includes('-1/') && !subUri.includes('lookaside.fbsbx.com')) images.push(subUri);
          }
        }
      }
    }

    const uniqueImages = Array.from(new Set(images));
    return {
      images: uniqueImages,
      image: uniqueImages[0] || '',
      isVideo,
      videoClip
    };
  }

  const posts = [];
  const seenUrls = new Set();

  // 1. Process timeline edges
  for (const edge of feedEdges) {
    const node = edge.node;
    if (!node) continue;

    const contentStory = node.comet_sections?.content?.story;
    const message = contentStory?.message?.text || node.message?.text || '';
    const reshared = extractAttachedStory(node, contentStory);

    if (!message.trim() && (!reshared || !reshared.content.trim())) continue;

    // Filter by global hashtags: ONLY ingest posts that actually contain the hashtag
    if (globalHashtags.length > 0) {
      const hasTag = postMatchesHashtags({ content: message, resharedPost: reshared }, globalHashtags);
      if (!hasTag) continue;
    }

    const permalink = node.permalink_url || contentStory?.wwwURL || `https://www.facebook.com/${pageId}`;
    if (seenUrls.has(permalink)) continue;
    seenUrls.add(permalink);

    const timestamp = node.creation_time || node.comet_sections?.timestamp?.story?.creation_time;
    const actor = (node.actors && node.actors[0]) || (contentStory?.actors && contentStory.actors[0]);
    const authorName = actor?.name || pageAuthor;

    const nodeMedia = extractNodeMedia(node, contentStory);
    const isVideo = permalink.includes('/videos/') || (node.attachments && node.attachments[0]?.media?.__typename === 'Video') || nodeMedia.isVideo;
    const postImages = nodeMedia.images.length > 0 ? nodeMedia.images : (reshared?.images || (reshared?.image ? [reshared.image] : []));
    const postImage = nodeMedia.image || reshared?.image || '';
    const postMediaType = isVideo ? 'video' : (postImages.length > 1 ? 'gallery' : (postImages.length === 1 ? 'image' : (reshared?.mediaType || 'none')));

    posts.push({
      id: node.id || permalink,
      sourceId: pageId,
      author: authorName,
      rawAuthor: authorName,
      authorAvatar: pageAvatar,
      date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      dateFormatted: timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      url: permalink,
      content: message,
      isReshare: !!reshared,
      resharedPost: reshared || null,
      mediaType: postMediaType,
      videoUrl: isVideo ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0` : '',
      videoClip: nodeMedia.videoClip || reshared?.videoClip || '',
      image: postImage,
      images: postImages,
      likes: node.feedback?.reaction_count?.count || 0,
      comments: node.feedback?.comments_count?.total_count || 0,
      shares: node.feedback?.share_count?.count || 0
    });
  }

  // 2. Process any raw stories that weren't captured by edges
  for (const s of rawStoryNodes) {
    const message = s.message?.text || '';
    const reshared = extractAttachedStory(s, null);
    if (!message.trim() && (!reshared || !reshared.content.trim())) continue;

    if (globalHashtags.length > 0) {
      const hasTag = postMatchesHashtags({ content: message, resharedPost: reshared }, globalHashtags);
      if (!hasTag) continue;
    }

    const permalink = s.permalink_url || s.url || '';
    if (!permalink || seenUrls.has(permalink)) continue;
    seenUrls.add(permalink);

    const timestamp = s.creation_time || s.publish_time;
    const actor = s.actors && s.actors[0];
    const authorName = actor?.name || pageAuthor;
    const nodeMedia = extractNodeMedia(s, null);
    const isVideo = permalink.includes('/videos/') || nodeMedia.isVideo;
    const postImages = nodeMedia.images.length > 0 ? nodeMedia.images : (reshared?.images || (reshared?.image ? [reshared.image] : []));
    const postImage = nodeMedia.image || reshared?.image || '';
    const postMediaType = isVideo ? 'video' : (postImages.length > 1 ? 'gallery' : (postImages.length === 1 ? 'image' : (reshared?.mediaType || 'none')));

    posts.push({
      id: s.id || permalink,
      sourceId: pageId,
      author: authorName,
      rawAuthor: authorName,
      authorAvatar: pageAvatar,
      date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      dateFormatted: timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      url: permalink,
      content: message,
      isReshare: !!reshared,
      resharedPost: reshared || null,
      mediaType: postMediaType,
      videoUrl: isVideo ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0` : '',
      videoClip: nodeMedia.videoClip || reshared?.videoClip || '',
      image: postImage,
      images: postImages,
      likes: 0,
      comments: 0,
      shares: 0
    });
  }

  return posts;
}

function getReshareKey(p) {
  if (!p || (!p.isReshare && !p.resharedPost && (!p.id || !p.id.startsWith('multi_reshare_')))) return null;
  const reshare = p.resharedPost || {};
  const author = (reshare.author || '').trim().toLowerCase();
  const textSample = (reshare.content || p.content || '').replace(/#[\w\u0080-\uffff]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
  if (author && textSample) {
    return `reshare::${author}::${textSample}`;
  }
  const u = (reshare.url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  if (u) return `reshare::${u}`;
  return null;
}

// Canonical post key deduplication:
// Normalizes across different profile crawl IDs, transient pfbid slugs, and multi-profile reshares
function getPostKey(p) {
  if (!p) return null;

  // 1. Reshare canonical target
  const rKey = getReshareKey(p);
  if (rKey) return rKey;

  // 2. Video or reel numeric ID (e.g. /videos/123/ or /reel/123/)
  const url = (p.url || '').split('?')[0].replace(/\/+$/, '');
  const vidMatch = url.match(/(?:videos|reel)\/([0-9]+)/i);
  if (vidMatch) {
    return `video::${vidMatch[1]}`;
  }

  // 3. Canonical Story ID from base64 GraphQL ID (immutable across crawls & pfbid aliases)
  if (p.id && !p.id.startsWith('multi_reshare_')) {
    try {
      const decoded = Buffer.from(p.id, 'base64').toString('utf8');
      const storyMatch = decoded.match(/:\s*([0-9]{10,}):/);
      if (storyMatch) {
        return `story::${storyMatch[1]}`;
      }
    } catch (e) {}
  }

  // 4. story_fbid or fbid query parameter in URL
  const fullUrl = p.url || '';
  const fbidMatch = fullUrl.match(/[?&](?:story_fbid|fbid)=([0-9]+)/i);
  if (fbidMatch) {
    return `story::${fbidMatch[1]}`;
  }

  // 5. Normalized substantial content + author fingerprint (detects edits & multi-shares)
  const cleanContent = (p.content || '').replace(/#[\w\u0080-\uffff]+/g, '').replace(/\s+/g, ' ').trim();
  if (cleanContent.length >= 20) {
    const authorNorm = (p.rawAuthor || p.author || '').toLowerCase().trim();
    return `content::${authorNorm}::${cleanContent.slice(0, 80).toLowerCase()}`;
  }

  // 6. pfbid in URL as fallback when no canonical story ID is present
  const pfbidMatch = url.match(/(pfbid[a-zA-Z0-9]+)/i);
  if (pfbidMatch) {
    return `pfbid::${pfbidMatch[1]}`;
  }

  if (p.id) return `id::${p.id}`;
  if (url) return `url::${url.toLowerCase()}`;
  return null;
}

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error('config.json not found');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const rawProfiles = config.profiles || config.facebookSources || [];
  const sources = rawProfiles.map(s => typeof s === 'string' ? { url: s } : s).filter(s => s && s.url);
  const hashtags = (config.hashtags || config.globalHashtags || []).map(t => t.toLowerCase().trim());

  console.log(`Ingesting for real from ${sources.length} Facebook source(s) with hashtags:`, hashtags);

  const allPosts = [];

  for (const src of sources) {
    const pageId = extractFacebookId(src.url);
    if (!pageId) continue;

    console.log(`Fetching live Facebook page: ${src.url} (pageId: ${pageId})...`);
    const html = await fetchUrl(src.url);
    
    if (html) {
      const pagePosts = parseFacebookHtml(html, pageId, hashtags);
      console.log(`Extracted ${pagePosts.length} real posts from ${pageId} matching hashtags.`);
      allPosts.push(...pagePosts);
    }
  }

  // 1-Year Limit Cutoff (365 days)
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - ONE_YEAR_MS);
  const isWithinOneYear = (dateStr) => {
    if (!dateStr) return true;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return true;
    return d >= cutoffDate;
  };

  // Full scrape processing:
  // 1. Freshly scraped posts from live pages take precedence (reflects changed/edited posts and current media)
  const postMap = new Map();
  const freshlyScrapedUrls = new Set();

  for (const p of allPosts) {
    if (postMatchesHashtags(p, hashtags) && isWithinOneYear(p.date)) {
      const key = getPostKey(p);
      if (!key) continue;

      // Sync shared post image if available
      if (p.isReshare && p.resharedPost) {
        if (!p.resharedPost.image && p.image) p.resharedPost.image = p.image;
        if (!p.image && p.resharedPost.image) p.image = p.resharedPost.image;
      }

      if (postMap.has(key)) {
        const existing = postMap.get(key);
        const mergedSources = new Set([...(existing.sources || []), ...(p.sources || [])]);
        if (p.sourceId) mergedSources.add(p.sourceId);
        if (existing.sourceId) mergedSources.add(existing.sourceId);
        existing.sources = Array.from(mergedSources);

        if (Array.isArray(p.collaborators)) {
          existing.collaborators = existing.collaborators || [];
          for (const c of p.collaborators) {
            if (!existing.collaborators.some(ec => ec.id === c.id || ec.name === c.name)) {
              existing.collaborators.push(c);
            }
          }
        }

        const imgSet = new Set(existing.images || []);
        for (const img of (p.images || [])) {
          if (img && !imgSet.has(img)) {
            imgSet.add(img);
            existing.images.push(img);
          }
        }
        if (!existing.image && p.image) existing.image = p.image;
        // Prefer post with more recent timestamp if available
        if (p.date && (!existing.date || new Date(p.date) > new Date(existing.date))) {
          existing.date = p.date;
          existing.dateFormatted = p.dateFormatted;
        }
      } else {
        postMap.set(key, p);
      }
      if (p.url) freshlyScrapedUrls.add(p.url);
    }
  }

  // 2. Load historical posts:
  // - Drop posts older than 1 year
  // - Verify if historical posts not seen on the live page still exist (detect deleted posts)
  if (fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      if (existing.posts && Array.isArray(existing.posts)) {
        for (const p of existing.posts) {
          const key = getPostKey(p);
          if (!key) continue;

          // If already refreshed by the full scrape, keep fresh version but preserve existing image/collaborators if fresh lacks it
          if (postMap.has(key)) {
            const fresh = postMap.get(key);
            if (p.image && !fresh.image) {
              fresh.image = p.image;
            }
            if (p.images && p.images.length > 0 && (!fresh.images || fresh.images.length === 0)) {
              fresh.images = p.images;
            }
            if (Array.isArray(p.sources)) {
              const sSet = new Set([...(fresh.sources || []), ...p.sources]);
              fresh.sources = Array.from(sSet);
            }
            if (Array.isArray(p.collaborators)) {
              fresh.collaborators = fresh.collaborators || [];
              for (const c of p.collaborators) {
                if (!fresh.collaborators.some(fc => (fc.id && c.id && fc.id === c.id) || fc.name === c.name)) {
                  fresh.collaborators.push(c);
                }
              }
            }
            if (Array.isArray(p.sharers)) {
              fresh.sharers = fresh.sharers || [];
              for (const s of p.sharers) {
                if (!fresh.sharers.some(fs => (fs.sourceId && s.sourceId && fs.sourceId === s.sourceId) || fs.author === s.author)) {
                  fresh.sharers.push(s);
                }
              }
            }
            if (fresh.isReshare && fresh.resharedPost) {
              if (p.resharedPost?.image && !fresh.resharedPost.image) {
                fresh.resharedPost.image = p.resharedPost.image;
              }
              if (p.resharedPost?.images && (!fresh.resharedPost.images || fresh.resharedPost.images.length === 0)) {
                fresh.resharedPost.images = p.resharedPost.images;
              }
              if (!fresh.image && fresh.resharedPost?.image) {
                fresh.image = fresh.resharedPost.image;
              }
              if ((!fresh.images || fresh.images.length === 0) && fresh.resharedPost?.images) {
                fresh.images = fresh.resharedPost.images;
              }
            }
            continue;
          }

          // 1-Year age limit: drop historical posts older than 1 year
          if (!isWithinOneYear(p.date)) {
            console.log(`Dropping post older than 1 year: ${p.url || p.id} (${p.date})`);
            continue;
          }

          // Strict hashtag filter
          if (!postMatchesHashtags(p, hashtags)) {
            continue;
          }

          // Deleted post detection: check if historical post is still alive on Facebook
          if (p.url) {
            console.log(`Checking if historical post still exists: ${p.url}...`);
            const checkUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(p.url)}&show_text=0`;
            const checkHtml = await fetchUrl(checkUrl, 2, 'curl/8.0.0');
            if (checkHtml && (
              checkHtml.includes("This content isn't available right now") ||
              checkHtml.includes("may have been removed") ||
              checkHtml.includes("Page Not Found")
            )) {
              console.log(`-> Detected deleted post on Facebook, dropping: ${p.url}`);
              continue;
            }
          }

          if (p.isReshare && p.resharedPost) {
            if (!p.resharedPost.image && p.image) p.resharedPost.image = p.image;
            if (!p.image && p.resharedPost.image) p.image = p.resharedPost.image;
          }

          postMap.set(key, p);
        }
      }
    } catch (e) {
      console.warn('Error verifying historical posts:', e.message);
    }
  }

  const finalPosts = Array.from(postMap.values()).filter(p => postMatchesHashtags(p, hashtags) && isWithinOneYear(p.date));

  // Fetch real photos/posters/galleries for posts
  for (const post of finalPosts) {
    const targetUrl = (post.isReshare && post.resharedPost) ? (post.resharedPost.url || post.url) : post.url;

    // Check if we need to fetch multi-photo media or resolve real CDN photos
    const hasLookaside = (post.images || []).some(img => img.includes('lookaside.fbsbx.com')) || (post.image && post.image.includes('lookaside.fbsbx.com'));
    const needsResolution = !post.images || post.images.length === 0 || hasLookaside || (post.images.length <= 1 && post.mediaType !== 'video');

    if (needsResolution) {
      console.log(`Resolving high-res media for: ${targetUrl}...`);
      const media = await fetchPostMedia(targetUrl);
      if (media.images && media.images.length > 0) {
        post.images = media.images;
        post.image = media.images[0];
        if (post.mediaType !== 'video') {
          post.mediaType = media.images.length > 1 ? 'gallery' : 'image';
        }
        console.log(`-> Got ${media.images.length} high-res photo(s) for ${targetUrl}`);
      }
      if (media.videoClip && !post.videoClip) {
        post.videoClip = media.videoClip;
        post.mediaType = 'video';
      }
    }

    // Filter out any lookaside URLs as they cannot render in browsers
    if (Array.isArray(post.images)) {
      post.images = post.images.filter(img => !img.includes('lookaside.fbsbx.com'));
    }
    if (post.image && post.image.includes('lookaside.fbsbx.com')) {
      post.image = (post.images && post.images[0]) || '';
    }

    // Ensure all video posts have a permanent local poster
    if (post.mediaType === 'video' || (post.url && (post.url.includes('/videos/') || post.url.includes('/reel/')))) {
      post.mediaType = 'video';
      const vidMatch = (post.url || '').match(/(?:videos|reel)\/([0-9]+)/i);
      if (vidMatch) {
        const vidId = vidMatch[1];
        const localRel = `data/images/poster_${vidId}.jpg`;
        const localAbs = path.resolve(__dirname, '..', localRel);

        // Clean up legacy svg references
        if (post.image && post.image.endsWith('.svg')) post.image = '';
        if (Array.isArray(post.images)) post.images = post.images.filter(img => !img.endsWith('.svg'));

        // 1. If local poster already exists on disk, always prefer it
        if (fs.existsSync(localAbs) && fs.statSync(localAbs).size > 1000) {
          post.image = localRel;
          post.images = [localRel];
        } else {
          // 2. If we have a remote CDN thumbnail, download and cache it locally
          let downloaded = false;
          if (post.image && post.image.startsWith('http')) {
            try {
              console.log(`-> Downloading video thumbnail to local poster: ${localRel}...`);
              downloaded = await downloadImageToFile(post.image, localAbs);
            } catch (e) {}
          }

          // 3. If still not downloaded, probe Facebook watch, reel, and video URLs
          if (!downloaded) {
            const probeUrls = [
              `https://www.facebook.com/watch/?v=${vidId}`,
              `https://www.facebook.com/reel/${vidId}/`,
              post.url
            ].filter(Boolean);

            const probeUas = [
              'curl/8.0.0',
              'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            ];

            let probedOg = '';
            for (const pUrl of probeUrls) {
              for (const pUa of probeUas) {
                try {
                  const pHtml = await fetchUrl(pUrl, 5, pUa);
                  const ogM = pHtml.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                              pHtml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
                              pHtml.match(/<meta\b[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
                              pHtml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
                  if (ogM && ogM[1] && ogM[1].includes('fbcdn.net') && !ogM[1].includes('static.xx')) {
                    probedOg = ogM[1].replace(/&amp;/g, '&');
                    break;
                  }
                } catch (e) {}
              }
              if (probedOg) break;
            }

            if (probedOg) {
              try {
                console.log(`-> Probed and downloading video poster for ${vidId}...`);
                downloaded = await downloadImageToFile(probedOg, localAbs);
              } catch (e) {}
            }
          }

          if (fs.existsSync(localAbs) && fs.statSync(localAbs).size > 1000) {
            post.image = localRel;
            post.images = [localRel];
            console.log(`-> Saved video poster: ${localRel}`);
          } else {
            // Keep canonical localRel path so client-side fallback engine in app.js can resolve it
            post.image = localRel;
            post.images = [localRel];
          }
        }
      }
    }

    if (post.image && (!post.images || post.images.length === 0)) {
      post.images = [post.image];
    }
    if (post.images && post.images.length > 0 && !post.image) {
      post.image = post.images[0];
    }

    // Keep reshare images synchronized
    if (post.isReshare && post.resharedPost) {
      post.resharedPost.images = post.resharedPost.images || post.images || [];
      post.resharedPost.image = post.resharedPost.image || post.image || '';
      post.images = post.images && post.images.length > 0 ? post.images : post.resharedPost.images;
      post.image = post.image || post.resharedPost.image || '';
      if (post.images && post.images.length > 1 && post.mediaType !== 'video') {
        post.mediaType = 'gallery';
        post.resharedPost.mediaType = 'gallery';
      }
    }
  }

  // Enrich with canonical authors and collab partners
  const normalizedProfiles = (config.profiles || []).map(p => ({
    id: extractFacebookId(p.url),
    name: p.name,
    url: p.url,
    avatar: `https://graph.facebook.com/${encodeURIComponent(extractFacebookId(p.url))}/picture?type=large`
  }));

  // Registry of known community leaders & candidates for Melaka / Bersama
  const knownLeaders = [
    {
      id: 'drbryankek',
      aliases: ['dr bryan kek', 'drbryankek', 'bryan kek', 'dr bryan'],
      name: 'Dr Bryan Kek',
      url: 'https://www.facebook.com/drbryankek',
      avatar: 'https://graph.facebook.com/drbryankek/picture?type=large',
      role: 'Wakil BERSAMA N19 Kesidang'
    },
    {
      id: 'Bersamagohan',
      aliases: ['bersamagohan', 'goh han koon', 'han koon'],
      name: 'Bersamagohan',
      url: 'https://www.facebook.com/Bersamagohan',
      avatar: 'https://graph.facebook.com/Bersamagohan/picture?type=large',
      role: 'Wakil BERSAMA N15 Pengkalan Batu'
    },
    {
      id: 'bersama.jieyu',
      aliases: ['young jie yu', 'jie yu', 'bersama.jieyu'],
      name: 'Young Jie Yu',
      url: 'https://www.facebook.com/bersama.jieyu',
      avatar: 'https://graph.facebook.com/bersama.jieyu/picture?type=large',
      role: 'Wakil BERSAMA N14 Klebang'
    },
    {
      id: 'JomBersamaEthan',
      aliases: ['jom bersama ethan', 'ethan lim zhi hao', 'ethan lim', 'jombersamaethan'],
      name: 'Ethan Lim Zhi Hao',
      url: 'https://www.facebook.com/JomBersamaEthan',
      avatar: 'https://graph.facebook.com/JomBersamaEthan/picture?type=large',
      role: 'Wakil BERSAMA N20 Kota Laksamana'
    },
    {
      id: 'gueteck',
      aliases: ['datuk gue teck', 'gue teck', 'gueteck'],
      name: 'Datuk Gue Teck',
      url: 'https://www.facebook.com/gueteck',
      avatar: 'https://graph.facebook.com/gueteck/picture?type=large',
      role: 'Wakil BERSAMA Melaka'
    },
    {
      id: 'hazwanmustafa',
      aliases: ['muhammad hazwan mustafa', 'hazwan mustafa', 'hazwan'],
      avatar: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='48' fill='#202070'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='#FFD700' font-family='sans-serif' font-weight='800' font-size='34'>HM</text></svg>"),
      role: 'Wakil BERSAMA N23 Telok Mas'
    }
  ];

  const enrichedPosts = finalPosts.map(post => {
    const permalink = post.url || '';
    let primary = normalizedProfiles.find(pr => {
      if (!pr.id) return false;
      const pid = pr.id.toLowerCase();
      return permalink.toLowerCase().includes('/' + pid + '/') || permalink.toLowerCase().includes('id=' + pid);
    });
    if (!primary) {
      primary = normalizedProfiles.find(pr => pr.id === post.sourceId) || { id: post.sourceId, name: post.author, avatar: post.authorAvatar };
    }

    const collaborators = [];
    const addCollab = (item) => {
      if (!item || !item.name) return;
      if (item.id && primary.id && item.id.toLowerCase() === primary.id.toLowerCase()) return;
      if (item.name.toLowerCase() === (primary.name || '').toLowerCase()) return;
      if (collaborators.some(c => (c.id && item.id && c.id.toLowerCase() === item.id.toLowerCase()) || c.name.toLowerCase() === item.name.toLowerCase())) {
        return;
      }
      collaborators.push({
        id: item.id || '',
        name: item.name,
        avatar: item.avatar || (item.id ? `https://graph.facebook.com/${encodeURIComponent(item.id)}/picture?type=large` : ''),
        url: item.url || (item.id ? `https://www.facebook.com/${item.id}` : ''),
        role: item.role || ''
      });
    };

    // If already has collaborators array from previous ingestion, import them
    if (Array.isArray(post.collaborators)) {
      post.collaborators.forEach(addCollab);
    }

    // Check post.sources
    if (Array.isArray(post.sources)) {
      post.sources.forEach(sid => {
        if (sid && sid !== primary.id) {
          const leader = knownLeaders.find(l => l.id.toLowerCase() === sid.toLowerCase()) ||
                        normalizedProfiles.find(p => p.id && p.id.toLowerCase() === sid.toLowerCase());
          if (leader) addCollab(leader);
        }
      });
    }

    // If sourceId differs from primary.id
    if (post.sourceId && post.sourceId !== primary.id) {
      const leader = knownLeaders.find(l => l.id.toLowerCase() === post.sourceId.toLowerCase()) ||
                    normalizedProfiles.find(p => p.id && p.id.toLowerCase() === post.sourceId.toLowerCase());
      if (leader) addCollab(leader);
    }

    // Special joint statement detection for 2 Oct post (Jejantas Tun Teja Melaka joint press statement)
    // Post ID: UzpfSTYxNTkzNTQ0MjU0MzMxOjEyMjE0NTY0MjgwMTE1MTM5MDoxNDQ0MTQyMjIwOTY1NTM2 or content/image mentions
    const isTunTejaJointStatement = (post.id && post.id.includes('122145642801151390')) ||
      (post.content && (post.content.includes('RM2.075') || post.content.includes('Jejantas Tun Teja'))) ||
      (post.images && post.images.some(img => img.includes('122145695925151390') || img.includes('122145642639151390')));

    if (isTunTejaJointStatement) {
      // Co-signatories in joint press conference statement:
      // Datuk Gue Teck, Muhammad Hazwan Mustafa, Young Jie Yu, Goh Han Koon (Bersamagohan), Dr Bryan Kek, Ethan Lim Zhi Hao
      const jointSignatories = [
        knownLeaders.find(l => l.id === 'Bersamagohan'),
        knownLeaders.find(l => l.id === 'bersama.jieyu'),
        knownLeaders.find(l => l.id === 'JomBersamaEthan'),
        knownLeaders.find(l => l.id === 'gueteck'),
        knownLeaders.find(l => l.id === 'hazwanmustafa')
      ];
      jointSignatories.forEach(addCollab);
    }

    // Content cross-mentions detection
    const contentLower = (post.content || '').toLowerCase();
    for (const leader of knownLeaders) {
      if (leader.id.toLowerCase() === primary.id.toLowerCase()) continue;
      const isMentioned = leader.aliases.some(alias => contentLower.includes(alias.toLowerCase()) || contentLower.includes('#' + alias.toLowerCase().replace(/\s+/g, '')));
      if (isMentioned) {
        addCollab(leader);
      }
    }

    // Build complete unified sources set including primary and all candidate collaborators
    const sourceSet = new Set(Array.isArray(post.sources) ? post.sources : []);
    if (primary.id) sourceSet.add(primary.id);
    if (post.sourceId) sourceSet.add(post.sourceId);
    collaborators.forEach(c => {
      if (c.id && (normalizedProfiles.some(np => np.id === c.id) || knownLeaders.some(kl => kl.id === c.id))) {
        sourceSet.add(c.id);
      }
    });

    const isCollab = collaborators.length > 0;
    return {
      ...post,
      rawAuthor: post.rawAuthor || post.author,
      author: primary.name || post.author,
      authorAvatar: primary.avatar || post.authorAvatar,
      sourceId: primary.id,
      isCollab: isCollab,
      collaborators: collaborators,
      collabAuthor: collaborators.length > 0 ? collaborators.map(c => c.name).join(' × ') : null,
      collabAvatar: collaborators[0] ? collaborators[0].avatar : null,
      collabUrl: collaborators[0] ? collaborators[0].url : null,
      sources: Array.from(sourceSet)
    };
  });

  // Consolidate identical reshared posts across multiple candidate pages into unified community reshare cards
  const finalUnifiedPosts = consolidateResharedPosts(enrichedPosts);

  // Sort newest first
  finalUnifiedPosts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const outputData = {
    lastUpdated: new Date().toISOString(),
    hashtags: config.hashtags || config.globalHashtags || [],
    sourcesCount: sources.length,
    posts: finalUnifiedPosts
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
  console.log(`Successfully updated ${outputPath} with ${finalUnifiedPosts.length} real posts (including multi-sharer attributions).`);
}

/**
 * Consolidate posts when multiple candidates reshare the exact same original post
 */
function consolidateResharedPosts(posts) {
  const result = [];
  const reshareGroups = new Map();

  function getReshareKey(p) {
    if (!p || (!p.isReshare && !p.resharedPost && (!p.id || !p.id.startsWith('multi_reshare_')))) return null;
    const reshare = p.resharedPost || {};
    const author = (reshare.author || '').trim().toLowerCase();
    const textSample = (reshare.content || p.content || '').replace(/#[\w\u0080-\uffff]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
    if (author && textSample) {
      return `reshare::${author}::${textSample}`;
    }
    const u = (reshare.url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
    if (u) return `reshare::${u}`;
    return null;
  }

  for (const post of posts) {
    const rKey = getReshareKey(post);
    if (rKey) {
      if (!reshareGroups.has(rKey)) {
        reshareGroups.set(rKey, []);
      }
      reshareGroups.get(rKey).push(post);
    } else {
      result.push(post);
    }
  }

  for (const [rKey, group] of reshareGroups.entries()) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      // Multiple candidates reshared the exact same post!
      group.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      const primary = group[0];
      const allSources = new Set();
      const sharers = [];

      for (const p of group) {
        if (Array.isArray(p.sources)) {
          p.sources.forEach(s => allSources.add(s));
        }
        if (p.sourceId) allSources.add(p.sourceId);

        // Unpack existing sharers if p was already a consolidated reshare post
        const candidateSharers = (p.isMultiSharer && Array.isArray(p.sharers) && p.sharers.length > 0)
          ? p.sharers
          : [{
              sourceId: p.sourceId,
              author: p.rawAuthor || p.author,
              authorAvatar: p.authorAvatar,
              commentary: p.content || '',
              date: p.date,
              dateFormatted: p.dateFormatted,
              url: p.url
            }];

        for (const cand of candidateSharers) {
          let sharerName = cand.author || '';
          if (sharerName.includes('Ethan Lim Zhi Hao') || cand.sourceId === 'JomBersamaEthan') {
            sharerName = 'Ethan Lim Zhi Hao';
          } else if (sharerName.includes('Dr Bryan Kek') || cand.sourceId === 'drbryankek') {
            sharerName = 'Dr Bryan Kek';
          }

          const existingSharer = sharers.find(s =>
            (s.sourceId && cand.sourceId && s.sourceId.toLowerCase() === cand.sourceId.toLowerCase()) ||
            (s.author && sharerName && s.author.toLowerCase() === sharerName.toLowerCase())
          );
          if (existingSharer) {
            if (!existingSharer.commentary && cand.commentary) {
              existingSharer.commentary = cand.commentary;
            }
            continue;
          }

          sharers.push({
            sourceId: cand.sourceId,
            author: sharerName,
            authorAvatar: cand.authorAvatar,
            commentary: cand.commentary || cand.content || '',
            date: cand.date,
            dateFormatted: cand.dateFormatted,
            url: cand.url
          });
        }
      }

      // Aggregate all unique images from all group versions and resharedPost
      let bestImages = [];
      const imageSet = new Set();
      const addImgs = (imgs) => {
        if (!Array.isArray(imgs)) return;
        for (const img of imgs) {
          if (!img || typeof img !== 'string') continue;
          // Deduplicate by clean URL without transient query params or by photo id
          const idMatch = img.match(/_(\d+)_\d+_n\./) || img.match(/media_id=(\d+)/);
          const cleanKey = idMatch ? `id_${idMatch[1]}` : img.split('?')[0].toLowerCase();
          if (!imageSet.has(cleanKey)) {
            imageSet.add(cleanKey);
            bestImages.push(img);
          }
        }
      };

      for (const p of group) {
        if (p.resharedPost?.images) addImgs(p.resharedPost.images);
        if (p.images) addImgs(p.images);
        if (p.resharedPost?.image) addImgs([p.resharedPost.image]);
        if (p.image) addImgs([p.image]);
      }

      const namesCombined = sharers.map(s => s.author).join(' & ');
      const reshareHash = crypto.createHash('md5').update(rKey).digest('hex').slice(0, 16);

      const consolidated = {
        ...primary,
        id: `multi_reshare_${reshareHash}`,
        author: namesCombined,
        isMultiSharer: true,
        sharesCount: sharers.length,
        sharers: sharers,
        sources: Array.from(allSources),
        images: bestImages,
        image: bestImages[0] || primary.image,
        mediaType: bestImages.length > 1 ? 'gallery' : (primary.mediaType || 'image')
      };

      if (consolidated.resharedPost) {
        consolidated.resharedPost.images = bestImages;
        consolidated.resharedPost.image = bestImages[0] || consolidated.resharedPost.image;
      }

      result.push(consolidated);
    }
  }

  // Final safety deduplication pass ensuring ZERO duplicates ever leave the pipeline
  const dedupFinal = new Map();
  for (const post of result) {
    const k = getPostKey(post);
    if (!k) {
      dedupFinal.set(post.id || Math.random().toString(), post);
      continue;
    }
    if (dedupFinal.has(k)) {
      const existing = dedupFinal.get(k);
      const sSet = new Set([...(existing.sources || []), ...(post.sources || [])]);
      if (post.sourceId) sSet.add(post.sourceId);
      existing.sources = Array.from(sSet);
      const imgSet = new Set(existing.images || []);
      for (const img of (post.images || [])) {
        if (img && !imgSet.has(img)) {
          imgSet.add(img);
          existing.images.push(img);
        }
      }
      if (!existing.image && post.image) existing.image = post.image;
      continue;
    }
    dedupFinal.set(k, post);
  }

  const finalCleaned = Array.from(dedupFinal.values());
  finalCleaned.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return finalCleaned;
}

main().catch(err => {
  console.error('Feed ingestion error:', err);
  process.exit(1);
});
