const router = require('express').Router();
const { pool, comCache } = require('../lib/db');
const { VALIDADE_DIAS } = require('../lib/enriquecer');

// Códigos de porte_empresa da Receita: 00=Não informado, 01=Microempresa, 03=EPP, 05=Demais.
// MEI não é porte: vem de simples.opcao_mei = 'S'.
const PORTE = { '00':'NÃO INFORMADO','01':'ME','03':'EPP','05':'DEMAIS' };
const COD_PORTE = { 'ME':'01', 'EPP':'03', 'DEMAIS':'05' };

// Segmentos amigáveis = grupos de CNAEs (lib/segmentos.js)
const { SEGMENTOS, prepararSegmentos } = require('../lib/segmentos');

// Ordenações aceitas (?ordem=nome|abertura|bairro|porte & dir=asc|desc)
const ORDENS = {
  // nome_ordem: razão social sem o CNPJ que o MEI leva no início ("01.363.328 FULANO" → "FULANO")
  nome:     `est.nome_ordem`,
  abertura: `est.data_inicio_atividade`,
  bairro:   `NULLIF(trim(est.bairro), '')`,
  porte:    `CASE WHEN est.opcao_mei = 'S' THEN 0 ELSE CASE est.porte_empresa WHEN '01' THEN 1 WHEN '03' THEN 2 WHEN '05' THEN 3 ELSE 4 END END`,
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
    if (!cnaes.length) cnaes = ['0000000'];   // segmento sem atividades nesta base: resultado vazio
  } else {
    cnaes = String(q.cnae || '').split(',').map(c => c.replace(/\D/g, '')).filter(c => c.length === 7);
    if (!cnaes.length) return { erro: 'Informe cnae (7 dígitos, ex. 5611201 ou 5611-2/01) ou segmento.' };
  }
  const principal = cnaes.length === 1 ? `est.cnae_fiscal = ${p(cnaes[0])}` : `est.cnae_fiscal = ANY(${p(cnaes)}::bpchar[])`;
  where.push(q.secundario === '1'
    ? `(${principal} OR string_to_array(est.cnae_fiscal_secundaria, ',') && ${p(cnaes)}::text[])`
    : principal);

  if (soEscopo) return { where, params, cnaes };

  const texto = norm(q.q);
  if (texto) {
    const like = p(`%${texto.replace(/[\\%_]/g, '\\$&')}%`);   // % e _ digitados são literais
    const conds = ['est.razao_social', 'est.nome_fantasia', 'est.bairro', 'est.correio_eletronico']
      .map(col => `${semAcentoSql(col)} LIKE ${like}`);
    const digitos = texto.replace(/\D/g, '');
    if (digitos.length >= 3 && /^[\d\s./-]+$/.test(texto))
      conds.push(`(est.cnpj_basico || est.cnpj_ordem || est.cnpj_dv) LIKE ${p(`%${digitos}%`)}`);
    where.push(`(${conds.join(' OR ')})`);
  }

  const porte = String(q.porte || '').toUpperCase();
  if (porte === 'MEI') where.push(`est.opcao_mei = 'S'`);
  else if (COD_PORTE[porte]) where.push(`est.porte_empresa = ${p(COD_PORTE[porte])} AND est.opcao_mei IS DISTINCT FROM 'S'`);

  // Regime tributário (tabela simples). "fora" = não optante: Lucro Presumido, Real ou Arbitrado
  // (a Receita não publica mais qual dos três)
  const regime = String(q.regime || '').toLowerCase();
  if (regime === 'simples') where.push(`est.opcao_pelo_simples = 'S'`);
  else if (regime === 'mei') where.push(`est.opcao_mei = 'S'`);
  else if (regime === 'fora') where.push(`est.opcao_pelo_simples IS DISTINCT FROM 'S'`);

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

