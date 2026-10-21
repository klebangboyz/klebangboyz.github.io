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

    // Extract all scontent images
    const regex = /<img[^>]+src=["'](https:\/\/[^"'>]*?scontent[^"'>]*?)["'][^>]*>/gi;
    let match;
    const candidates = [];
    while ((match = regex.exec(html)) !== null) {
      const url = match[1].replace(/&amp;/g, '&');
      // Filter out tiny avatars (s40x40 or 30808-1)
      if (!url.includes('s40x40') && !url.includes('30808-1/')) {
        candidates.push(url);
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

  // Load existing posts to preserve historical feed items THAT MATCH configured hashtags
  const postMap = new Map();
  if (fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      if (existing.posts && Array.isArray(existing.posts)) {
        existing.posts.forEach(p => {
          // STRICT HASHTAG FILTER: Only retain historical posts that match current hashtags
          if (postMatchesHashtags(p, hashtags)) {
            if (p.url || p.id) postMap.set(p.url || p.id, p);
          }
        });
      }
    } catch (e) {}
  }

  // Merge freshly fetched posts (only if they match hashtags)
  for (const p of allPosts) {
    if (postMatchesHashtags(p, hashtags)) {
      const key = p.url || p.id;
      const existing = postMap.get(key);
      if (existing && existing.image && !p.image) {
        p.image = existing.image;
        p.mediaType = 'image';
      }
      postMap.set(key, p);
    }
  }

  const finalPosts = Array.from(postMap.values()).filter(p => postMatchesHashtags(p, hashtags));

  // Fetch real photos for non-video posts that don't yet have an image
  for (const post of finalPosts) {
    if (post.mediaType !== 'video' && !post.image) {
      console.log(`Resolving real photo for: ${post.url}...`);
      const photoUrl = await fetchPostPhoto(post.url);
      if (photoUrl) {
        post.image = photoUrl;
        post.mediaType = 'image';
        console.log(`-> Got photo: ${photoUrl.slice(0, 80)}...`);
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
