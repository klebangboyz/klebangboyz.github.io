/**
 * KLEBANG BOYZ SPACE - Pure Multi-Source RSS Ingestion Engine
 * 
 * - Ingests real Facebook RSS feeds from configured URLs
 * - Zero placeholders / zero mock posts
 * - Strictly filters for global hashtags
 * - Supports trilingual interface (EN, 中文, BM)
 */

let appConfig = null;
let i18nData = null;
let currentLang = 'en';
let allFeedPosts = [];
let activeSourceFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await loadConfig();
  await loadTranslations();
  setupLanguage();
  applyDynamicBindings();
  translateDOM();
  await loadSocialFeed();
  setupInteractions();
}

/**
 * 1. Extract Facebook Identifier from URL
 */
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

/**
 * 2. Load Configuration
 */
async function loadConfig() {
  try {
    // Cache-busting timestamp and no-store headers ensure changes committed in GitHub reflect immediately
    const res = await fetch(`config.json?v=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (res.ok) {
      appConfig = await res.json();
    } else {
      throw new Error('Could not fetch config.json');
    }
  } catch (e) {
    console.warn('Could not load config.json, using default configuration:', e);
    appConfig = {
      siteName: "Suara Bersama (Edisi Klebang Boyz)",
      profiles: [
        { name: "Dr Bryan Kek", url: "https://www.facebook.com/drbryankek" },
        { name: "Jom Bersama Ethan", url: "https://www.facebook.com/JomBersamaEthan" },
        { name: "Young Jie Yu", url: "https://www.facebook.com/profile.php?id=61592803485635", avatar: "assets/jieyu_avatar.jpg" },
        { name: "Bersamagohan", url: "https://www.facebook.com/Bersamagohan" }
      ],
      hashtags: ["#feed", "#JomBersamaEthan", "#klebang"]
    };
  }
}

/**
 * 3. Load Master Translations (data/i18n.json)
 */
async function loadTranslations() {
  try {
    const res = await fetch(`data/i18n.json?v=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (res.ok) {
      i18nData = await res.json();
    } else {
      throw new Error('Could not load data/i18n.json');
    }
  } catch (e) {
    console.warn('Could not load data/i18n.json:', e);
    i18nData = {};
  }
}

/**
 * 4. Language Management
 */
function setupLanguage() {
  const savedLang = localStorage.getItem('klebang_lang');
  const configuredDefault = appConfig?.site?.defaultLanguage || 'en';
  currentLang = savedLang || configuredDefault;

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
    btn.addEventListener('click', (e) => {
      const selected = e.target.getAttribute('data-lang');
      if (selected && selected !== currentLang) {
        setLanguage(selected);
      }
    });
  });

  document.documentElement.setAttribute('lang', currentLang);
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('klebang_lang', lang);
  document.documentElement.setAttribute('lang', lang);

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
  });

  translateDOM();
  renderFeedPosts(filterPosts());
  updateFeedStatusBadge();
}

function t(keyPath, defaultText = '') {
  if (!i18nData) return defaultText;

  const parts = keyPath.split('.');
  let curr = i18nData;
  for (const part of parts) {
    if (curr && curr[part] !== undefined) {
      curr = curr[part];
    } else {
      return defaultText;
    }
  }

  let text = '';
  if (typeof curr === 'object' && curr !== null) {
    text = curr[currentLang] || curr['en'] || defaultText;
  } else if (typeof curr === 'string') {
    text = curr;
  } else {
    text = defaultText;
  }

  const tags = getConfigHashtags();
  const hashtags = tags.join(' ');
  const domain = appConfig?.domain || appConfig?.site?.domain || 'klebang.boyz.space';
  const siteName = appConfig?.siteName || appConfig?.site?.name || 'KLEBANG BOYZ SPACE';

  return text
    .replace(/{hashtags}/g, hashtags)
    .replace(/{hashtag}/g, tags[0] || '')
    .replace(/{domain}/g, domain)
    .replace(/{site}/g, siteName);
}

function translateDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = t(key, el.innerHTML);
  });

  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    const [attr, key] = spec.split(':');
    if (attr && key) {
      el.setAttribute(attr, t(key, el.getAttribute(attr) || ''));
    }
  });
}

