/* ═══════════════════════════════════════════════
   api.js — Cliente da API backend
   Cai automaticamente para dados demo se API indisponível.

   Configuração rápida (antes de carregar este script):
     <script>
       window.API_BASE     = 'https://api.seudominio.com.br';
       window.N8N_WEBHOOK  = 'https://seudominio.com.br/webhook/empresas';
     </script>
   ═══════════════════════════════════════════════ */

const _API = {
  base:    (typeof window !== 'undefined' && window.API_BASE)    || '',
  n8n:     (typeof window !== 'undefined' && window.N8N_WEBHOOK) || '',
  timeout: 12000,
};

/* Indica se backend está disponível (detectado no primeiro uso) */
let _apiOnline = null;

async function _apiFetch(path, opts = {}) {
  if (!_API.base) throw new Error('API_BASE não configurado');
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), _API.timeout);
  try {
    const res = await fetch(_API.base + path, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

/* ── Busca empresas: tenta API, cai para generator ── */
async function fetchEmpresas(municipioIbge, uf, municipioNome, cnae, page = 1) {
  if (_API.base && _apiOnline !== false) {
    try {
      const data = await _apiFetch(
        `/api/empresas?municipio=${municipioIbge}&cnae=${cnae}&page=${page}&limit=50&municipioNome=${encodeURIComponent(municipioNome || '')}`
      );
      _apiOnline = true;
      /* banco ainda não importado: cai para demo */
      if (data.total > 0) return { source: 'api', ...data };
    } catch (err) {
      console.warn('[API] Indisponível — modo demo:', err.message);
      _apiOnline = false;
    }
  }
  /* fallback demo */
  const empresas = genEmpresas(uf, municipioNome, cnae);
  return { source: 'demo', total: empresas.length, page: 1, limit: 50, empresas };
}

/* ── Diagnóstico IA via Groq (backend) ── */
async function fetchDiagnostico(empresa, cnaeDesc) {
  return _apiFetch('/api/diagnostico', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ empresa, cnae_desc: cnaeDesc }),
  });
}

/* ── Enviar lista para n8n ── */
async function sendToN8n(payload) {
  if (!_API.n8n) throw new Error('N8N_WEBHOOK não configurado');
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), _API.timeout);
  try {
    const res = await fetch(_API.n8n, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new Error(`n8n HTTP ${res.status}`);
    return await res.json().catch(() => ({ ok: true }));
  } finally {
    clearTimeout(tid);
  }
}
