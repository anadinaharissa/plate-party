// GET /.netlify/functions/import?url=<recipe link>  ->  { title, image, source }
const UA = 'Mozilla/5.0 (compatible; PlatePartyBot/1.0; +https://netlify.app)';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' }
});
const get = async (u, ms = 6000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html,application/json' }, redirect: 'follow', signal: c.signal }); }
  finally { clearTimeout(t); }
};
const decode = s => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re); if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']*)["']/i); return c ? decode(c[1]) : '';
};
const fromJsonLd = html => {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      let data = JSON.parse(b[1].trim());
      const list = [].concat(data, ...(Array.isArray(data) ? [] : [data['@graph'] || []]));
      const r = list.flat().find(x => x && [].concat(x['@type']).includes('Recipe'));
      if (r) {
        let img = r.image; if (Array.isArray(img)) img = img[0]; if (img && typeof img === 'object') img = img.url;
        return { title: decode(r.name), image: img || '' };
      }
    } catch (e) {}
  }
  return null;
};
const oembed = async endpoint => {
  const r = await get(endpoint); if (!r.ok) return null;
  const j = await r.json(); return { title: decode(j.title), image: j.thumbnail_url || '' };
};

export default async (req) => {
  const raw = new URL(req.url).searchParams.get('url') || '';
  let u; try { u = new URL(raw); } catch (e) { return json({ error: 'bad_url' }, 400); }
  if (!/^https?:$/.test(u.protocol)) return json({ error: 'bad_url' }, 400);
  const host = u.hostname.replace(/^www\.|^m\./, '');
  try {
    if (/youtube\.com|youtu\.be/.test(host)) {
      const r = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`);
      if (r) return json({ ...r, source: 'youtube' });
    }
    if (/tiktok\.com/.test(host)) {
      const r = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.href)}`);
      if (r) return json({ ...r, source: 'tiktok' });
    }
    const res = await get(u.href); if (!res.ok) return json({ error: 'fetch_failed', status: res.status }, 502);
    const html = (await res.text()).slice(0, 1500000);
    const ld = fromJsonLd(html);
    const title = (ld && ld.title) || meta(html, 'og:title') || meta(html, 'twitter:title') || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
    let image = (ld && ld.image) || meta(html, 'og:image') || meta(html, 'twitter:image');
    if (image) { try { image = new URL(image, u.href).href; } catch (e) {} }
    if (!title && !image) return json({ error: 'no_meta' }, 404);
    return json({ title, image, source: /instagram\.com/.test(host) ? 'instagram' : 'web' });
  } catch (e) {
    return json({ error: 'timeout_or_network' }, 504);
  }
};