/**
 * Helpers to read cleaned configuration (supporting both new simple format and legacy format)
 */
function getConfigProfiles() {
  if (!appConfig) return [];
  const raw = appConfig.profiles || appConfig.facebookSources || [];
  return raw.map(item => {
    if (typeof item === 'string') {
      const pageId = extractFacebookId(item);
      return {
        id: pageId,
        name: pageId,
        url: item.startsWith('http') ? item : `https://www.facebook.com/${pageId}`,
        avatar: `https://graph.facebook.com/${encodeURIComponent(pageId)}/picture?type=large`
      };
    }
    const pageId = item.id || extractFacebookId(item.url || '');
    return {
      id: pageId,
      name: item.name || pageId,
      url: item.url || `https://www.facebook.com/${pageId}`,
      avatar: item.avatar || `https://graph.facebook.com/${encodeURIComponent(pageId)}/picture?type=large`
    };
  });
}

function getConfigHashtags() {
  if (!appConfig) return [];
  const tags = appConfig.hashtags || appConfig.globalHashtags || [];
  return tags.map(t => t.trim());
}

/**
 * 5. Dynamic Data Bindings
 */
function applyDynamicBindings() {
  if (!appConfig) return;

  const siteName = appConfig.siteName || appConfig.site?.name || 'Suara Bersama (Edisi Klebang Boyz)';
  const domain = appConfig.domain || appConfig.site?.domain || 'klebang.boyz.space';
  const hashtags = getConfigHashtags();
  const hashtagsStr = hashtags.join(' ');
  const profiles = getConfigProfiles();

  document.querySelectorAll('[data-bind="site-name"]').forEach(el => {
    el.textContent = siteName;
  });

  document.querySelectorAll('[data-bind="domain"]').forEach(el => {
    el.textContent = domain;
  });

  document.querySelectorAll('[data-bind="hashtags"]').forEach(el => {
    el.textContent = hashtagsStr;
  });

  // Render Source Profiles Chips (Telling exactly which profiles we pull from!)
  const profilesContainer = document.getElementById('active-profiles-chips');
  if (profilesContainer) {
    profilesContainer.innerHTML = profiles.map(p => `
      <a href="${p.url}" target="_blank" rel="noopener noreferrer" class="profile-chip" title="View ${p.name} on Facebook">
        <img src="${p.avatar}" alt="${p.name}" class="profile-chip-avatar" onerror="this.style.display='none';" />
        <span>${p.name}</span>
      </a>
    `).join('');
  }

  // Render Active Hashtags Chips
  const tagsContainer = document.getElementById('active-hashtags-chips');
  if (tagsContainer) {
    tagsContainer.innerHTML = hashtags.map(tag => `
      <span class="badge badge-yellow">${tag}</span>
    `).join('');
  }
}

/**
 * 6. Social Feed Ingestion (Strictly Client-Sided RSSHub + Real Data Fallback)
 */
