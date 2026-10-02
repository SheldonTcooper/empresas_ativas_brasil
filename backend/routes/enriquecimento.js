const router = require('express').Router();
const { pool } = require('../lib/db');
const { enriquecer, VALIDADE_DIAS } = require('../lib/enriquecer');

/* ── POST /api/enriquecer/:cnpj ── busca site e perfis públicos da empresa (Groq + web)
   Devolve o resultado salvo se tiver menos de 90 dias; ?forcar=1 pesquisa de novo. */
router.post('/:cnpj', async (req, res, next) => {
  const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
  const [basico, ordem, dv] = [cnpj.slice(0, 8), cnpj.slice(8, 12), cnpj.slice(12)];

  try {
    if (req.query.forcar !== '1') {
      const { rows } = await pool.query(`
        SELECT site, instagram, facebook, linkedin, confianca, resumo, status, criado_em
        FROM enriquecimento WHERE cnpj = $1 AND criado_em > now() - make_interval(days => $2)`, [cnpj, VALIDADE_DIAS]);
      if (rows.length) return res.json({ ...formatar(rows[0]), cache: true });
    }

    const { rows } = await pool.query(`
      SELECT est.*, COALESCE(m.descricao, est.municipio::text) AS municipio_nome, c.descricao AS cnae_descricao
      FROM busca est
      LEFT JOIN municipio m ON m.codigo = est.municipio
      LEFT JOIN cnae c ON c.codigo = est.cnae_fiscal
      WHERE est.cnpj_basico = $1 AND est.cnpj_ordem = $2 AND est.cnpj_dv = $3
        AND NOT EXISTS (SELECT 1 FROM cnpj_oculto o WHERE o.cnpj = $1 || $2 || $3)`, [basico, ordem, dv]);
    if (!rows.length) return res.status(404).json({ error: 'Empresa não encontrada' });

    res.json({ ...(await enriquecer(rows[0])), cache: false });
  } catch (err) {
    if (err.status === 429) {
      res.set('Retry-After', String(err.retryAfter || 30));
      return res.status(429).json({ error: err.message, retry_after: err.retryAfter || 30 });
    }
    next(err);
  }
});

function formatar(r) {
  return {
    site: r.site, instagram: r.instagram, facebook: r.facebook, linkedin: r.linkedin,
    confianca: r.confianca, resumo: r.resumo, status: r.status,
    em: r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em,
  };
}

module.exports = router;
module.exports.formatar = formatar;
