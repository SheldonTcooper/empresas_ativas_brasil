const router = require('express').Router();
const { pool, comCache } = require('../lib/db');

// Códigos de porte_empresa da Receita: 00=Não informado, 01=Microempresa, 03=EPP, 05=Demais.
// MEI não é porte: vem de simples.opcao_mei = 'S'.
const PORTE = { '00':'NÃO INFORMADO','01':'ME','03':'EPP','05':'DEMAIS' };
const COD_PORTE = { 'ME':'01', 'EPP':'03', 'DEMAIS':'05' };

// Segmentos amigáveis = grupos de CNAEs
const SEGMENTOS = {
  hospedagem:     { nome: 'Hospedagem',     cnaes: ['5510801','5510802','5510803','5590601','5590602','5590603','5590699'] },
  bancos:         { nome: 'Bancos',         cnaes: ['6421200','6422100','6423900','6431000','6432800','6433600'] },
  securitizadora: { nome: 'Securitizadora', cnaes: ['6492100'] },
};

// Ordenações aceitas (?ordem=nome|abertura|bairro|porte & dir=asc|desc)
const ORDENS = {
  // "01.363.328 FULANO" (MEI com CNPJ no nome) ordena pelo nome, não pelo número
  nome:     `regexp_replace(e.razao_social, '^[0-9]{2}[.][0-9]{3}[.][0-9]{3} *', '')`,
  abertura: `est.data_inicio_atividade`,
  bairro:   `NULLIF(trim(est.bairro), '')`,
  porte:    `CASE WHEN s.opcao_mei = 'S' THEN 0 ELSE CASE e.porte_empresa WHEN '01' THEN 1 WHEN '03' THEN 2 WHEN '05' THEN 3 ELSE 4 END END`,
};

// E-mail de escritório de contabilidade (não é contato da empresa)
const RE_CONTADOR_SQL = '(contab|contador|escritorio|assessoria)';

const ACENTOS = 'áàâãäéèêëíìîïóòôõöúùûüç';
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuuc';
const semAcentoSql = col => `translate(lower(coalesce(${col}, '')), '${ACENTOS}', '${SEM_ACENTO}')`;
const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* Telefone da Receita → { fmt: '(41) 99609-4136', wpp: 'https://wa.me/5541996094136' }
   Celulares antigos vêm com 8 dígitos (sem o 9); fixos não ganham link de WhatsApp. */
function normTel(ddd, tel) {
  const d = String(ddd || '').replace(/\D/g, '').replace(/^0+/, '');
  let n   = String(tel || '').replace(/\D/g, '');
  if (d.length !== 2 || n.length < 8) return null;
  if (n.length === 8 && /^[6-9]/.test(n)) n = '9' + n;
  if (/^(\d)\1+$/.test(n.slice(1))) return null;           // 33333333, 999999999…
  if (n.length === 9 && n[0] === '9')
    return { fmt: `(${d}) ${n.slice(0,5)}-${n.slice(5)}`, wpp: `https://wa.me/55${d}${n}` };
  if (n.length === 8 && /^[2-5]/.test(n))
    return { fmt: `(${d}) ${n.slice(0,4)}-${n.slice(4)}`, wpp: '' };
  return null;
}

/* Monta o WHERE a partir da query string. Todo filtro vale para a base inteira
   (não só para a página carregada), e a contagem usa exatamente o mesmo WHERE.

   Escopo:   municipio=7535  ou  estado=PR (estado inteiro)
   Atividade: cnae=5611201[,…] (aceita 5611-2/01)  ou  segmento=hospedagem
             secundario=1 → também procura no CNAE secundário
   Filtros:  q, porte, abertura_dias, bairro, tipo, tem_telefone, tem_whatsapp,
             tem_email, sem_contador                                              */
