// GET /.netlify/functions/import?url=<recipe link>  ->  { title, image, imageData, source }
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': status === 200 ? 'public, max-age=600' : 'no-store' }
});
const get = async (u, { ms = 7000, ua = BROWSER_UA, accept = 'text/html,application/json' } = {}) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(u, { headers: { 'user-agent': ua, accept, 'accept-language': 'en' }, redirect: 'follow', signal: c.signal }); }
  finally { clearTimeout(t); }
};
const decode = s => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re); if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']*)["']/i); return c ? decode(c[1]) : '';
};
const fromJsonLd = html => {
  for (const b of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(b[1].trim());
      const list = [].concat(data, ...(Array.isArray(data) ? [] : [data['@graph'] || []])).flat();
      const r = list.find(x => x && [].concat(x['@type']).includes('Recipe'));
      if (r) { let img = r.image; if (Array.isArray(img)) img = img[0]; if (img && typeof img === 'object') img = img.url; return { title: decode(r.name), image: img || '' }; }
    } catch (e) {}
  }
  return null;
};
const oembed = async endpoint => {
  try { const r = await get(endpoint, { accept: 'application/json' }); if (!r.ok) return null; const j = await r.json(); return j && (j.title || j.thumbnail_url) ? { title: decode(j.title), image: j.thumbnail_url || '' } : null; }
  catch (e) { return null; }
};
const scrape = async (href, ua) => {
  try {
    const res = await get(href, { ua }); if (!res.ok) return null;
    const html = (await res.text()).slice(0, 1500000), ld = fromJsonLd(html);
    const title = (ld && ld.title) || meta(html, 'og:title') || meta(html, 'twitter:title') || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
    let image = (ld && ld.image) || meta(html, 'og:image') || meta(html, 'og:image:url') || meta(html, 'twitter:image');
    if (image) { try { image = new URL(image, res.url || href).href; } catch (e) {} }
    return title || image ? { title, image } : null;
  } catch (e) { return null; }
};
// Social CDNs block hotlinking and expire URLs, so return the thumbnail inline.
const inline = async src => {
  if (!src) return '';
  try {
    const r = await get(src, { ms: 6000, accept: 'image/*' }); if (!r.ok) return '';
    const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!type.startsWith('image/')) return '';
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 2500000) return '';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (e) { return ''; }
};
const resolve = async u => {
  if (!/^(vm|vt)\.tiktok\.com$|^youtu\.be$|^(www\.)?pin\.it$/.test(u.hostname)) return u;
  try { const r = await get(u.href, { ms: 5000 }); return new URL(r.url || u.href); } catch (e) { return u; }
};

export default async (req) => {
  const raw = (new URL(req.url).searchParams.get('url') || '').trim();
  let u; try { u = new URL(raw); } catch (e) { return json({ error: 'bad_url' }, 400); }
  if (!/^https?:$/.test(u.protocol)) return json({ error: 'bad_url' }, 400);
  u = await resolve(u);
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let out = null, source = 'web';
  if (/youtube\.com|youtu\.be/.test(host)) {
    source = 'youtube';
    const sm = u.pathname.match(/^\/shorts\/([\w-]+)/); const href = sm ? `https://www.youtube.com/watch?v=${sm[1]}` : u.href;
    out = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(href)}`) || await oembed(`https://noembed.com/embed?url=${encodeURIComponent(href)}`);
    const id = sm ? sm[1] : u.searchParams.get('v');
    if (out && !out.image && id) out.image = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } else if (/tiktok\.com/.test(host)) {
    source = 'tiktok';
    out = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.href.split('?')[0])}`) || await scrape(u.href, PREVIEW_UA);
  } else if (/instagram\.com/.test(host)) {
    source = 'instagram';
    out = await scrape(u.href.split('?')[0], PREVIEW_UA);
  }
  if (!out) out = await scrape(u.href, BROWSER_UA) || await scrape(u.href, PREVIEW_UA);
  if (!out) return json({ error: 'no_meta', source }, 404);
  const imageData = await inline(out.image);
  return json({ title: out.title || '', image: out.image || '', imageData, source });
};