const FILTROS_EXTRAS = ['q', 'porte', 'regime', 'abertura_dias', 'bairro', 'tipo', 'tem_telefone', 'tem_whatsapp', 'tem_email', 'sem_contador', 'secundario', 'segmento'];

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

const limpa = v => String(v || '').replace(/\s+/g, ' ').trim();

// Nome para buscar a empresa: fantasia ou razão social sem o CNPJ que o MEI leva no início
function nomeBusca(r) {
  return limpa(r.nome_fantasia) || limpa(r.razao_social).replace(/^\d{2}\.\d{3}\.\d{3}\s*/, '');
}

// "RUA" + "INAJA" + "1249" → "RUA INAJA, 1249" (sem complemento e sem "SN", que confundem o Maps)
function enderecoBusca(r) {
  const rua = limpa(`${r.tipo_logradouro || ''} ${r.logradouro || ''}`);
  let num = limpa(r.numero);
  if (/^(s\/?n|sn|s\.n\.?|0+)$/i.test(num) || rua.endsWith(` ${num}`)) num = '';
  const cep = r.cep && /^\d{8}$/.test(r.cep) ? `${r.cep.slice(0,5)}-${r.cep.slice(5)}` : '';
  return [rua, num, limpa(r.bairro), `${limpa(r.municipio_nome)} - ${r.uf}`, cep].filter(Boolean).join(', ');
}

function buildLinks(r) {
  const nome = nomeBusca(r);
  const nq   = encodeURIComponent(nome);
  const cidade = `${limpa(r.municipio_nome)} ${r.uf || ''}`.trim();
  return {
    // nome + endereço: o Maps abre a ficha do negócio quando existe, ou cai no endereço
    maps:      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([nome, enderecoBusca(r)].filter(Boolean).join(', '))}`,
    google:    `https://www.google.com/search?q=${encodeURIComponent(`${nome} ${cidade}`)}`,
    linkedin:  `https://www.linkedin.com/search/results/companies/?keywords=${nq}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${nq}`,
    tiktok:    `https://www.tiktok.com/search?q=${nq}`,
    facebook:  `https://www.facebook.com/search/pages/?q=${encodeURIComponent(`${nome} ${limpa(r.municipio_nome)}`)}`,
  };
}

function formatarEnriq(r) {
  return {
    site: r.site, instagram: r.instagram, facebook: r.facebook, linkedin: r.linkedin,
    confianca: r.confianca, resumo: r.resumo, status: r.status,
    em: r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em,
  };
}

function fmtDate(d) {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString().slice(0,10) : String(d);
  const [y,m,day] = s.slice(0,10).split('-');
  return `${day}/${m}/${y}`;
}

// Tabela "busca" (db/otimizar_busca.sql): só empresas ativas, já com razão social, porte e Simples/MEI
const FROM_EMPRESAS = `
  FROM busca est`;

