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
    if (el.tagName === 'META') {
      el.setAttribute('content', siteName);
    } else {
      el.textContent = siteName;
    }
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
      <img src="assets/icon.webp" alt="Loading" class="feed-sync-logo" style="width: 48px; height: 48px; border-radius: 12px; margin-bottom: 1rem; box-shadow: 0 4px 14px rgba(32, 32, 112, 0.15);" />
      <p style="font-family: var(--font-cabinet); font-weight: 700; color: var(--primary-blue);">
        ${t('feed.checkingFeed', `Syncing feed for ${hashtagsStr}...`)}
      </p>
    </div>
  `;

  let combinedPosts = [];
  let isLive = false;
  const updateFeedUI = () => {
    // STRICT GLOBAL HASHTAG FILTERING: Only include posts that actually contain the hashtag
    const strictlyFiltered = combinedPosts.filter(post => postMatchesHashtags(post, hashtags));

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

  // Step 2: Optional Client-Sided RSSHub Ingestion (disabled by default; GitHub Actions syncs feed.json every 15m without CORS)
  if (appConfig && appConfig.enableClientRssHub === true) {
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
      hashtags: extractHashtags((parsed.text || item.title || '') + ' ' + (parsed.resharedPost?.content || '')),
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
  // 0. If this is already a multi-sharer consolidated post, keep and enrich all sharers
  if (post.isMultiSharer && Array.isArray(post.sharers)) {
    const sourceSet = new Set(Array.isArray(post.sources) ? post.sources : []);
    post.sharers.forEach(s => {
      if (s.sourceId) sourceSet.add(s.sourceId);
      const prof = profiles.find(pr => pr.id === s.sourceId);
      if (prof && (!s.authorAvatar || s.authorAvatar.includes('graph.facebook.com'))) {
        s.authorAvatar = prof.avatar || s.authorAvatar;
      }
    });
    return {
      ...post,
      sources: Array.from(sourceSet)
    };
  }

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
      if (Array.isArray(p.sharers) && p.sharers.some(s => s.sourceId === activeSourceFilter || s.author === activeSourceFilter)) {
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
  const countBySource = {};

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

  distinctSources.forEach(s => {
    countBySource[s.id] = posts.filter(p => {
      if (Array.isArray(p.sources) && p.sources.includes(s.id)) return true;
      if (Array.isArray(p.sharers) && p.sharers.some(sh => sh.sourceId === s.id || sh.author === s.name)) return true;
      return p.sourceId === s.id || p.author === s.name || p.collabAuthor === s.name;
    }).length;
  });

  if (distinctSources.length <= 1) {
    container.innerHTML = '';
    return;
  }

  const activeObj = distinctSources.find(s => s.id === activeSourceFilter);
  const activeLabel = activeSourceFilter === 'all'
    ? t('feed.allSources', 'All Channels')
    : (activeObj ? activeObj.name : activeSourceFilter);
  const activeCount = countBySource[activeSourceFilter] || posts.length;

  container.innerHTML = `
    <div class="channel-filter-widget">
      <!-- Burger / Collapsible Toggle Button -->
      <button type="button" class="channel-burger-btn" id="channel-burger-toggle" aria-expanded="false" title="Filter by Channel">
        <div class="burger-btn-left">
          <span class="burger-icon-bars" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span class="burger-filter-text">
            <span class="burger-filter-prefix">${t('feed.filterBy', 'Filter:')}</span>
            <strong class="burger-active-title" id="channel-active-title">${activeLabel}</strong>
          </span>
        </div>
        <div class="burger-btn-right">
          <span class="burger-count-badge" id="channel-active-count">${activeCount}</span>
          <svg class="burger-chevron-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </button>

      <!-- Collapsible Channel Selection Tray -->
      <div class="channel-collapsible-menu" id="channel-collapsible-menu">
        <div class="channel-pills-cluster">
          <button type="button" class="channel-pill-btn ${activeSourceFilter === 'all' ? 'active' : ''}" data-src="all">
            <span class="pill-dot"></span>
            <span class="pill-label">${t('feed.allSources', 'All Channels')}</span>
            <span class="pill-count">${posts.length}</span>
          </button>
          ${distinctSources.map(s => `
            <button type="button" class="channel-pill-btn ${activeSourceFilter === s.id ? 'active' : ''}" data-src="${s.id}">
              ${s.avatar ? `<img src="${s.avatar}" class="pill-avatar-img" onerror="this.style.display='none'" />` : ''}
              <span class="pill-label">${s.name}</span>
              <span class="pill-count">${countBySource[s.id] || 0}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const toggleBtn = container.querySelector('#channel-burger-toggle');
  const menu = container.querySelector('#channel-collapsible-menu');

  if (toggleBtn && menu) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = toggleBtn.classList.toggle('expanded');
      menu.classList.toggle('open', isExpanded);
      toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target) && menu.classList.contains('open')) {
        menu.classList.remove('open');
        toggleBtn.classList.remove('expanded');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  container.querySelectorAll('.channel-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.channel-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSourceFilter = btn.getAttribute('data-src');

      const newActiveObj = distinctSources.find(s => s.id === activeSourceFilter);
      const newLabel = activeSourceFilter === 'all'
        ? t('feed.allSources', 'All Channels')
        : (newActiveObj ? newActiveObj.name : activeSourceFilter);
      const newCount = countBySource[activeSourceFilter] || posts.length;

      const titleEl = container.querySelector('#channel-active-title');
      const countEl = container.querySelector('#channel-active-count');
      if (titleEl) titleEl.textContent = newLabel;
      if (countEl) countEl.textContent = newCount;

      // Automatically collapse on mobile so user sees the filtered posts right away
      if (window.innerWidth <= 768 && menu) {
        menu.classList.remove('open');
        if (toggleBtn) {
          toggleBtn.classList.remove('expanded');
          toggleBtn.setAttribute('aria-expanded', 'false');
        }
      }

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

    const isMultiSharer = !!(post.isMultiSharer && Array.isArray(post.sharers) && post.sharers.length > 1);
    const isReshare = !!(post.isReshare && post.resharedPost);
    const reshared = post.resharedPost || {};
    // For shared posts, link directly to the original post URL
    const targetPostUrl = (isReshare && reshared.url) ? reshared.url : (post.url || '#');
    const viewButtonLabel = isReshare ? t('feed.viewOriginal', 'View Original') : viewOnFbText;
    const reshareActionHtml = isReshare ? `
      <span class="reshare-action-badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"/>
        </svg>
        shared a post
      </span>
    ` : '';

    const authorHeaderHtml = isMultiSharer ? `
      <div class="fb-author-wrap multi-sharer-author-wrap">
        <div class="multi-avatars-cluster">
          ${post.sharers.map((s, idx) => `
            <img src="${s.authorAvatar || 'https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico'}" alt="${s.author}" class="multi-avatar-img avatar-idx-${idx}" title="${s.author}" onerror="this.onerror=null;this.src='https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico';" />
          `).join('')}
        </div>
        <div>
          <div class="fb-author-name multi-sharer-names">
            ${post.sharers.map((s, idx) => `
              <span class="multi-author-name-item">${s.author}</span>
              ${idx < post.sharers.length - 1 ? `<span class="collab-cross">&</span>` : ''}
            `).join('')}
            <span class="multi-share-pill">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"/>
              </svg>
              ${t('feed.teamReshares', '{count} SHARES').replace('{count}', post.sharers.length)}
            </span>
          </div>
          <time class="fb-post-date">${post.dateFormatted || ''} • ${t('feed.sharedByCount', 'Reshared by {count} Candidates').replace('{count}', post.sharers.length)}</time>
        </div>
      </div>
    ` : (isCollab ? `
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
    `);

    return `
      <article class="fb-post-card">
        <div class="fb-post-header">
          ${authorHeaderHtml}
          <a href="${targetPostUrl}" target="_blank" rel="noopener noreferrer" class="fb-view-btn-top" title="${isReshare ? 'View original post on Facebook' : 'View on Facebook'}">
            <svg class="fb-icon-brand-sm" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            <span>${viewButtonLabel}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>

        ${isReshare ? `
          ${isMultiSharer ? `
            <div class="team-sharers-section">
              <div class="team-sharers-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                <span>${t('feed.candidateCommentary', 'Candidate Commentary')}</span>
                <span class="team-sharers-count">(${post.sharers.length})</span>
              </div>
              <div class="team-sharers-grid">
                ${post.sharers.map(s => {
                  const cleanedQuote = formatPostText(s.commentary, hashtags);
                  const isFocused = (activeSourceFilter === s.sourceId || activeSourceFilter === s.author);
                  return `
                    <div class="sharer-card ${isFocused ? 'is-focused' : ''}">
                      <div class="sharer-card-header">
                        <img src="${s.authorAvatar || 'https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico'}" alt="${s.author}" class="sharer-card-avatar" onerror="this.onerror=null;this.src='https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico';" />
                        <div class="sharer-card-info">
                          <strong class="sharer-card-author">${s.author}</strong>
                          <span class="sharer-card-time">${s.dateFormatted || ''}</span>
                        </div>
                        ${s.url ? `
                          <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="sharer-view-link" title="View ${s.author}'s post on Facebook">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                            </svg>
                          </a>
                        ` : ''}
                      </div>
                      <div class="sharer-card-bubble">
                        <span class="quote-text">${cleanedQuote || '<em>Shared this update</em>'}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : `
            ${post.content && formatPostText(post.content).trim() ? `
              <div class="fb-post-content resharer-commentary">
                ${formatPostText(post.content)}
              </div>
            ` : ''}
          `}

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
              ${targetPostUrl ? `
                <a href="${targetPostUrl}" target="_blank" rel="noopener noreferrer" title="View original post" style="color: var(--color-text-muted); padding: 4px; display: flex; align-items: center; text-decoration: none;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
              ` : ''}
            </div>

            ${reshared.content && formatPostText(reshared.content).trim() ? `
              <div class="reshared-post-content">
                ${formatPostText(reshared.content)}
              </div>
            ` : ''}

            ${reshared.videoClip ? `
              <div class="reshared-media-wrap" onclick="window.openMediaLightbox('${encodeURIComponent(post.id || post.url)}', 0)" style="cursor: pointer;">
                <video controls playsinline preload="metadata" poster="${reshared.image || post.image || ''}" style="width: 100%;">
                  <source src="${reshared.videoClip}" type="video/mp4">
                  Your browser does not support HTML5 video.
                </video>
              </div>
            ` : (() => {
              const reshareVidMatch = (reshared.url || '').match(/(?:videos|reel)\/(\d+)/);
              const isReshareVideo = (reshared.mediaType === 'video' || (reshared.url && (reshared.url.includes('/videos/') || reshared.url.includes('/reel/'))));

              if (isReshareVideo) {
                const reshareThumb = reshared.image || post.image || (reshareVidMatch ? `data/images/poster_${reshareVidMatch[1]}.jpg` : '');
                return `
                  <div class="reshared-media-wrap" onclick="window.openMediaLightbox('${encodeURIComponent(post.id || post.url)}', 0)" style="cursor: pointer;">
                    <div class="fb-video-cover-wrap" style="position:relative; display:block;" title="Click to view video">
                      <img src="${reshareThumb}" alt="Reshared video" class="reshared-media-image" loading="lazy" referrerpolicy="no-referrer" onerror="handleVideoThumbnailFallback(this, '${encodeURIComponent(reshared.author || 'Video')}')" />
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
                    </div>
                  </div>
                `;
              }

              // Multi-photo gallery for reshares
              const sharedPostObj = {
                id: post.id || post.url,
                author: reshared.author || post.author,
                authorAvatar: reshared.authorAvatar || post.authorAvatar,
                url: targetPostUrl,
                images: (reshared.images && reshared.images.length > 0)
                  ? reshared.images
                  : ((post.images && post.images.length > 0)
                    ? post.images
                    : (reshared.image || post.image ? [reshared.image || post.image] : []))
              };
              return renderPostMediaHtml(sharedPostObj, true);
            })()}
          </div>
        ` : `
          ${isVideo ? `
            <div class="fb-video-media" onclick="window.openMediaLightbox('${encodeURIComponent(post.id || post.url)}', 0)" style="cursor: pointer;">
              ${(() => {
                const vidMatch = (post.url || '').match(/(?:videos|reel)\/(\d+)/);
                const videoThumb = post.image || (vidMatch ? `data/images/poster_${vidMatch[1]}.jpg` : '');
                return post.videoClip ? `
                  <video controls playsinline preload="metadata" poster="${videoThumb}">
                    <source src="${post.videoClip}" type="video/mp4">
                    Your browser does not support HTML5 video.
                  </video>
                ` : `
                  <div class="fb-video-cover-wrap" title="Click to view video">
                    <img src="${videoThumb}" alt="${post.author || 'Facebook Video'}" loading="lazy" referrerpolicy="no-referrer" onerror="handleVideoThumbnailFallback(this, '${encodeURIComponent(post.author || 'Facebook Video')}')" />
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
                        <span>Watch Video</span>
                      </div>
                    </div>
                  </div>
                `;
              })()}
            </div>
          ` : renderPostMediaHtml(post, false)}

          ${formattedContent.trim() ? `
            <div class="fb-post-content">
              ${formattedContent}
            </div>
          ` : ''}
        `}
      </article>
    `;
  }).join('');

  setupDynamicMediaScaling();
}

/**
 * Text formatter: removes all hashtags and extra blank lines for clean news display
 */
function formatPostText(text) {
  if (!text) return '';

  // 1. Remove all hashtags (e.g. #palliativecare, #sb, #drbryankek)
  let cleaned = text.replace(/#[\w\u0080-\uffff]+/g, '');

  // 2. Clean up multiple blank lines or redundant spaces
  cleaned = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter((line, idx, arr) => {
      if (!line && idx > 0 && !arr[idx - 1]) return false;
      return true;
    })
    .join('\n')
    .trim();

  // 3. Escape HTML entities
  let safe = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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

  // Setup media lightbox click and keyboard controls
  setupLightboxEvents();
}

function deduplicateImageUrls(imgs) {
  if (!Array.isArray(imgs)) return [];
  const seen = new Set();
  const res = [];
  for (const img of imgs) {
    if (!img) continue;
    const m = img.match(/\d+_\d+_\d+_n\.jpg/);
    const key = m ? m[0] : img.split('?')[0];
    if (!seen.has(key)) {
      seen.add(key);
      res.push(img);
    }
  }
  return res;
}

/**
 * Renders single or multi-photo galleries with click-to-expand
 */
function renderPostMediaHtml(post, isReshare = false) {
  const rawImages = (post.images && post.images.length > 0) ? post.images : (post.image ? [post.image] : []);
  const images = deduplicateImageUrls(rawImages);
  if (images.length === 0) return '';

  const postId = encodeURIComponent(post.id || post.url || '');

  if (images.length === 1) {
    return `
      <div class="${isReshare ? 'reshared-media-wrap' : 'fb-post-media'}" onclick="window.openMediaLightbox('${postId}', 0)" title="Click to view full resolution photo" style="cursor: pointer;">
        <img src="${images[0]}" alt="${post.author || 'Media'}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.fb-post-media, .reshared-media-wrap').style.display='none';" />
      </div>
    `;
  }

  if (images.length >= 5) {
    const displayTop = images.slice(0, 2);
    const displayBottom = images.slice(2, 5);
    const remaining = images.length - 5;
    return `
      <div class="fb-media-gallery gallery-5">
        <div class="gallery-row-top">
          ${displayTop.map((img, i) => `
            <div class="gallery-item" onclick="window.openMediaLightbox('${postId}', ${i})" title="View photo ${i + 1} of ${images.length}">
              <img src="${img}" alt="${post.author || 'Photo'} ${i + 1}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';" />
            </div>
          `).join('')}
        </div>
        <div class="gallery-row-bottom">
          ${displayBottom.map((img, i) => `
            <div class="gallery-item" onclick="window.openMediaLightbox('${postId}', ${i + 2})" title="View photo ${i + 3} of ${images.length}">
              <img src="${img}" alt="${post.author || 'Photo'} ${i + 3}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';" />
              ${(i === 2 && remaining > 0) ? `<div class="gallery-item-more-overlay">+${remaining}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const galleryClass = images.length === 2 ? 'gallery-2' : (images.length === 3 ? 'gallery-3' : 'gallery-4');
  const displayItems = images.slice(0, 4);

  return `
    <div class="fb-media-gallery ${galleryClass}">
      ${displayItems.map((img, i) => `
        <div class="gallery-item" onclick="window.openMediaLightbox('${postId}', ${i})" title="View photo ${i + 1} of ${images.length}">
          <img src="${img}" alt="${post.author || 'Photo'} ${i + 1}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';" />
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Interactive Media Lightbox System
 */
let currentLightboxMedia = [];
let currentLightboxIndex = 0;
let currentLightboxAuthor = {};

window.openMediaLightbox = function(encodedPostId, startIndex = 0) {
  const targetId = decodeURIComponent(encodedPostId);
  const post = (allFeedPosts || []).find(p => p.id === targetId || p.url === targetId);
  if (!post) return;

  const items = [];
  const isVideo = post.mediaType === 'video' || (post.url && (post.url.includes('/videos/') || post.url.includes('/reel/')));
  
  if (isVideo) {
    items.push({
      type: 'video',
      src: post.videoClip || '',
      poster: post.image || '',
      fbUrl: post.url || '#'
    });
  }

  const rawImgList = (post.images && post.images.length > 0)
    ? post.images
    : ((post.resharedPost?.images && post.resharedPost.images.length > 0)
      ? post.resharedPost.images
      : (post.image ? [post.image] : []));

  const imgList = deduplicateImageUrls(rawImgList);

  imgList.forEach(src => {
    if (!items.some(it => it.src === src)) {
      items.push({ type: 'image', src, fbUrl: post.url || '#' });
    }
  });

  if (items.length === 0) return;

  currentLightboxMedia = items;
  currentLightboxIndex = Math.min(Math.max(0, startIndex), items.length - 1);
  currentLightboxAuthor = {
    name: post.author || 'Facebook Post',
    avatar: post.authorAvatar || 'https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico',
    url: post.url || '#'
  };

  updateLightboxUI();

  const modal = document.getElementById('media-lightbox-modal');
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
};

window.closeMediaLightbox = function() {
  const modal = document.getElementById('media-lightbox-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    const stage = document.getElementById('lightbox-content-wrap');
    if (stage) stage.innerHTML = '';
  }
};

function updateLightboxUI() {
  if (!currentLightboxMedia || currentLightboxMedia.length === 0) return;

  const currentItem = currentLightboxMedia[currentLightboxIndex];
  const avatarEl = document.getElementById('lightbox-author-avatar');
  const nameEl = document.getElementById('lightbox-author-name');
  const counterEl = document.getElementById('lightbox-counter');
  const fbLinkEl = document.getElementById('lightbox-fb-link');
  const stageEl = document.getElementById('lightbox-content-wrap');
  const thumbsEl = document.getElementById('lightbox-thumbs-bar');
  const prevBtn = document.getElementById('lightbox-prev-btn');
  const nextBtn = document.getElementById('lightbox-next-btn');

  if (avatarEl) avatarEl.src = currentLightboxAuthor.avatar || '';
  if (nameEl) nameEl.textContent = currentLightboxAuthor.name || 'Facebook';
  if (counterEl) {
    counterEl.textContent = currentLightboxMedia.length > 1
      ? `${currentLightboxIndex + 1} / ${currentLightboxMedia.length}`
      : '';
  }
  if (fbLinkEl) fbLinkEl.href = currentLightboxAuthor.url || '#';

  if (prevBtn) prevBtn.style.display = currentLightboxMedia.length > 1 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = currentLightboxMedia.length > 1 ? 'flex' : 'none';

  if (stageEl) {
    if (currentItem.type === 'video') {
      if (currentItem.src) {
        stageEl.innerHTML = `
          <video controls autoplay playsinline poster="${currentItem.poster || ''}">
            <source src="${currentItem.src}" type="video/mp4">
            Your browser does not support HTML5 video.
          </video>
        `;
      } else {
        stageEl.innerHTML = `
          <div style="text-align: center; color: #fff;">
            <img src="${currentItem.poster || ''}" alt="Video preview" style="max-height: 60vh; border-radius: 8px; margin-bottom: 1rem;" />
            <div>
              <a href="${currentItem.fbUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary-yellow">
                Watch Full Video on Facebook
              </a>
            </div>
          </div>
        `;
      }
    } else {
      stageEl.innerHTML = `
        <img src="${currentItem.src}" alt="${currentLightboxAuthor.name}" referrerpolicy="no-referrer" />
      `;
    }
  }

  // Thumbnails bar
  if (thumbsEl) {
    if (currentLightboxMedia.length > 1) {
      thumbsEl.innerHTML = currentLightboxMedia.map((it, i) => `
        <div class="lightbox-thumb ${i === currentLightboxIndex ? 'active' : ''}" onclick="selectLightboxIndex(${i})">
          <img src="${it.type === 'video' ? (it.poster || '') : it.src}" alt="Thumb ${i + 1}" referrerpolicy="no-referrer" />
        </div>
      `).join('');
      thumbsEl.style.display = 'flex';
    } else {
      thumbsEl.innerHTML = '';
      thumbsEl.style.display = 'none';
    }
  }
}

window.selectLightboxIndex = function(idx) {
  if (idx < 0 || idx >= currentLightboxMedia.length) return;
  currentLightboxIndex = idx;
  updateLightboxUI();
};

window.nextMediaLightbox = function() {
  if (currentLightboxMedia.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxMedia.length;
  updateLightboxUI();
};

window.prevMediaLightbox = function() {
  if (currentLightboxMedia.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxMedia.length) % currentLightboxMedia.length;
  updateLightboxUI();
};

function setupLightboxEvents() {
  const closeBtn = document.getElementById('lightbox-close-btn');
  const prevBtn = document.getElementById('lightbox-prev-btn');
  const nextBtn = document.getElementById('lightbox-next-btn');
  const modal = document.getElementById('media-lightbox-modal');
  const stage = document.getElementById('lightbox-stage');

  if (closeBtn) closeBtn.addEventListener('click', closeMediaLightbox);
  if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); prevMediaLightbox(); });
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); nextMediaLightbox(); });

  // Click on backdrop (outside image/video) closes lightbox
  if (stage) {
    stage.addEventListener('click', (e) => {
      if (e.target === stage || e.target.id === 'lightbox-content-wrap') {
        closeMediaLightbox();
      }
    });
  }

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (!modal || !modal.classList.contains('active')) return;
    if (e.key === 'Escape') closeMediaLightbox();
    if (e.key === 'ArrowRight') nextMediaLightbox();
    if (e.key === 'ArrowLeft') prevMediaLightbox();
  });
}

/**
 * 8. Fallback Thumbnail Generator for Videos
 */
window.handleVideoThumbnailFallback = function(img, authorName) {
  // If we can extract a video ID from the enclosing link's href, try local poster first before SVG
  const link = img.closest('a');
  const href = link ? link.getAttribute('href') : '';
  const match = href ? href.match(/(?:videos|reel)\/(\d+)/) : null;
  if (match && !img.dataset.triedPoster) {
    img.dataset.triedPoster = 'true';
    img.src = `data/images/poster_${match[1]}.jpg`;
    return;
  }

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