async function loadSocialFeed() {
  const feedContainer = document.getElementById('facebook-feed-grid');
  if (!feedContainer) return;

  const hashtags = getConfigHashtags().map(h => h.toLowerCase().trim());
  const hashtagsStr = hashtags.join(' ');
  const profiles = getConfigProfiles();

  feedContainer.innerHTML = `
    <div style="text-align: center; padding: 4rem 1rem;">
      <div class="live-pulse" style="width: 14px; height: 14px; margin-bottom: 1rem;"></div>
      <p style="font-family: var(--font-cabinet); font-weight: 700; color: var(--primary-blue);">
        ${t('feed.checkingFeed', `Syncing feed for ${hashtagsStr}...`)}
      </p>
    </div>
  `;

  let combinedPosts = [];
  let isLive = false;
  const updateFeedUI = () => {
    // STRICT GLOBAL HASHTAG FILTERING
    const strictlyFiltered = combinedPosts.filter(post => {
      if (hashtags.length === 0) return true;
      const combinedBody = ((post.content || '') + ' ' + (post.resharedPost?.content || '')).toLowerCase();
      const tags = Array.isArray(post.hashtags) ? post.hashtags.map(t => t.toLowerCase()) : [];
      if (post.resharedPost && Array.isArray(post.resharedPost.hashtags)) {
        tags.push(...post.resharedPost.hashtags.map(t => t.toLowerCase()));
      }
      return hashtags.some(ht => {
        const clean = ht.replace(/^#/, '');
        return combinedBody.includes(ht) || combinedBody.includes(clean) || tags.some(t => t.includes(clean));
      });
    });

    // Sort strictly newest first
    strictlyFiltered.sort((a, b) => getPostTimestamp(b) - getPostTimestamp(a));

    allFeedPosts = strictlyFiltered;
    renderSourceFilters(profiles, strictlyFiltered);
    renderFeedPosts(filterPosts());
    updateFeedStatusBadge(isLive);
  };

  // Step 1: Immediately render verified real posts from data/feed.json (0ms perceived wait)
  try {
    const res = await fetch('data/feed.json?t=' + Date.now());
    if (res.ok) {
      const json = await res.json();
      if (json.posts && Array.isArray(json.posts)) {
        combinedPosts = json.posts.map(p => enrichPostWithCollabData(p, profiles));
        updateFeedUI();
      }
    }
  } catch (e) {
    console.warn('data/feed.json fallback error:', e);
  }

  // Step 2: Strictly Client-Sided RSSHub Ingestion (updates live posts seamlessly)
  fetchRssHubClientSide(appConfig).then(rsshubPosts => {
    if (rsshubPosts && rsshubPosts.length > 0) {
      const existingIds = new Set(combinedPosts.map(p => p.id || p.url));
      const newPosts = rsshubPosts.filter(p => !existingIds.has(p.id) && !existingIds.has(p.url));
      if (newPosts.length > 0) {
        combinedPosts.unshift(...newPosts.map(p => enrichPostWithCollabData(p, profiles)));
        isLive = true;
        updateFeedUI();
      }
    }
  }).catch(rssErr => {
    console.warn('Client-side RSSHub fetch info:', rssErr);
  });
}

/**
 * Pure Client-Sided RSSHub Fetcher
 * Dynamically queries RSSHub for each Facebook profile directly in the browser
 */
async function fetchRssHubClientSide(config) {
  const primaryInstance = typeof config.rsshubInstance === 'string' ? config.rsshubInstance : 'https://rsshub.app';
  const instances = [primaryInstance, 'https://rsshub.rssforever.com'].filter(Boolean);

  const profiles = getConfigProfiles();
  const fetchedPosts = [];

  for (const prof of profiles) {
    const pageId = prof.id;
    if (!pageId) continue;

    const routePath = `/facebook/page/${encodeURIComponent(pageId)}`;
    let success = false;

    for (const inst of instances) {
      if (success) break;
      const base = inst.replace(/\/+$/, '');
      const jsonEndpoint = `${base}${routePath}.json`;

      // 1. Try direct fetch
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(jsonEndpoint, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          const items = parseRssHubData(data, prof);
          if (items.length > 0) {
            fetchedPosts.push(...items);
            success = true;
            break;
          }
        }
      } catch (err) {
        // Direct fetch failed or CORS restricted, try transparent client-side CORS proxy
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(jsonEndpoint)}`;
          const pCtrl = new AbortController();
          const pTimer = setTimeout(() => pCtrl.abort(), 3500);
          const pRes = await fetch(proxyUrl, { signal: pCtrl.signal });
          clearTimeout(pTimer);
          if (pRes.ok) {
            const data = await pRes.json();
            const items = parseRssHubData(data, prof);
            if (items.length > 0) {
              fetchedPosts.push(...items);
              success = true;
              break;
            }
          }
        } catch (proxyErr) {}
      }
    }
  }

  return fetchedPosts;
}

/**
 * Parse RSSHub feed data into unified post model with full format preservation
 */
function parseRssHubData(data, profile) {
  if (!data || !Array.isArray(data.items)) return [];
  const authorName = profile.name || data.title || profile.id || 'Facebook';
  const authorAvatar = profile.avatar || `https://graph.facebook.com/${encodeURIComponent(profile.id)}/picture?type=large`;

  return data.items.map(item => {
    const rawDesc = item.description || item.content_html || '';
    const parsed = parsePostHtml(rawDesc);
    const postDate = item.pubDate || item.date_published || new Date().toISOString();

    return {
      id: item.id || item.guid || item.url || item.link,
      sourceId: profile.id,
      author: item.author?.name || authorName,
      authorAvatar: authorAvatar,
      date: postDate,
      dateFormatted: new Date(postDate).toLocaleDateString(getLocaleCode(), { day: 'numeric', month: 'short', year: 'numeric' }),
      url: item.url || item.link || profile.url,
      content: parsed.text || item.title || '',
      isReshare: parsed.isReshare,
      resharedPost: parsed.resharedPost,
      image: parsed.image || item.image || item.thumbnail || '',
      videoClip: parsed.videoClip || '',
      mediaType: parsed.videoClip ? 'video' : (parsed.image ? 'image' : 'text'),
      likes: 0,
      comments: 0,
      shares: 0
    };
  });
}

/**
 * Parse post HTML preserving exact paragraphs, linebreaks, images, and video clips
 */
function parsePostHtml(html) {
  if (!html) return { text: '', image: '', videoClip: '', isReshare: false, resharedPost: null };

  let isReshare = false;
  let resharedPost = null;

  // Detect embedded shared blockquote (standard pattern in Facebook/RSSHub shared items)
  let outerHtml = html;
  const bqMatch = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (bqMatch) {
    isReshare = true;
    const bqContent = bqMatch[1];
    outerHtml = html.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/i, '').trim();

    const bqImgMatch = bqContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    const bqVideoMatch = bqContent.match(/<video[^>]+src=["']([^"']+)["']/i) || bqContent.match(/<source[^>]+src=["']([^"']+)["']/i);
    const bqAuthorMatch = bqContent.match(/<b[^>]*>([^<]+)<\/b>/i) || bqContent.match(/<strong[^>]*>([^<]+)<\/strong>/i) || bqContent.match(/<a[^>]*>([^<]+)<\/a>/i);

    const bqText = bqContent
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    resharedPost = {
      author: bqAuthorMatch ? bqAuthorMatch[1].trim() : 'Facebook Post',
      content: bqText,
      image: bqImgMatch ? bqImgMatch[1] : '',
      videoClip: bqVideoMatch ? bqVideoMatch[1] : '',
      mediaType: bqVideoMatch ? 'video' : (bqImgMatch ? 'image' : 'text')
    };
  }

  // 1. Extract image
  let image = '';
  const imgMatch = outerHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) {
    image = imgMatch[1];
  }

  // 2. Extract video clip
  let videoClip = '';
  const videoMatch = outerHtml.match(/<video[^>]+src=["']([^"']+)["']/i) || outerHtml.match(/<source[^>]+src=["']([^"']+)["']/i);
  if (videoMatch) {
    videoClip = videoMatch[1];
  }

  // 3. Format text: preserve line breaks and paragraphs cleanly
  let text = outerHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, image, videoClip, isReshare, resharedPost };
}