/* ── GET /api/empresas ── lista paginada com filtros (ver montarFiltro) ── */
router.get('/', async (req, res, next) => {
  const { page = 1, limit = 50, municipioNome = '' } = req.query;
  if (req.query.segmento) { try { await prepararSegmentos(); } catch (err) { return next(err); } }
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
          est.cnpj_basico, est.cnpj_ordem, est.cnpj_dv,
          est.razao_social, est.nome_fantasia,
          est.identificador_matriz_filial,
          est.data_inicio_atividade,
          est.porte_empresa,
          est.opcao_mei, est.opcao_pelo_simples,
          est.cnae_fiscal,
          est.tipo_logradouro, est.logradouro, est.numero,
          est.complemento,  est.bairro, est.cep, est.uf,
          COALESCE(m.descricao, est.municipio::text) AS municipio_nome,
          est.ddd1, est.telefone1, est.ddd2, est.telefone2,
          est.correio_eletronico
        ${FROM_EMPRESAS}
        LEFT JOIN municipio m ON m.codigo = est.municipio
        WHERE ${where}
        ORDER BY ${ORDENS[ordem]} ${dir}${ordem === 'nome' ? '' : ' NULLS LAST'}, est.cnpj_basico ${dir}, est.cnpj_ordem ${dir}
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
        regime:   r.opcao_mei === 'S' ? 'MEI' : r.opcao_pelo_simples === 'S' ? 'SIMPLES' : 'FORA DO SIMPLES',
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
        enriq: null,
      };
    });

    // Site e perfis já encontrados pela IA (válidos por VALIDADE_DIAS dias)
    if (empresas.length) {
      const cnpjs = data.rows.map(r => r.cnpj_basico + r.cnpj_ordem + r.cnpj_dv);
      const { rows: enr } = await pool.query(`
        SELECT cnpj, site, instagram, facebook, linkedin, confianca, resumo, status, criado_em
        FROM enriquecimento WHERE cnpj = ANY($1::bpchar[]) AND criado_em > now() - make_interval(days => $2)`, [cnpjs, VALIDADE_DIAS]);
      const porCnpj = Object.fromEntries(enr.map(r => [r.cnpj, formatarEnriq(r)]));
      empresas.forEach((e, i) => { e.enriq = porCnpj[cnpjs[i]] || null; });
    }

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
  if (req.query.segmento) { try { await prepararSegmentos(); } catch (err) { return next(err); } }
  const filtro = montarFiltro(req.query, { soEscopo: true });
  if (filtro.erro) return res.status(400).json({ error: filtro.erro });
  try {
    const { rows } = await pool.query(`
      SELECT upper(trim(est.bairro)) AS bairro, COUNT(*) AS total
      FROM busca est
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
router.get('/segmentos', async (_req, res, next) => {
  try {
    await prepararSegmentos();
    res.json(Object.entries(SEGMENTOS).map(([id, s]) => ({ id, nome: s.nome, cnaes: s.cnaes })));
  } catch (err) {
    next(err);
  }
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
    SELECT d.codigo, COALESCE(m.descricao, d.codigo::text) AS municipio
    FROM (SELECT DISTINCT municipio AS codigo FROM busca WHERE uf = $1) d
    LEFT JOIN municipio m ON m.codigo = d.codigo
    ORDER BY 2
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
  return comCache(`cnaes:${col}:${valor}`, async () => {
    // Contagem lida só do índice (municipio|uf, cnae_fiscal, …) da tabela busca;
    // os CNPJs ocultados (LGPD) são poucos e descontados à parte
    const [contagem, ocultos, descricoes] = await Promise.all([
      pool.query(`
        SELECT est.cnae_fiscal, COUNT(*) AS total
        FROM busca est
        WHERE ${col} = $1
        GROUP BY est.cnae_fiscal`, [valor]),
      pool.query(`
        SELECT est.cnae_fiscal, COUNT(*) AS total
        FROM cnpj_oculto o
        JOIN busca est ON est.cnpj_basico = substr(o.cnpj, 1, 8) AND est.cnpj_ordem = substr(o.cnpj, 9, 4) AND est.cnpj_dv = substr(o.cnpj, 13, 2)
        WHERE ${col} = $1
        GROUP BY est.cnae_fiscal`, [valor]),
      descricoesCnae(),
    ]);
    const menos = Object.fromEntries(ocultos.rows.map(r => [r.cnae_fiscal, parseInt(r.total)]));
    return contagem.rows
      .map(r => ({ cnae: r.cnae_fiscal, descricao: descricoes[r.cnae_fiscal] || 'Não classificado', total: parseInt(r.total) - (menos[r.cnae_fiscal] || 0) }))
      .filter(r => r.total > 0)
      .sort((x, y) => (y.total - x.total) || x.cnae.localeCompare(y.cnae))
      .slice(0, 2000);
  });
}

function descricoesCnae() {
  return comCache('cnae:descricoes', async () =>
    Object.fromEntries((await pool.query('SELECT codigo, descricao FROM cnae')).rows.map(r => [r.codigo, r.descricao])));
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
