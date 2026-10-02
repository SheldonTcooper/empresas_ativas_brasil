/* Páginas servidas pelo backend (não são API):
   • /:uf, /:uf/:cidade, /:uf/:cidade/:atividade — o painel (index.html) com título,
     descrição, canonical e um resumo em <noscript> próprios de cada página, para
     o link ser compartilhável e indexável ("Restaurantes ativos em Curitiba").
   • /sitemap.xml — estados, todas as cidades e as principais atividades das capitais.
   • /privacidade e /termos — páginas legais (LGPD).                                   */
const path = require('path');
const fs = require('fs');
const router = require('express').Router();
const { slug } = require('../lib/db');
const ESTADOS = require('../lib/estados');
const { listarCidades, listarCnaes } = require('./empresas');
const { SEGMENTOS, prepararSegmentos } = require('../lib/segmentos');

const SITE_URL = (process.env.SITE_URL || 'https://www.empresasativas.online').replace(/\/$/, '');
const PUBLIC = path.join(__dirname, '../../public');
const TEMPLATES = path.join(__dirname, '../paginas');

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const fmtNum = n => Number(n || 0).toLocaleString('pt-BR');
const fmtCnae = c => `${c.slice(0,4)}-${c.slice(4,5)}/${c.slice(5)}`;
const nomeProprio = s => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, p => p.toLowerCase());

let indexCache = null;
function indexHtml() {
  if (!indexCache || process.env.NODE_ENV === 'development') indexCache = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  return indexCache;
}

/* Resolve /pr/curitiba/5611201 → { estado, cidade, atividade, total } (ou null se não existir) */
async function resolver(ufParam, cidadeParam, atividadeParam) {
  const estado = ESTADOS.find(e => e.uf === String(ufParam).toUpperCase());
  if (!estado) return null;
  const r = { estado };
  if (!cidadeParam) return r;

  if (cidadeParam === 'todo-o-estado') r.cidade = null;
  else {
    const cidades = await listarCidades(estado.uf);
    r.cidade = cidades.find(c => slug(c.municipio) === cidadeParam);
    if (!r.cidade) return null;
  }
  r.temCidade = true;
  if (!atividadeParam) return r;

  const cnaes = await listarCnaes(r.cidade ? { municipio: r.cidade.codigo } : { estado: estado.uf });
  if (/^\d{7}$/.test(atividadeParam)) {
    const c = cnaes.find(x => x.cnae === atividadeParam);
    if (!c) return null;
    r.atividade = { nome: c.descricao, detalhe: `CNAE ${fmtCnae(c.cnae)}` };
    r.total = c.total;
  } else if (SEGMENTOS[atividadeParam]) {
    await prepararSegmentos();
    const s = SEGMENTOS[atividadeParam];
    r.atividade = { nome: s.nome, detalhe: s.cnaes.length <= 6 ? `CNAEs ${s.cnaes.map(fmtCnae).join(', ')}` : `${s.cnaes.length} atividades CNAE` };
    r.total = cnaes.filter(x => s.cnaes.includes(x.cnae)).reduce((t, x) => t + x.total, 0);
  } else return null;
  return r;
}

function montarMeta(r, url) {
  const uf = r.estado.uf, lugar = r.cidade ? `${nomeProprio(r.cidade.municipio)} (${uf})` : `${r.estado.nome}`;
  if (r.atividade) return {
    titulo: `${r.atividade.nome} em ${lugar}: ${fmtNum(r.total)} empresas ativas | EmpresasAtivasBR`,
    descricao: `Lista de ${fmtNum(r.total)} empresas ativas de ${r.atividade.nome} (${r.atividade.detalhe}) em ${lugar}, com telefone, e-mail e endereço. Dados abertos da Receita Federal.`,
    url,
  };
  if (r.temCidade) return {
    titulo: `Empresas ativas em ${lugar} por atividade (CNAE) | EmpresasAtivasBR`,
    descricao: `Encontre empresas ativas em ${lugar} por atividade econômica (CNAE) e segmento, com telefone, e-mail e endereço. Dados abertos da Receita Federal.`,
    url,
  };
  return {
    titulo: `Empresas ativas em ${r.estado.nome} (${uf}) por cidade e atividade | EmpresasAtivasBR`,
    descricao: `Empresas ativas em ${r.estado.nome} por município e atividade (CNAE), com telefone, e-mail e endereço. Dados abertos da Receita Federal.`,
    url,
  };
}

/* Resumo para buscadores e para quem está sem JavaScript: texto + links internos */
async function montarResumo(r) {
  const base = `/${r.estado.uf.toLowerCase()}`;
  const titulo = r.atividade
    ? `${r.atividade.nome} em ${r.cidade ? nomeProprio(r.cidade.municipio) + '/' + r.estado.uf : r.estado.nome}`
    : r.temCidade ? `Empresas ativas em ${r.cidade ? nomeProprio(r.cidade.municipio) + '/' + r.estado.uf : r.estado.nome}`
    : `Empresas ativas em ${r.estado.nome}`;
  let links = [];
  if (r.temCidade && !r.atividade) {
    const cnaes = await listarCnaes(r.cidade ? { municipio: r.cidade.codigo } : { estado: r.estado.uf });
    const cid = r.cidade ? slug(r.cidade.municipio) : 'todo-o-estado';
    links = cnaes.slice(0, 40).map(c => [`${base}/${cid}/${c.cnae}`, `${c.descricao} (${fmtNum(c.total)})`]);
  } else if (!r.temCidade) {
    const cidades = await listarCidades(r.estado.uf);
    links = cidades.slice(0, 400).map(c => [`${base}/${slug(c.municipio)}`, nomeProprio(c.municipio)]);
  }
  return `<noscript><div style="padding:24px;color:#e8ebf7;font-family:sans-serif">
<h2>${esc(titulo)}</h2>
${r.total != null ? `<p>${fmtNum(r.total)} empresas ativas encontradas. Ative o JavaScript para ver a lista com contatos e filtros.</p>` : ''}
${links.length ? `<ul>${links.map(([h, t]) => `<li><a href="${esc(h)}">${esc(t)}</a></li>`).join('')}</ul>` : ''}
</div></noscript>`;
}

