const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

/* Cache em memória para consultas pesadas (listas de CNAEs, municípios, totais por estado).
   A base da Receita muda uma vez por mês. Pedidos simultâneos da mesma chave
   compartilham a mesma consulta. Depois de vencido, devolve o valor antigo na hora
   e atualiza em segundo plano — ninguém espera a consulta pesada de novo. */
const CACHE_TTL = 12 * 60 * 60 * 1000;
const cache = new Map();
function comCache(chave, fn, ttl = CACHE_TTL) {
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.ts < ttl) return hit.valor;
  const valor = Promise.resolve().then(fn);
  if (hit && hit.pronto) {
    hit.ts = Date.now(); // evita várias atualizações ao mesmo tempo
    valor.then(v => cache.set(chave, { ts: Date.now(), valor: Promise.resolve(v), pronto: true }))
      .catch(err => console.error(`[cache] ${chave}:`, err.message)); // mantém o valor antigo
    return hit.valor;
  }
  const entrada = { ts: Date.now(), valor, pronto: false };
  cache.set(chave, entrada);
  valor.then(() => { entrada.pronto = true; }, () => cache.delete(chave)); // erro não fica em cache
  return valor;
}

// "São José dos Pinhais" → "sao-jose-dos-pinhais" (mesma regra no front)
function slug(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { pool, comCache, slug };
