const router = require('express').Router();
const { pool, comCache } = require('../lib/db');
const ESTADOS = require('../lib/estados');

/* Totais por UF: empresas ativas e aberturas nos últimos 30 dias.
   Varre a tabela inteira, então roda em segundo plano e fica em cache;
   enquanto não termina, a rota responde com os totais fixos de lib/estados.js. */
let totais = null;
function calcularTotais() {
  return comCache('estados:totais', async () => {
    const { rows } = await pool.query(`
      SELECT uf,
             COUNT(*) AS ativas,
             COUNT(*) FILTER (WHERE data_inicio_atividade >= CURRENT_DATE - 30) AS aberturas_30d
      FROM estabelecimento
      WHERE situacao_cadastral = '02'
      GROUP BY uf
    `);
    totais = Object.fromEntries(rows.map(r => [r.uf, { ativas: parseInt(r.ativas), aberturas_30d: parseInt(r.aberturas_30d) }]));
    return totais;
  });
}

/* ── GET /api/estados/info ── */
router.get('/info', (_req, res) => {
  calcularTotais().catch(err => console.error('[estados] totais:', err.message));
  res.json(ESTADOS.map(e => ({
    ...e,
    empresas_ativas: totais?.[e.uf]?.ativas ?? e.empresas_ativas,
    aberturas_30d:   totais?.[e.uf]?.aberturas_30d ?? null,
  })));
});

module.exports = router;
module.exports.calcularTotais = calcularTotais;