/**
 * Resolves canonical author and collab partners for cross-posted / collaborative posts
 */
function enrichPostWithCollabData(post, profiles) {
  const permalink = post.url || '';
  
  // 1. Identify which configured profile owns the permalink (canonical owner)
  let primary = profiles.find(pr => {
    if (!pr.id && !pr.name) return false;
    const pid = (pr.id || '').toLowerCase();
    const nameMatch = post.author && pr.name && post.author.toLowerCase() === pr.name.toLowerCase();
    const urlMatch = pid && (permalink.toLowerCase().includes('/' + pid + '/') || permalink.toLowerCase().includes('id=' + pid));
    return nameMatch || urlMatch;
  });

  if (!primary) {
    primary = profiles.find(pr => pr.id === post.sourceId) || {
      id: post.sourceId,
      name: post.author || post.sourceId,
      avatar: post.authorAvatar
    };
  }

  // 2. Identify collaborating / cross-posted profile
  let collab = null;
  if (post.sourceId && post.sourceId !== primary.id) {
    collab = profiles.find(pr => pr.id === post.sourceId);
  }

  // Also inspect post content for cross-mentions of other monitored profiles
  const contentLower = (post.content || '').toLowerCase();
  for (const pr of profiles) {
    if (pr.id === primary.id || (collab && pr.id === collab.id)) continue;
    const nameLower = (pr.name || '').toLowerCase();
    if (
      (nameLower && contentLower.includes(nameLower)) ||
      contentLower.includes(pr.id.toLowerCase()) ||
      contentLower.includes('#' + pr.id.toLowerCase())
    ) {
      if (!collab) {
        collab = pr;
      }
    }
  }

  const sourceSet = new Set(Array.isArray(post.sources) ? post.sources : []);
  if (primary.id) sourceSet.add(primary.id);
  if (collab && collab.id) sourceSet.add(collab.id);
  if (post.sourceId) sourceSet.add(post.sourceId);

  return {
    ...post,
    author: primary.name || post.author,
    authorAvatar: primary.avatar || post.authorAvatar,
    sourceId: primary.id,
    isCollab: post.isCollab || !!collab,
    collabAuthor: post.collabAuthor || (collab ? collab.name : null),
    collabAvatar: post.collabAvatar || (collab ? collab.avatar : null),
    collabUrl: post.collabUrl || (collab ? collab.url : null),
    sources: Array.from(sourceSet)
  };
}