function montarFiltro(q, { soEscopo = false } = {}) {
  const where  = [
    `est.situacao_cadastral = '02'`,
    // CNPJs ocultados a pedido do titular (LGPD) — ver routes/remocao.js
    `NOT EXISTS (SELECT 1 FROM cnpj_oculto o WHERE o.cnpj = est.cnpj_basico || est.cnpj_ordem || est.cnpj_dv)`,
  ];
  const params = [];
  const p = v => { params.push(v); return `$${params.length}`; };

  const municipio = parseInt(q.municipio) || null;
  const uf = String(q.estado || '').toUpperCase();
  if (municipio)                where.push(`est.municipio = ${p(municipio)}`);
  else if (/^[A-Z]{2}$/.test(uf)) where.push(`est.uf = ${p(uf)}`);
  else return { erro: 'Informe municipio ou estado (UF).' };

  let cnaes;
  if (q.segmento) {
    cnaes = SEGMENTOS[String(q.segmento).toLowerCase()]?.cnaes;
    if (!cnaes) return { erro: `Segmento inválido. Use: ${Object.keys(SEGMENTOS).join(', ')}` };
  } else {
    cnaes = String(q.cnae || '').split(',').map(c => c.replace(/\D/g, '')).filter(c => c.length === 7);
    if (!cnaes.length) return { erro: 'Informe cnae (7 dígitos, ex. 5611201 ou 5611-2/01) ou segmento.' };
  }
  const principal = `est.cnae_fiscal = ANY(${p(cnaes)}::bpchar[])`;
  where.push(q.secundario === '1'
    ? `(${principal} OR string_to_array(est.cnae_fiscal_secundaria, ',') && ${p(cnaes)}::text[])`
    : principal);

  if (soEscopo) return { where, params, cnaes };

  const texto = norm(q.q);
  if (texto) {
    const like = p(`%${texto.replace(/[\\%_]/g, '\\$&')}%`);   // % e _ digitados são literais
    const conds = ['e.razao_social', 'est.nome_fantasia', 'est.bairro', 'est.correio_eletronico']
      .map(col => `${semAcentoSql(col)} LIKE ${like}`);
    const digitos = texto.replace(/\D/g, '');
    if (digitos.length >= 3 && /^[\d\s./-]+$/.test(texto))
      conds.push(`(est.cnpj_basico || est.cnpj_ordem || est.cnpj_dv) LIKE ${p(`%${digitos}%`)}`);
    where.push(`(${conds.join(' OR ')})`);
  }

  const porte = String(q.porte || '').toUpperCase();
  if (porte === 'MEI') where.push(`s.opcao_mei = 'S'`);
  else if (COD_PORTE[porte]) where.push(`e.porte_empresa = ${p(COD_PORTE[porte])} AND s.opcao_mei IS DISTINCT FROM 'S'`);

  const dias = parseInt(q.abertura_dias);
  if (dias > 0) where.push(`est.data_inicio_atividade >= CURRENT_DATE - ${p(Math.min(dias, 36500))}::int`);

  if (q.bairro) where.push(`upper(trim(est.bairro)) = ${p(String(q.bairro).toUpperCase().trim())}`);

  if (q.tipo === 'matriz') where.push(`est.identificador_matriz_filial = '1'`);
  if (q.tipo === 'filial') where.push(`est.identificador_matriz_filial = '2'`);

  // Mesmas regras de normTel(): celular = 9 dígitos com 9 ou 8 dígitos 6–9; fixo = 8 dígitos 2–5;
  // números com todos os dígitos iguais (33333333) não contam
  const digitos = col => `regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g')`;
  const naoRepetido = col => `right(${digitos(col)}, 8) !~ '^(.)\\1+$'`;
  const celular = col => `(${digitos(col)} ~ '^(9[0-9]{8}|[6-9][0-9]{7})$' AND ${naoRepetido(col)})`;
  const telValido = col => `(${digitos(col)} ~ '^(9[0-9]{8}|[6-9][0-9]{7}|[2-5][0-9]{7})$' AND ${naoRepetido(col)})`;
  if (q.tem_telefone === '1') where.push(`(${telValido('est.telefone1')} OR ${telValido('est.telefone2')})`);
  if (q.tem_whatsapp === '1') where.push(`(${celular('est.telefone1')} OR ${celular('est.telefone2')})`);
  if (q.tem_email === '1')    where.push(`coalesce(trim(est.correio_eletronico), '') <> ''`);
  if (q.sem_contador === '1') where.push(`coalesce(est.correio_eletronico, '') !~* '${RE_CONTADOR_SQL}'`);

  return { where, params, cnaes };
}

const FILTROS_EXTRAS = ['q', 'porte', 'abertura_dias', 'bairro', 'tipo', 'tem_telefone', 'tem_whatsapp', 'tem_email', 'sem_contador', 'secundario', 'segmento'];

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
  return {
    maps:      `https://www.google.com/maps/search/?api=1&query=${endq}`,
    linkedin:  `https://www.linkedin.com/search/results/companies/?keywords=${nq}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${nq}`,
    tiktok:    `https://www.tiktok.com/search?q=${nq}`,
    facebook:  `https://www.facebook.com/search/pages/?q=${nq}`,
  };
}

