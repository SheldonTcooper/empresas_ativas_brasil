/* ── GET /api/noticias ── últimas notícias de economia e de negócios/PMEs (RSS públicos)
   Lidas no servidor a cada 20 min (cache) e exibidas nas colunas ao lado do mapa. */
const router = require('express').Router();
const { comCache } = require('../lib/db');

const GOOGLE = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

const FEEDS = {
  economia: [
    { fonte: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml' },
    { fonte: 'InfoMoney',      url: 'https://www.infomoney.com.br/feed/' },
  ],
  negocios: [
    { fonte: 'Agência Sebrae', url: 'https://agenciasebrae.com.br/feed/' },
    { fonte: null, url: GOOGLE('"pequenas empresas" OR PMEs OR B2B OR empreendedorismo OR "micro e pequenas" when:3d') },
  ],
};
const POR_COLUNA = 20;
const CACHE_MS = 20 * 60 * 1000;

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function texto(v) {
  return String(v || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}
const campo = (item, tag) => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1];

function lerRss(xml, fonteFixa) {
  return xml.split(/<item[\s>]/i).slice(1).map(item => {
    let titulo = texto(campo(item, 'title'));
    let fonte = fonteFixa || texto(campo(item, 'source'));
    // Google Notícias: "Título - Fonte"
    if (!fonteFixa && fonte && titulo.endsWith(` - ${fonte}`)) titulo = titulo.slice(0, -(fonte.length + 3));
    const link = texto(campo(item, 'link'));
    const data = new Date(texto(campo(item, 'pubDate')));
    return { titulo, fonte: fonte || 'Notícia', link, data: isNaN(data) ? null : data.toISOString() };
  }).filter(n => n.titulo && /^https?:\/\//.test(n.link));
}

async function baixar({ fonte, url }) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (EmpresasAtivasBR; +https://www.empresasativas.online)' }, signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`${url} → HTTP ${resp.status}`);
  return lerRss(await resp.text(), fonte);
}

async function coluna(feeds) {
  const lidas = await Promise.allSettled(feeds.map(baixar));
  lidas.filter(r => r.status === 'rejected').forEach(r => console.warn('[noticias]', r.reason.message));
  const limite = Date.now() - 7 * 24 * 3600 * 1000;
  // Cada fonte ordenada da mais nova para a mais antiga; depois intercaladas (uma de cada)
  const listas = lidas.map(r => (r.status === 'fulfilled' ? r.value : [])
    .filter(n => !n.data || new Date(n.data).getTime() > limite)
    .sort((a, b) => (b.data || '').localeCompare(a.data || '')));
  const intercaladas = [];
  for (let i = 0; listas.some(l => i < l.length); i++) listas.forEach(l => l[i] && intercaladas.push(l[i]));
  const vistas = new Set();
  return intercaladas
    .filter(n => { const k = n.titulo.toLowerCase().replace(/\W+/g, '').slice(0, 60); return !vistas.has(k) && vistas.add(k); })
    .slice(0, POR_COLUNA);
}

router.get('/', async (_req, res, next) => {
  try {
    const dados = await comCache('noticias', async () => {
      const [economia, negocios] = await Promise.all([coluna(FEEDS.economia), coluna(FEEDS.negocios)]);
      return { economia, negocios, atualizado_em: new Date().toISOString() };
    }, CACHE_MS);
    res.set('Cache-Control', 'public, max-age=300').json(dados);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.lerRss = lerRss;
