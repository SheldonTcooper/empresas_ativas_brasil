const router = require('express').Router();
const { pool } = require('../lib/db');

/* ── POST /api/remocao ── pedido de remoção de dados (LGPD)
   Corpo: { cnpj, nome, email, motivo }
   O pedido fica "pendente" para conferência. Para aprovar (some das buscas):
     INSERT INTO cnpj_oculto (cnpj, pedido_id) SELECT cnpj, id FROM pedido_remocao WHERE id = <id>;
     UPDATE pedido_remocao SET status = 'aprovado' WHERE id = <id>;                              */
router.post('/', async (req, res, next) => {
  const cnpj   = String(req.body?.cnpj || '').replace(/\D/g, '');
  const nome   = String(req.body?.nome || '').trim().slice(0, 150);
  const email  = String(req.body?.email || '').trim().toLowerCase().slice(0, 150);
  const motivo = String(req.body?.motivo || '').trim().slice(0, 2000);

  if (cnpj.length !== 14)                    return res.status(400).json({ error: 'Informe o CNPJ completo (14 dígitos).' });
  if (nome.length < 3)                       return res.status(400).json({ error: 'Informe seu nome.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido para contato.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO pedido_remocao (cnpj, nome, email, motivo, ip) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cnpj, nome, email, motivo, req.ip]);
    res.status(201).json({ ok: true, protocolo: rows[0].id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