function getPostTimestamp(post) {
  if (!post) return 0;
  if (post.date) {
    const t = Date.parse(post.date);
    if (!isNaN(t)) return t;
  }
  if (post.dateFormatted) {
    const t = Date.parse(post.dateFormatted);
    if (!isNaN(t)) return t;
  }
  return 0;
}

function filterPosts() {
  let list = allFeedPosts;
  if (activeSourceFilter !== 'all') {
    list = list.filter(p => {
      if (Array.isArray(p.sources) && p.sources.includes(activeSourceFilter)) {
        return true;
      }
      return p.sourceId === activeSourceFilter || p.author === activeSourceFilter || p.collabAuthor === activeSourceFilter;
    });
  }
  return [...list].sort((a, b) => getPostTimestamp(b) - getPostTimestamp(a));
}

function renderSourceFilters(profiles, posts) {
  const container = document.getElementById('channel-filters-wrap');
  if (!container) return;

  const distinctSources = [];
  const seen = new Set();

  (profiles || []).forEach(p => {
    if (p.id && !seen.has(p.id)) {
      seen.add(p.id);
      distinctSources.push({ id: p.id, name: p.name, avatar: p.avatar });
    }
  });

  posts.forEach(p => {
    const key = p.sourceId || p.author;
    if (key && !seen.has(key)) {
      seen.add(key);
      distinctSources.push({ id: key, name: p.author || key, avatar: p.authorAvatar });
    }
  });

  if (distinctSources.length <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="channel-filters-inner" style="display: flex; gap: 0.38rem; align-items: center; flex-wrap: nowrap; overflow-x: auto; width: 100%; scrollbar-width: none;">
      <button type="button" class="channel-filter-btn active" data-src="all">${t('feed.allSources', 'All Channels')}</button>
      ${distinctSources.map(s => `
        <button type="button" class="channel-filter-btn" data-src="${s.id}">
          ${s.avatar ? `<img src="${s.avatar}" style="width: 18px; height: 18px; border-radius: 50%; object-fit: cover; display: inline-block; vertical-align: middle; margin-right: 5px;" onerror="this.style.display='none'" />` : ''}
          ${s.name}
        </button>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.channel-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.channel-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSourceFilter = btn.getAttribute('data-src');
      renderFeedPosts(filterPosts());
    });
  });
}

/**
 * 7. Render Posts Cards with Clean Formatting & Unclipped Media
 */
function renderFeedPosts(posts) {
  const feedContainer = document.getElementById('facebook-feed-grid');
  if (!feedContainer) return;

  const hashtags = getConfigHashtags();
  const hashtagsStr = hashtags.join(' ');
  const profiles = getConfigProfiles();
  const firstUrl = profiles[0]?.url || 'https://www.facebook.com';

  if (posts.length === 0) {
    feedContainer.innerHTML = `
      <div style="text-align: center; padding: 4rem 1.5rem; background: #fff; border-radius: 20px; border: 1.5px dashed var(--border-blue); box-shadow: var(--shadow-sm);">
        <div style="width: 60px; height: 60px; border-radius: 50%; background: var(--bg-warm); color: var(--primary-blue); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3 style="font-family: var(--font-cabinet); font-weight: 800; font-size: 1.35rem; color: var(--primary-blue); margin-bottom: 0.65rem;">
          ${t('feed.noPostsTitle', `No posts found matching global hashtags ${hashtagsStr}.`)}
        </h3>
        <p style="font-size: 0.95rem; color: var(--color-text-muted); max-width: 540px; margin: 0 auto 1.75rem; line-height: 1.6;">
          ${t('feed.noPostsHint', 'Ensure new posts on the configured channels include these hashtags to appear automatically.')}
        </p>
        <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
          <a href="${firstUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary-yellow">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Facebook &rarr;
          </a>
        </div>
      </div>
    `;
    return;
  }

  const viewOnFbText = t('feed.viewOnFacebook', 'View on FB');
  const commentsText = t('feed.comments', 'comments');

  feedContainer.innerHTML = posts.map(post => {
    const formattedContent = formatPostText(post.content, hashtags);
    const authorAvatar = post.authorAvatar || `https://graph.facebook.com/${encodeURIComponent(post.sourceId || '')}/picture?type=large`;
    const isVideo = post.mediaType === 'video' || (post.url && (post.url.includes('/videos/') || post.url.includes('/reel/')));
    const isCollab = post.isCollab && post.collabAuthor;

    const isReshare = !!(post.isReshare && post.resharedPost);
    const reshared = post.resharedPost || {};
    const reshareActionHtml = isReshare ? `
      <span class="reshare-action-badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"/>
        </svg>
        shared a post
      </span>
    ` : '';

    const authorHeaderHtml = isCollab ? `
      <div class="fb-author-wrap collab-author-wrap">
        <div class="collab-avatars-cluster">
          <img src="${authorAvatar}" alt="${post.author}" class="primary-avatar" onerror="this.onerror=null;this.src='https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico';" />
          <img src="${post.collabAvatar}" alt="${post.collabAuthor}" class="collab-avatar" onerror="this.onerror=null;this.src='https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico';" />
        </div>
        <div>
          <div class="fb-author-name collab-names">
            <span>${post.author}</span>
            <span class="collab-cross">×</span>
            <span>${post.collabAuthor}</span>
            <span class="collab-badge-pill">COLLAB</span>
            ${reshareActionHtml}
          </div>
          <time class="fb-post-date">${post.dateFormatted || ''} • Joint / Co-authored Update</time>
        </div>
      </div>
    ` : `
      <div class="fb-author-wrap">
        <img src="${authorAvatar}" alt="${post.author || 'Facebook'}" class="fb-author-avatar" loading="lazy" onerror="this.onerror=null;this.src='https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico';" />
        <div>
          <div class="fb-author-name">
            ${post.author || 'Facebook'}
            <svg class="verified-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align: -2px;">
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7l-4.2-4.2 1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2z"/>
            </svg>
            ${reshareActionHtml}
          </div>
          <time class="fb-post-date">${post.dateFormatted || ''}</time>
        </div>
      </div>
    `;

    return `
      <article class="fb-post-card">
        <div class="fb-post-header">
          ${authorHeaderHtml}
          <svg class="fb-icon-brand" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
        </div>

        ${isReshare ? `
          ${post.content && post.content.trim() ? `
            <div class="fb-post-content resharer-commentary">
              ${formattedContent}
            </div>
          ` : ''}

          <div class="fb-reshared-embed">
            <div class="reshared-embed-header">
              <img src="${reshared.authorAvatar || 'https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico'}" alt="${reshared.author || 'Facebook'}" class="reshared-author-avatar" onerror="this.onerror=null;this.src='https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico';" />
              <div style="flex-grow: 1; min-width: 0;">
                <div class="reshared-author-name">
                  ${reshared.author || 'Facebook Post'}
                  <svg class="verified-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align: -2px;">
                    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7l-4.2-4.2 1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2z"/>
                  </svg>
                </div>
                <time class="reshared-post-date">${reshared.dateFormatted || reshared.date || ''}</time>
              </div>
              ${reshared.url ? `
                <a href="${reshared.url}" target="_blank" rel="noopener noreferrer" title="View original post" style="color: var(--color-text-muted); padding: 4px; display: flex; align-items: center; text-decoration: none;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
              ` : ''}
            </div>

            ${reshared.content ? `
              <div class="reshared-post-content">
                ${formatPostText(reshared.content, hashtags)}
              </div>
            ` : ''}

            ${reshared.videoClip ? `
              <div class="reshared-media-wrap">
                <video controls playsinline preload="metadata" poster="${reshared.image || ''}" style="width: 100%;">
                  <source src="${reshared.videoClip}" type="video/mp4">
                  Your browser does not support HTML5 video.
                </video>
              </div>
            ` : (reshared.image || (reshared.mediaType === 'video' || (reshared.url && (reshared.url.includes('/videos/') || reshared.url.includes('/reel/'))))) ? `
              <div class="reshared-media-wrap">
                ${(reshared.mediaType === 'video' || (reshared.url && (reshared.url.includes('/videos/') || reshared.url.includes('/reel/')))) ? `
                  <a href="${reshared.url || post.url}" target="_blank" rel="noopener noreferrer" class="fb-video-cover-wrap" style="position:relative; display:block;" title="Watch video on Facebook">
                    <img src="${reshared.image || ''}" alt="Reshared video" class="reshared-media-image" loading="lazy" onerror="handleVideoThumbnailFallback(this, '${encodeURIComponent(reshared.author || 'Video')}')" />
                    <div class="fb-video-play-overlay">
                      <div class="fb-video-play-btn">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style="margin-left: 3px;">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                      <div class="fb-video-badge">
                        <span>Watch Video</span>
                      </div>
                    </div>
                  </a>
                ` : `
                  <img src="${reshared.image}" alt="Reshared media" class="reshared-media-image" loading="lazy" onerror="this.closest('.reshared-media-wrap').style.display='none';" />
                `}
              </div>
            ` : ''}
          </div>
        ` : `
          ${isVideo ? `
            <div class="fb-video-media">
              ${post.videoClip ? `
                <video controls playsinline preload="metadata" poster="${post.image || ''}">
                  <source src="${post.videoClip}" type="video/mp4">
                  Your browser does not support HTML5 video.
                </video>
              ` : `
                <a href="${post.url}" target="_blank" rel="noopener noreferrer" class="fb-video-cover-wrap" title="Watch video on Facebook">
                  <img src="${post.image || ''}" alt="${post.author || 'Facebook Video'}" loading="lazy" onerror="handleVideoThumbnailFallback(this, '${encodeURIComponent(post.author || 'Facebook Video')}')" />
                  <div class="fb-video-play-overlay">
                    <div class="fb-video-play-btn">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style="margin-left: 3px;">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                    <div class="fb-video-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                      <span>Watch on Facebook</span>
                    </div>
                  </div>
                </a>
              `}
            </div>
          ` : (post.image ? `
            <div class="fb-post-media">
              <img src="${post.image}" alt="Facebook media" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.fb-post-media').style.display='none';" />
            </div>
          ` : '')}

          <div class="fb-post-content">
            ${formattedContent}
          </div>
        `}

        <div class="fb-post-stats">
          <div class="fb-reactions">
            <span class="reaction-icons">
              <span class="reaction-dot reaction-like">👍</span>
              <span class="reaction-dot reaction-heart">❤️</span>
            </span>
            <span>${post.likes || 1}</span>
            <span style="margin: 0 4px;">•</span>
            <span>${post.comments || 0} ${commentsText}</span>
          </div>
          <a href="${post.url || '#'}" target="_blank" rel="noopener noreferrer" class="fb-view-link">
            ${viewOnFbText}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
      </article>
    `;
  }).join('');

  setupDynamicMediaScaling();
}

/**
 * Text formatter preserving all paragraph line breaks and highlighting hashtags
 */
function formatPostText(text, globalHashtags = []) {
  if (!text) return '';

  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Render hashtags cleanly without yellow highlight badges
  safe = safe.replace(/#([\w\u0080-\uffff]+)/g, (match) => {
    return `<span class="hashtag-link">${match}</span>`;
  });

  return safe;
}