function fmtDate(d) {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString().slice(0,10) : String(d);
  const [y,m,day] = s.slice(0,10).split('-');
  return `${day}/${m}/${y}`;
}

const FROM_EMPRESAS = `
  FROM estabelecimento est
  JOIN empresa e        ON e.cnpj_basico = est.cnpj_basico
  LEFT JOIN simples s   ON s.cnpj_basico = est.cnpj_basico`;

/* ── GET /api/empresas ── lista paginada com filtros (ver montarFiltro) ── */
router.get('/', async (req, res, next) => {
  const { page = 1, limit = 50, municipioNome = '' } = req.query;
  const filtro = montarFiltro(req.query);
  if (filtro.erro) return res.status(400).json({ error: filtro.erro });

  const lim    = Math.min(parseInt(limit) || 50, 200);
  const pg     = Math.max(parseInt(page) || 1, 1);
  const offset = (pg - 1) * lim;

  const ordem = ORDENS[req.query.ordem] ? req.query.ordem : 'nome';
  const dir   = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const where = filtro.where.join('\n          AND ');
  const nP    = filtro.params.length;

  try {
    const [data, count] = await Promise.all([
      pool.query(`
        SELECT
          e.cnpj_basico, est.cnpj_ordem, est.cnpj_dv,
          e.razao_social,   est.nome_fantasia,
          est.identificador_matriz_filial,
          est.data_inicio_atividade,
          e.porte_empresa,
          s.opcao_mei,
          est.cnae_fiscal,
          est.tipo_logradouro, est.logradouro, est.numero,
          est.complemento,  est.bairro, est.cep, est.uf,
          COALESCE(m.descricao, est.municipio::text) AS municipio_nome,
          est.ddd1, est.telefone1, est.ddd2, est.telefone2,
          est.correio_eletronico
        ${FROM_EMPRESAS}
        LEFT JOIN municipio m ON m.codigo = est.municipio
        WHERE ${where}
        ORDER BY ${ORDENS[ordem]} ${dir} NULLS LAST, est.cnpj_basico, est.cnpj_ordem
        LIMIT $${nP + 1} OFFSET $${nP + 2}
      `, [...filtro.params, lim, offset]),

      pool.query(`SELECT COUNT(*) AS total ${FROM_EMPRESAS} WHERE ${where}`, filtro.params),
    ]);

    const empresas = data.rows.map(r => {
      const t1 = normTel(r.ddd1, r.telefone1);
      const t2 = normTel(r.ddd2, r.telefone2);
      return {
        cnpj:     fmtCNPJ(r.cnpj_basico, r.cnpj_ordem, r.cnpj_dv),
        razao:    r.razao_social?.trim() || '',
        fantasia: r.nome_fantasia?.trim() || '',
        tipo:     r.identificador_matriz_filial === '1' ? 'MATRIZ' : 'FILIAL',
        abertura: fmtDate(r.data_inicio_atividade),
        porte:    r.opcao_mei === 'S' ? 'MEI' : (PORTE[r.porte_empresa] || 'NÃO INFORMADO'),
        cnae:     r.cnae_fiscal || '',
        logr:     `${r.tipo_logradouro || ''} ${r.logradouro || ''}`.trim(),
        num:      r.numero || '',
        compl:    r.complemento?.trim() || '',
        bairro:   r.bairro?.trim() || '',
        cep:      r.cep ? `${r.cep.slice(0,5)}-${r.cep.slice(5)}` : '',
        municipio:r.municipio_nome || '',
        uf:       r.uf || '',
        tel1: t1?.fmt || '',
        tel2: t2?.fmt || '',
        email: (r.correio_eletronico || '').toLowerCase().trim(),
        site:  '',
        ...buildLinks(r),
        wpp:  t1?.wpp || t2?.wpp || '',
      };
    });

    const total = parseInt(count.rows[0].total);

    /* DB vazio → tenta Brasil.io como fallback (só na busca simples: 1 CNAE, 1 município, sem filtros) */
    const buscaSimples = req.query.municipio && filtro.cnaes.length === 1 && !FILTROS_EXTRAS.some(k => req.query[k]);
    if (total === 0 && municipioNome && buscaSimples) {
      try {
        const bl = await fetchBrasilio(municipioNome, filtro.cnaes[0], pg, lim);
        if (bl.total > 0) return res.json({ ...bl, source: 'brasilio' });
      } catch (blErr) {
        console.warn('[Brasil.io] Indisponível:', blErr.message);
      }
    }

    res.json({
      total,
      page:    pg,
      limit:   lim,
      ordem,
      dir:     dir.toLowerCase(),
      empresas,
      source: total > 0 ? 'db' : 'empty',
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/empresas/bairros?municipio=…&cnae=… ── bairros do escopo, por volume ── */
router.get('/bairros', async (req, res, next) => {
  const filtro = montarFiltro(req.query, { soEscopo: true });
  if (filtro.erro) return res.status(400).json({ error: filtro.erro });
  try {
    const { rows } = await pool.query(`
      SELECT upper(trim(est.bairro)) AS bairro, COUNT(*) AS total
      FROM estabelecimento est
      WHERE ${filtro.where.join(' AND ')} AND coalesce(trim(est.bairro), '') <> ''
      GROUP BY 1
      ORDER BY total DESC, bairro
      LIMIT 500
    `, filtro.params);
    res.json(rows.map(r => ({ bairro: r.bairro, total: parseInt(r.total) })));
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/empresas/segmentos ── grupos de CNAE prontos ── */
router.get('/segmentos', (_req, res) => {
  res.json(Object.entries(SEGMENTOS).map(([id, s]) => ({ id, nome: s.nome, cnaes: s.cnaes })));
});

/* ── GET /api/cidades?estado=SP ── lista cidades por estado ── */
router.get('/cidades', async (req, res, next) => {
  const estado = String(req.query.estado || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(estado)) return res.status(400).json({ error: 'Parâmetro obrigatório: estado' });

  try {
    res.json(await listarCidades(estado));
  } catch (err) {
    next(err);
  }
});

function listarCidades(estado) {
  return comCache(`cidades:${estado}`, async () => (await pool.query(`
    SELECT DISTINCT est.municipio AS codigo, COALESCE(m.descricao, est.municipio::text) AS municipio
    FROM estabelecimento est
    LEFT JOIN municipio m ON m.codigo = est.municipio
    WHERE est.uf = $1 AND est.situacao_cadastral = '02'
    ORDER BY municipio
  `, [estado])).rows.map(r => ({ municipio: r.municipio, codigo: r.codigo })));
}

/* ── GET /api/cnaes?estado=SP&municipio=3550308 ── CNAEs com quantidade de empresas, do maior para o menor ── */
router.get('/cnaes', async (req, res, next) => {
  const municipio = parseInt(req.query.municipio) || null;
  const estado    = String(req.query.estado || '').toUpperCase();
  if (!municipio && !/^[A-Z]{2}$/.test(estado))
    return res.status(400).json({ error: 'Informe municipio ou estado (UF).' });

  try {
    res.json(await listarCnaes(municipio ? { municipio } : { estado }));
  } catch (err) {
    next(err);
  }
});

function listarCnaes({ municipio, estado }) {
  const [col, valor] = municipio ? ['est.municipio', municipio] : ['est.uf', estado];
  return comCache(`cnaes:${col}:${valor}`, async () => (await pool.query(`
    SELECT est.cnae_fiscal, c.descricao, COUNT(*) AS total
    FROM estabelecimento est
    LEFT JOIN cnae c ON c.codigo = est.cnae_fiscal
    WHERE ${col} = $1 AND est.situacao_cadastral = '02'
      AND NOT EXISTS (SELECT 1 FROM cnpj_oculto o WHERE o.cnpj = est.cnpj_basico || est.cnpj_ordem || est.cnpj_dv)
    GROUP BY est.cnae_fiscal, c.descricao
    ORDER BY total DESC, est.cnae_fiscal
    LIMIT 2000
  `, [valor])).rows.map(r => ({
    cnae: r.cnae_fiscal,
    descricao: r.descricao || 'Não classificado',
    total: parseInt(r.total),
  })));
}

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
        AND NOT EXISTS (SELECT 1 FROM cnpj_oculto o WHERE o.cnpj = $1 || $2 || $3)
    `, [basico, ordem, dv]);
    if (!rows.length) return res.status(404).json({ error: 'CNPJ não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
Object.assign(module.exports, { SEGMENTOS, montarFiltro, listarCidades, listarCnaes, FROM_EMPRESAS });