function aplicarMeta(html, meta, { noindex = false, resumo = '' } = {}) {
  const t = esc(meta.titulo), d = esc(meta.descricao), u = esc(meta.url);
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${u}$2`)
    .replace('</head>', `<link rel="canonical" href="${u}">\n${noindex ? '<meta name="robots" content="noindex,follow">\n' : ''}</head>`)
    .replace('<body>', `<body>\n${resumo}`);
}

/* ── /:uf[/:cidade[/:atividade]] ── */
router.get(/^\/([a-zA-Z]{2})(?:\/([a-z0-9-]+))?(?:\/([a-z0-9-]+))?\/?$/, async (req, res, next) => {
  try {
    const [uf, cidade, atividade] = [req.params[0], req.params[1], req.params[2]];
    const r = await resolver(uf, cidade, atividade);
    const caminho = req.path.replace(/\/$/, '').toLowerCase();
    if (!r) {
      return res.status(404).type('html').send(aplicarMeta(indexHtml(),
        { titulo: 'Página não encontrada | EmpresasAtivasBR', descricao: 'Esta página não existe.', url: SITE_URL + caminho },
        { noindex: true }));
    }
    const meta = montarMeta(r, SITE_URL + caminho);
    // Filtros e páginas na query string (?porte=MEI&pagina=2) não são indexados
    const noindex = Object.keys(req.query).length > 0;
    res.type('html').send(aplicarMeta(indexHtml(), meta, { noindex, resumo: await montarResumo(r) }));
  } catch (err) {
    next(err);
  }
});

/* ── /sitemap.xml ── */
router.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const urls = ['/', '/privacidade', '/termos'];
    for (const e of ESTADOS) {
      const uf = e.uf.toLowerCase();
      urls.push(`/${uf}`, `/${uf}/todo-o-estado`);
      const cidades = await listarCidades(e.uf);
      for (const c of cidades) urls.push(`/${uf}/${slug(c.municipio)}`);
      // Capitais: as 30 atividades com mais empresas + segmentos
      const capital = cidades.find(c => slug(c.municipio) === slug(e.capital));
      if (capital) {
        const cnaes = await listarCnaes({ municipio: capital.codigo });
        for (const c of cnaes.slice(0, 30)) urls.push(`/${uf}/${slug(capital.municipio)}/${c.cnae}`);
        for (const id of Object.keys(SEGMENTOS)) urls.push(`/${uf}/${slug(capital.municipio)}/${id}`);
      }
    }
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.slice(0, 50000).map(u => `  <url><loc>${esc(SITE_URL + u)}</loc></url>`).join('\n') +
      `\n</urlset>\n`);
  } catch (err) {
    next(err);
  }
});

/* ── /privacidade e /termos ──
   Responsável e contato vêm do .env (SITE_RESPONSAVEL, SITE_EMAIL_CONTATO). */
function paginaLegal(arquivo) {
  return (_req, res, next) => {
    try {
      const responsavel = process.env.SITE_RESPONSAVEL || 'o responsável pelo EmpresasAtivasBR';
      const contato = process.env.SITE_EMAIL_CONTATO
        ? `pelo e-mail <a href="mailto:${esc(process.env.SITE_EMAIL_CONTATO)}">${esc(process.env.SITE_EMAIL_CONTATO)}</a> ou pelo formulário abaixo`
        : 'pelo formulário abaixo';
      const html = fs.readFileSync(path.join(TEMPLATES, arquivo), 'utf8')
        .replaceAll('{{RESPONSAVEL}}', esc(responsavel))
        .replaceAll('{{CONTATO}}', contato)
        .replaceAll('{{SITE_URL}}', esc(SITE_URL));
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  };
}
router.get('/privacidade', paginaLegal('privacidade.html'));
router.get('/termos', paginaLegal('termos.html'));

/* Pré-aquece o cache (municípios e CNAEs de cada estado e da capital), um estado por vez,
   para que mapa, listas e sitemap respondam rápido já na primeira visita. */
async function aquecerCache() {
  const t0 = Date.now();
  for (const e of ESTADOS) {
    try {
      const cidades = await listarCidades(e.uf);
      await listarCnaes({ estado: e.uf });
      const capital = cidades.find(c => slug(c.municipio) === slug(e.capital));
      if (capital) await listarCnaes({ municipio: capital.codigo });
    } catch (err) {
      console.error(`[cache] ${e.uf}:`, err.message);
    }
  }
  console.log(`[cache] aquecido em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

module.exports = router;
module.exports.aquecerCache = aquecerCache;
