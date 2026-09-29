const router = require('express').Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

const PORTE = { '00':'Não Informado','01':'MEI','03':'ME','05':'EPP','07':'Demais' };

/* ── Brasil.io fallback ─────────────────────────────────────────────── */
function normNome(nome) {
  return (nome || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function fmtCNPJStr(s) {
  const c = (s || '').replace(/\D/g, '').padStart(14, '0');
  return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
}

async function fetchBrasilio(municipioNome, cnae, page, limit) {
  const nome = normNome(municipioNome);
  const url  = `https://brasil.io/api/v1/dataset/socios-brasil/empresas/data/?cnae_fiscal=${encodeURIComponent(cnae)}&municipio=${encodeURIComponent(nome)}&situacao_cadastral=ATIVA&page=${page}&page_size=${limit}`;
  const headers = {
    'User-Agent': 'empresas-ativas-brasil/1.0 (prospeccao)',
    'Accept': 'application/json',
  };
  if (process.env.BRASILIO_TOKEN) {
    headers['Authorization'] = `Token ${process.env.BRASILIO_TOKEN}`;
  }
  const res  = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Brasil.io HTTP ${res.status}`);
  const data = await res.json();
  const empresas = (data.results || []).map(r => {
    const nomeEmp = ((r.nome_fantasia || '') || r.razao_social || '').trim();
    const nq = encodeURIComponent(nomeEmp);
    return {
      cnpj:     fmtCNPJStr(r.cnpj),
      razao:    (r.razao_social || '').trim(),
      fantasia: (r.nome_fantasia || '').trim(),
      tipo:     r.tipo || '—',
      abertura: r.abertura || '',
      porte:    r.porte || '—',
      logr: '', num: '', compl: '', bairro: '', cep: '',
      municipio: r.municipio || municipioNome || '',
      uf:       r.uf || '',
      tel1: '', tel2: '', email: '', site: '',
      maps:      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nomeEmp + ' ' + (r.municipio || ''))}`,
      linkedin:  `https://www.linkedin.com/search/results/companies/?keywords=${nq}`,
      instagram: `https://www.instagram.com/explore/search/keyword/?q=${nq}`,
      tiktok:    `https://www.tiktok.com/search?q=${nq}`,
      facebook:  `https://www.facebook.com/search/pages/?q=${nq}`,
      wpp:       '',
    };
  });
  return { total: data.count || 0, page, limit, empresas };
}

function fmtCNPJ(b, o, d) {
  const s = b.padStart(8,'0') + o.padStart(4,'0') + d.padStart(2,'0');
  return `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}`;
}

function buildLinks(r) {
  const nome  = (r.nome_fantasia || r.razao_social).trim();
  const end   = [r.tipo_logradouro, r.logradouro, r.numero, r.complemento, r.bairro,
                 `${r.municipio_nome} - ${r.uf}`, r.cep].filter(Boolean).join(', ');
  const nq    = encodeURIComponent(nome);
  const endq  = encodeURIComponent(end);
  const tel   = ((r.ddd1 || '') + (r.telefone1 || '')).replace(/\D/g,'');
  return {
    maps:      `https://www.google.com/maps/search/?api=1&query=${endq}`,
    linkedin:  `https://www.linkedin.com/search/results/companies/?keywords=${nq}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${nq}`,
    tiktok:    `https://www.tiktok.com/search?q=${nq}`,
    facebook:  `https://www.facebook.com/search/pages/?q=${nq}`,
    wpp:       tel.length >= 10 ? `https://wa.me/55${tel}` : '',
  };
}

function fmtDate(d) {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString().slice(0,10) : String(d);
  const [y,m,day] = s.slice(0,10).split('-');
  return `${day}/${m}/${y}`;
}