function updateFeedStatusBadge(isLive = false) {
  const badge = document.getElementById('feed-status-badge');
  const label = document.getElementById('feed-status-label');
  if (label) {
    label.textContent = isLive ? t('feed.liveBadge', 'Live RSS') : t('feed.verifiedBadge', 'Verified');
  }
  if (badge) {
    badge.className = `badge ${isLive ? 'badge-yellow' : 'badge-glass'} verified-badge`;
  }
}

function getLocaleCode() {
  switch (currentLang) {
    case 'zh': return 'zh-CN';
    case 'ms': return 'ms-MY';
    default: return 'en-US';
  }
}

function setupInteractions() {
  const refreshBtn = document.getElementById('refresh-feed-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.style.opacity = '0.6';
      await loadConfig();
      applyDynamicBindings();
      await loadSocialFeed();
      refreshBtn.disabled = false;
      refreshBtn.style.opacity = '1';
    });
  }

  const searchInput = document.getElementById('feed-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      if (!q) {
        renderFeedPosts(filterPosts());
        return;
      }
      const filtered = filterPosts().filter(p => (p.content || '').toLowerCase().includes(q));
      renderFeedPosts(filtered);
    });
  }
}

/**
 * 8. Fallback Thumbnail Generator for Videos
 */
window.handleVideoThumbnailFallback = function(img, authorName) {
  img.onerror = null;
  const decoded = decodeURIComponent(authorName || 'Facebook Video');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#202070"/>
        <stop offset="100%" stop-color="#0f0f35"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <circle cx="320" cy="155" r="38" fill="#EEBD00"/>
    <polygon points="314,142 334,155 314,168" fill="#202070"/>
    <text x="320" y="230" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-weight="bold" font-size="16">${decoded}</text>
    <text x="320" y="255" text-anchor="middle" fill="#EEBD00" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="12">Watch Video on Facebook</text>
  </svg>`;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};

/**
 * 9. Content Aspect Ratio Detector & Dynamic Scaling Engine
 */
function setupDynamicMediaScaling() {
  const images = document.querySelectorAll('.fb-post-media img, .fb-video-cover-wrap img, .reshared-media-wrap img');
  images.forEach(img => {
    const applyScale = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      const wrap = img.closest('.fb-post-media, .fb-video-media, .reshared-media-wrap');
      if (!wrap) return;

      wrap.classList.remove('media-vertical', 'media-portrait', 'media-square', 'media-landscape');

      if (ratio < 0.68) {
        wrap.classList.add('media-vertical');
      } else if (ratio < 0.88) {
        wrap.classList.add('media-portrait');
      } else if (ratio <= 1.18) {
        wrap.classList.add('media-square');
      } else {
        wrap.classList.add('media-landscape');
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      applyScale();
    } else {
      img.addEventListener('load', applyScale);
    }
  });

  const videos = document.querySelectorAll('.fb-video-media video, .reshared-media-wrap video');
  videos.forEach(video => {
    const applyVideoScale = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const ratio = video.videoWidth / video.videoHeight;
      const wrap = video.closest('.fb-video-media, .reshared-media-wrap');
      if (!wrap) return;

      wrap.classList.remove('media-vertical', 'media-portrait', 'media-square', 'media-landscape');
      if (ratio < 0.68) {
        wrap.classList.add('media-vertical');
      } else if (ratio < 0.88) {
        wrap.classList.add('media-portrait');
      } else if (ratio <= 1.18) {
        wrap.classList.add('media-square');
      } else {
        wrap.classList.add('media-landscape');
      }
    };

    if (video.readyState >= 1) {
      applyVideoScale();
    } else {
      video.addEventListener('loadedmetadata', applyVideoScale);
    }
  });
}

