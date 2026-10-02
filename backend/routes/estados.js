const router = require('express').Router();
const { pool, comCache } = require('../lib/db');
const ESTADOS = require('../lib/estados');

/* Totais por UF: empresas ativas e aberturas nos últimos 30 dias.
   Varre a tabela inteira, então roda em segundo plano e fica em cache;
   enquanto não termina, a rota responde com os totais fixos de lib/estados.js. */
let totais = null;
function calcularTotais() {
  return comCache('estados:totais', async () => {
    // Duas consultas que usam só índices da tabela busca (só ativas): (uf, …) e (data_inicio_atividade)
    const [ativas, aberturas] = await Promise.all([
      pool.query(`SELECT uf, COUNT(*) AS n FROM busca GROUP BY uf`),
      pool.query(`SELECT uf, COUNT(*) AS n FROM busca WHERE data_inicio_atividade >= CURRENT_DATE - 30 GROUP BY uf`),
    ]);
    const novas = Object.fromEntries(aberturas.rows.map(r => [r.uf, parseInt(r.n)]));
    totais = Object.fromEntries(ativas.rows.map(r => [r.uf, { ativas: parseInt(r.n), aberturas_30d: novas[r.uf] || 0 }]));
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