/* ── GET /api/empresas?municipio=3550308&cnae=4711301&page=1&limit=50&municipioNome=Sao+Paulo ── */
router.get('/', async (req, res, next) => {
  const { municipio, cnae, page = 1, limit = 50, municipioNome = '' } = req.query;
  if (!municipio || !cnae)
    return res.status(400).json({ error: 'Parâmetros obrigatórios: municipio, cnae' });

  const lim    = Math.min(parseInt(limit) || 50, 200);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  try {
    const [data, count] = await Promise.all([
      pool.query(`
        SELECT
          e.cnpj_basico, est.cnpj_ordem, est.cnpj_dv,
          e.razao_social,   est.nome_fantasia,
          est.identificador_matriz_filial,
          est.data_inicio_atividade,
          e.porte_empresa,
          est.cnae_fiscal,
          est.tipo_logradouro, est.logradouro, est.numero,
          est.complemento,  est.bairro, est.cep, est.uf,
          COALESCE(m.descricao, est.municipio::text) AS municipio_nome,
          est.ddd1, est.telefone1, est.ddd2, est.telefone2,
          est.correio_eletronico
        FROM estabelecimento est
        JOIN empresa e   ON e.cnpj_basico = est.cnpj_basico
        LEFT JOIN municipio m ON m.codigo = est.municipio
        WHERE est.municipio        = $1
          AND est.cnae_fiscal      = $2
          AND est.situacao_cadastral = '02'
        ORDER BY e.razao_social
        LIMIT $3 OFFSET $4
      `, [municipio, cnae, lim, offset]),

      pool.query(`
        SELECT COUNT(*) AS total
        FROM estabelecimento est
        WHERE est.municipio = $1 AND est.cnae_fiscal = $2 AND est.situacao_cadastral = '02'
      `, [municipio, cnae]),
    ]);

    const empresas = data.rows.map(r => ({
      cnpj:     fmtCNPJ(r.cnpj_basico, r.cnpj_ordem, r.cnpj_dv),
      razao:    r.razao_social?.trim() || '',
      fantasia: r.nome_fantasia?.trim() || '',
      tipo:     r.identificador_matriz_filial === '1' ? 'MATRIZ' : 'FILIAL',
      abertura: fmtDate(r.data_inicio_atividade),
      porte:    PORTE[r.porte_empresa] || 'Não Informado',
      logr:     `${r.tipo_logradouro || ''} ${r.logradouro || ''}`.trim(),
      num:      r.numero || '',
      compl:    r.complemento?.trim() || '',
      bairro:   r.bairro?.trim() || '',
      cep:      r.cep ? `${r.cep.slice(0,5)}-${r.cep.slice(5)}` : '',
      municipio:r.municipio_nome || '',
      uf:       r.uf || '',
      tel1: r.ddd1?.trim() && r.telefone1?.trim()
        ? `(${r.ddd1.trim()}) ${r.telefone1.trim().slice(0,5)}-${r.telefone1.trim().slice(5)}`  : '',
      tel2: r.ddd2?.trim() && r.telefone2?.trim()
        ? `(${r.ddd2.trim()}) ${r.telefone2.trim().slice(0,5)}-${r.telefone2.trim().slice(5)}`  : '',
      email: (r.correio_eletronico || '').toLowerCase().trim(),
      site:  '',
      ...buildLinks(r),
    }));

    const total = parseInt(count.rows[0].total);

    /* DB vazio → tenta Brasil.io como fallback */
    if (total === 0 && municipioNome) {
      try {
        const bl = await fetchBrasilio(municipioNome, cnae, parseInt(page), lim);
        if (bl.total > 0) return res.json({ ...bl, source: 'brasilio' });
      } catch (blErr) {
        console.warn('[Brasil.io] Indisponível:', blErr.message);
      }
    }

    res.json({
      total,
      page:    parseInt(page),
      limit:   lim,
      empresas,
      source: total > 0 ? 'db' : 'empty',
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/cidades?estado=SP ── lista cidades por estado ── */
router.get('/cidades', async (req, res, next) => {
  const { estado } = req.query;
  if (!estado) return res.status(400).json({ error: 'Parâmetro obrigatório: estado' });

  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT est.municipio AS codigo, COALESCE(m.descricao, est.municipio::text) AS municipio
      FROM estabelecimento est
      LEFT JOIN municipio m ON m.codigo = est.municipio
      WHERE est.uf = $1 AND est.situacao_cadastral = '02'
      ORDER BY municipio
    `, [estado]);

    res.json(rows.map(r => ({ municipio: r.municipio, codigo: r.codigo })));
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/cnaes?estado=SP&municipio=3550308 ── lista CNAEs por cidade ── */
router.get('/cnaes', async (req, res, next) => {
  const { estado, municipio } = req.query;

  try {
    let query = `
      SELECT DISTINCT est.cnae_fiscal, c.descricao
      FROM estabelecimento est
      LEFT JOIN cnae c ON c.codigo = est.cnae_fiscal
      WHERE est.situacao_cadastral = '02'
    `;
    const params = [];

    if (municipio) {
      query += ` AND est.municipio = $1`;
      params.push(municipio);
    } else if (estado) {
      query += ` AND est.uf = $1`;
      params.push(estado);
    }

    query += ` ORDER BY est.cnae_fiscal LIMIT 2000`;

    const { rows } = await pool.query(query, params);

    res.json(rows.map(r => ({
      cnae: r.cnae_fiscal,
      descricao: r.descricao || 'Não classificado'
    })));
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/empresas/cnpj/:cnpj ── enriquecimento individual ── */
router.get('/cnpj/:cnpj', async (req, res, next) => {
  const raw = req.params.cnpj.replace(/\D/g,'');
  if (raw.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
  const basico = raw.slice(0,8), ordem = raw.slice(8,12), dv = raw.slice(12);
  try {
    const { rows } = await pool.query(`
      SELECT e.*, est.*, COALESCE(m.descricao, est.municipio::text) AS municipio_nome
      FROM estabelecimento est
      JOIN empresa e ON e.cnpj_basico = est.cnpj_basico
      LEFT JOIN municipio m ON m.codigo = est.municipio
      WHERE est.cnpj_basico=$1 AND est.cnpj_ordem=$2 AND est.cnpj_dv=$3
    `, [basico, ordem, dv]);
    if (!rows.length) return res.status(404).json({ error: 'CNPJ não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
