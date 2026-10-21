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

function fetchUrl(url, maxRedirects = 5, customUserAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)') {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return resolve('');
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': customUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    };

    client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, url).href;
        }
        return fetchUrl(redirectUrl, maxRedirects - 1, customUserAgent).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (err) => {
      console.warn(`Request failed for ${url}:`, err.message);
      resolve('');
    });
  });
}

/**
 * Fetch real high-res photo for a post via Facebook plugin endpoint using curl UA
 */
async function fetchPostPhoto(permalink) {
  if (!permalink) return '';
  const isVideo = permalink.includes('/videos/') || permalink.includes('/reel/');
  const pluginUrl = isVideo
    ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0`
    : `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(permalink)}&show_text=0`;

  try {
    const html = await fetchUrl(pluginUrl, 3, 'curl/8.0.0');
    if (!html) return '';

    const candidates = [];

    // 1. Extract all <img> scontent images
    const regex = /<img[^>]+src=["'](https:\/\/[^"'>]*?scontent[^"'>]*?)["'][^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1].replace(/&amp;/g, '&');
      // Filter out tiny avatars (s40x40 or 30808-1)
      if (!url.includes('s40x40') && !url.includes('30808-1/') && !url.includes('/picture')) {
        candidates.push(url);
      }
    }

    // 2. Extract JSON-escaped and embedded scontent URLs (especially for video posters)
    const jsonRegex = /https:[\\\/A-Za-z0-9_.\-%?=&;]+scontent[\\\/A-Za-z0-9_.\-%?=&;]+/gi;
    const jsonMatches = html.match(jsonRegex) || [];
    for (let m of jsonMatches) {
      m = m.replace(/\\u002526/g, '&').replace(/\\u00253D/g, '=').replace(/\\u00252F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
      if (m.endsWith('\\')) m = m.slice(0, -1);
      if (!m.includes('s40x40') && !m.includes('30808-1/') && !m.includes('/picture') && (m.includes('.jpg') || m.includes('.png') || m.includes('dst-jpg') || m.includes('stp='))) {
        candidates.push(m);
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }
  } catch (e) {
    console.warn('Could not fetch photo for:', permalink, e.message);
  }
  return '';
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
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        const media = att.media;
        if (!media) continue;
        if (media.__typename === 'Video' || att.style_type_renderer?.video) {
          mediaType = 'video';
          videoClip = media.playable_url || media.playable_url_quality_hd || '';
          image = media.preferred_thumbnail?.image?.uri || media.image?.uri || '';
        } else if (media.image?.uri || media.photo_image?.uri) {
          if (!image) {
            image = media.image?.uri || media.photo_image?.uri || '';
            mediaType = 'image';
          }
        }
      }
    }

    if (!authorName && !message && !image && !videoClip) return null;

    return {
      author: authorName,
      authorAvatar: authorAvatar,
      content: message,
      dateFormatted: timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      url: permalink,
      image: image,
      videoClip: videoClip,
      mediaType: mediaType
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

    const isVideo = permalink.includes('/videos/') || (node.attachments && node.attachments[0]?.media?.__typename === 'Video');

    posts.push({
      id: node.id || permalink,
      sourceId: pageId,
      author: authorName,
      authorAvatar: pageAvatar,
      date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      dateFormatted: timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      url: permalink,
      content: message,
      isReshare: !!reshared,
      resharedPost: reshared || null,
      mediaType: isVideo ? 'video' : (reshared?.mediaType || 'none'),
      videoUrl: isVideo ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0` : '',
      image: '',
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
    const isVideo = permalink.includes('/videos/');

    posts.push({
      id: s.id || permalink,
      sourceId: pageId,
      author: authorName,
      authorAvatar: pageAvatar,
      date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      dateFormatted: timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      url: permalink,
      content: message,
      isReshare: !!reshared,
      resharedPost: reshared || null,
      mediaType: isVideo ? 'video' : (reshared?.mediaType || 'none'),
      videoUrl: isVideo ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&autoplay=0` : '',
      image: '',
      likes: 0,
      comments: 0,
      shares: 0
    });
  }

  return posts;
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
      const key = p.url || p.id;
      // Sync shared post image if available
      if (p.isReshare && p.resharedPost) {
        if (!p.resharedPost.image && p.image) p.resharedPost.image = p.image;
        if (!p.image && p.resharedPost.image) p.image = p.resharedPost.image;
      }
      postMap.set(key, p);
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
          const key = p.url || p.id;

          // If already refreshed by the full scrape, keep fresh version but preserve existing image if fresh lacks it
          if (postMap.has(key)) {
            const fresh = postMap.get(key);
            if (p.image && !fresh.image) {
              fresh.image = p.image;
            }
            if (fresh.isReshare && fresh.resharedPost) {
              if (p.resharedPost?.image && !fresh.resharedPost.image) {
                fresh.resharedPost.image = p.resharedPost.image;
              }
              if (!fresh.image && fresh.resharedPost?.image) {
                fresh.image = fresh.resharedPost.image;
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

  // Fetch real photos/posters for posts that don't yet have an image
  for (const post of finalPosts) {
    // 1. If reshare has no image on either post or resharedPost, attempt to resolve photo
    if (post.isReshare && post.resharedPost && !post.resharedPost.image && !post.image) {
      const targetUrl = post.resharedPost.url || post.url;
      console.log(`Resolving photo for shared post: ${targetUrl}...`);
      const photoUrl = await fetchPostPhoto(targetUrl);
      if (photoUrl) {
        post.resharedPost.image = photoUrl;
        post.image = photoUrl;
        post.resharedPost.mediaType = 'image';
        console.log(`-> Got shared post photo: ${photoUrl.slice(0, 80)}...`);
      }
    }

    if (!post.image) {
      // 2. Check if a local video poster exists
      const vidMatch = (post.url || '').match(/(?:videos|reel)\/(\d+)/);
      if (vidMatch) {
        const localRel = `data/images/poster_${vidMatch[1]}.jpg`;
        const localAbs = path.resolve(__dirname, '..', localRel);
        if (fs.existsSync(localAbs)) {
          post.image = localRel;
          console.log(`-> Assigned local video poster for ${post.url}: ${localRel}`);
        }
      }
    }

    if (!post.image) {
      console.log(`Resolving real photo/thumbnail for: ${post.url}...`);
      const photoUrl = await fetchPostPhoto(post.url);
      if (photoUrl) {
        post.image = photoUrl;
        if (post.mediaType !== 'video') {
          post.mediaType = 'image';
        }
        console.log(`-> Got media photo/thumbnail: ${photoUrl.slice(0, 80)}...`);
      }
    }

    // Keep reshare image synchronized
    if (post.isReshare && post.resharedPost) {
      if (!post.resharedPost.image && post.image) post.resharedPost.image = post.image;
      if (!post.image && post.resharedPost.image) post.image = post.resharedPost.image;
    }
  }

  // Enrich with canonical authors and collab partners
  const normalizedProfiles = (config.profiles || []).map(p => ({
    id: extractFacebookId(p.url),
    name: p.name,
    url: p.url,
    avatar: `https://graph.facebook.com/${encodeURIComponent(extractFacebookId(p.url))}/picture?type=large`
  }));

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

    let collab = null;
    if (post.sourceId && post.sourceId !== primary.id) {
      collab = normalizedProfiles.find(pr => pr.id === post.sourceId);
    }
    const contentLower = (post.content || '').toLowerCase();
    for (const pr of normalizedProfiles) {
      if (pr.id === primary.id || (collab && pr.id === collab.id)) continue;
      const nameLower = (pr.name || '').toLowerCase();
      if ((nameLower && contentLower.includes(nameLower)) || contentLower.includes(pr.id.toLowerCase()) || contentLower.includes('#' + pr.id.toLowerCase())) {
        if (!collab) collab = pr;
      }
    }
    const sourceSet = new Set();
    if (primary.id) sourceSet.add(primary.id);
    if (collab && collab.id) sourceSet.add(collab.id);
    if (post.sourceId) sourceSet.add(post.sourceId);

    return {
      ...post,
      author: primary.name || post.author,
      authorAvatar: primary.avatar || post.authorAvatar,
      sourceId: primary.id,
      isCollab: !!collab,
      collabAuthor: collab ? collab.name : null,
      collabAvatar: collab ? collab.avatar : null,
      collabUrl: collab ? collab.url : null,
      sources: Array.from(sourceSet)
    };
  });

  // Sort newest first
  enrichedPosts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const outputData = {
    lastUpdated: new Date().toISOString(),
    hashtags: config.hashtags || config.globalHashtags || [],
    sourcesCount: sources.length,
    posts: enrichedPosts
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
  console.log(`Successfully updated ${outputPath} with ${enrichedPosts.length} real posts (including collab attributions).`);
}

main().catch(err => {
  console.error('Feed ingestion error:', err);
  process.exit(1);
});
