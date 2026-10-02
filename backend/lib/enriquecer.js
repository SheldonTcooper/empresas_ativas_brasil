/* Enriquecimento por IA (Groq + busca na web): encontra site e perfis públicos da empresa.
   Só aceita links que apareceram de fato nos resultados da busca (trava contra links
   inventados) e grava o resultado na tabela enriquecimento, reaproveitado por todos. */
const { pool } = require('./db');

const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
// Em ordem de uso. No plano gratuito cada modelo tem 200 mil tokens/dia: o 20b gasta ~19 mil
// por empresa (~10/dia) e o 120b ~60–125 mil (~2/dia); quando um esgota, passa para o próximo.
const MODELOS = (process.env.GROQ_MODELOS_BUSCA || 'openai/gpt-oss-20b,openai/gpt-oss-120b')
  .split(',').map(s => s.trim()).filter(Boolean);
const VALIDADE_DIAS = 90;
const MAX_SIMULTANEAS = 1;   // cota do Groq gratuito: uma pesquisa por vez

// Sites que listam empresas (não são o site da empresa)
const AGREGADORES = /(^|\.)(cnpj\.biz|casadosdados\.com\.br|econodata\.com\.br|solutudo\.com\.br|guiamais\.com\.br|telelistas\.net|apontador\.com\.br|cnpja\.com|empresascnpj\.com|consultacnpj\.com|cnpjs\.rocks|informecadastral\.com\.br|serasaexperian\.com\.br|jusbrasil\.com\.br|google\.[a-z.]+|bing\.com|exa\.ai|yelp\.[a-z.]+|tripadvisor\.[a-z.]+|ifood\.com\.br|wikipedia\.org|youtube\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|fb\.com|linkedin\.com|wa\.me|whatsapp\.com|gov\.br)$/i;

const limpa = v => String(v || '').replace(/\s+/g, ' ').trim();

let ativas = 0;
const fila = [];
function comVaga(fn) {
  return new Promise((ok, falha) => {
    const rodar = () => { ativas++; fn().then(ok, falha).finally(() => { ativas--; fila.length && fila.shift()(); }); };
    ativas < MAX_SIMULTANEAS ? rodar() : fila.push(rodar);
  });
}

function descricaoEmpresa(r) {
  const nome = limpa(r.nome_fantasia) || limpa(r.razao_social).replace(/^\d{2}\.\d{3}\.\d{3}\s*/, '');
  const dominioEmail = (String(r.correio_eletronico || '').toLowerCase().split('@')[1] || '');
  const emailProprio = dominioEmail && !/^(gmail|hotmail|outlook|yahoo|bol|uol|terra|ig|live|icloud|msn)\./.test(dominioEmail);
  return [
    `Nome: ${nome}`,
    `Razão social: ${limpa(r.razao_social)}`,
    `Endereço: ${limpa(`${r.tipo_logradouro || ''} ${r.logradouro || ''}`)}, ${limpa(r.numero)} - ${limpa(r.bairro)}, ${limpa(r.municipio_nome)} - ${r.uf}`,
    `Atividade: ${limpa(r.cnae_descricao) || r.cnae_fiscal}`,
    emailProprio ? `Domínio do e-mail cadastrado: ${dominioEmail} (forte indício do site)` : '',
  ].filter(Boolean).join('\n');
}

const PROMPT = `Você ajuda a encontrar os canais oficiais e públicos de empresas brasileiras.
Pesquise na web e responda SOMENTE com um JSON, sem texto antes ou depois:
{"site": url|null, "instagram": url|null, "facebook": url|null, "linkedin": url|null,
 "confianca": "alta"|"media"|"baixa", "resumo": "uma frase sobre o que a empresa faz, ou null"}

Regras:
- Só inclua um link se tiver certeza de que é DESTA empresa: mesmo nome e mesma cidade (ou a página oficial da rede, se for franquia).
- Instagram: perfil (instagram.com/usuario), nunca páginas de localização (/explore/), posts ou reels.
- Facebook: página da empresa. LinkedIn: página de empresa (linkedin.com/company/...).
- "site" é o site próprio da empresa; nunca sites de listas de CNPJ, guias, redes sociais ou marketplaces.
- Perfis pessoais de pessoas físicas não contam (privacidade), só canais do negócio.
- Na dúvida, use null. Nunca invente.`;

// Normaliza para comparar com as URLs vistas na busca
function chave(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname).toLowerCase().replace(/\/+$/, '');
  } catch { return ''; }
}

function urlValida(tipo, url) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);
  if (tipo === 'instagram') {
    if (host !== 'instagram.com' || partes.length !== 1 || /^(explore|p|reel|reels|stories|accounts)$/i.test(partes[0])) return null;
    return `https://www.instagram.com/${partes[0]}/`;
  }
  if (tipo === 'facebook') {
    if (!/^(facebook\.com|m\.facebook\.com|fb\.com)$/.test(host) || !partes.length || /^(search|groups|events|sharer|watch|marketplace|login)$/i.test(partes[0])) return null;
    return `https://www.facebook.com/${partes.join('/')}${u.search && partes[0] === 'profile.php' ? u.search : ''}`;
  }
  if (tipo === 'linkedin') {
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
    if (partes[0] !== 'company' || !partes[1]) return null;
    return `https://www.linkedin.com/company/${partes[1]}/`;
  }
  if (tipo === 'site') {
    if (AGREGADORES.test(host)) return null;
    return `${u.protocol}//${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  }
  return null;
}

// O link só vale se apareceu nos resultados que a busca de fato trouxe
function apareceuNaBusca(tipo, url, vistas, textoBusca) {
  if (tipo === 'site') {
    const dominio = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return vistas.some(v => v.startsWith(dominio)) || textoBusca.includes(dominio);
  }
  const k = chave(url);
  return vistas.some(v => v === k || v.startsWith(k + '/') || v.startsWith(k + '?')) || textoBusca.includes(k);
}

function extrairJson(texto) {
  const t = String(texto || '').replace(/```(?:json)?/gi, '');
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

class LimiteGroq extends Error {
  constructor(segundos, diario = false) {
    super(diario
      ? `Cota diária gratuita do Groq esgotada (cerca de 10 empresas por dia). Volta em ${tempoLegivel(segundos)}.`
      : 'Limite de consultas do Groq atingido. Tente de novo em instantes.');
    this.status = 429; this.retryAfter = segundos; this.diario = diario;
  }
}

function tempoLegivel(s) {
  const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60);
  return h ? `${h}h${m ? ` ${m}min` : ''}` : `${Math.max(m, 1)} min`;
}

// "42.202s" / "577ms" / "1m3s" / "2h3m10s" (Groq) → segundos
function segundos(v) {
  const s = String(v || '');
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?/);
  const total = (parseFloat(m?.[1]) || 0) * 3600 + (parseFloat(m?.[2]) || 0) * 60
    + (parseFloat(m?.[3]) || 0) + (parseFloat(m?.[4]) || 0) / 1000;
  return total > 0 ? total : null;
}

const ESPERA_MAX = 180;    // cota por minuto: o Groq diz quanto esperar (até ~3 min após uma pesquisa grande)
const TENTATIVAS = 4;
const dormir = s => new Promise(r => setTimeout(r, s * 1000));

/* Plano gratuito do Groq: 8 mil tokens/minuto e 200 mil/dia por modelo.
   - limite do minuto: espera o tempo que o Groq indicar e tenta de novo (sem erro na tela);
   - limite do dia: passa para o próximo modelo; se todos esgotaram, avisa quando volta. */
async function consultarGroq(descricao) {
  let menorEspera = null;
  for (const modelo of MODELOS) {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return { modelo, msg: await chamarGroq(descricao, modelo) };
      } catch (err) {
        if (!(err instanceof LimiteGroq)) throw err;
        if (err.diario) { menorEspera = Math.min(menorEspera ?? Infinity, err.retryAfter); break; }
        if (tentativa >= TENTATIVAS || err.retryAfter > ESPERA_MAX) throw err;
        await dormir(err.retryAfter + 1);
      }
    }
  }
  throw new LimiteGroq(menorEspera ?? 3600, true);
}

async function chamarGroq(descricao, modelo) {
  if (!process.env.GROQ_API_KEY) { const e = new Error('GROQ_API_KEY não configurada no servidor'); e.status = 503; throw e; }
  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      temperature: 1, top_p: 1,          // exigido pela busca no navegador do Groq
      reasoning_effort: 'low',           // buscas mais curtas, menos tokens
      max_completion_tokens: 2000,
      tool_choice: 'required',
      tools: [{ type: 'browser_search' }],
      messages: [{ role: 'user', content: `${PROMPT}\n\nEmpresa:\n${descricao}` }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 429) {
    const texto = String(dados?.error?.message || '');
    const espera = segundos(resp.headers.get('retry-after') && `${resp.headers.get('retry-after')}s`)
      || segundos((texto.match(/try again in ([\dhms.]+)/) || [])[1])
      || segundos(resp.headers.get('x-ratelimit-reset-tokens')) || 60;
    throw new LimiteGroq(Math.ceil(espera), /per day|TPD|RPD/.test(texto));
  }
  if (!resp.ok) { const e = new Error(`Groq ${resp.status}: ${dados?.error?.message || 'erro'}`); e.status = 502; throw e; }
  return dados.choices?.[0]?.message || {};
}

/* Enriquece um estabelecimento (linha da tabela busca + descrição do CNAE). */
async function enriquecer(r) {
  const cnpj = r.cnpj_basico + r.cnpj_ordem + r.cnpj_dv;
  const { modelo, msg } = await comVaga(() => consultarGroq(descricaoEmpresa(r)));

  const ferramentas = Array.isArray(msg.executed_tools) ? msg.executed_tools : [];
  const resultados = ferramentas.flatMap(t => t?.search_results?.results || []);
  const vistas = resultados.map(x => chave(x.url)).filter(Boolean);
  const textoBusca = ferramentas.map(t => String(t.output || '')).join('\n').toLowerCase();

  const bruto = extrairJson(msg.content) || {};
  const final = {};
  const descartados = [];
  for (const tipo of ['site', 'instagram', 'facebook', 'linkedin']) {
    const url = urlValida(tipo, bruto[tipo]);
    if (url && apareceuNaBusca(tipo, url, vistas, textoBusca)) final[tipo] = url;
    else if (bruto[tipo]) descartados.push(`${tipo}: ${bruto[tipo]}`);
  }
  const confianca = ['alta', 'media', 'baixa'].includes(bruto.confianca) ? bruto.confianca : 'baixa';
  const resumo = typeof bruto.resumo === 'string' ? limpa(bruto.resumo).slice(0, 300) : null;
  const fontes = [...new Set(resultados.map(x => x.url).filter(Boolean))].slice(0, 15);
  const achou = Object.keys(final).length > 0;

  await pool.query(`
    INSERT INTO enriquecimento (cnpj, site, instagram, facebook, linkedin, confianca, resumo, fontes, descartados, modelo, status, criado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
    ON CONFLICT (cnpj) DO UPDATE SET site=$2, instagram=$3, facebook=$4, linkedin=$5, confianca=$6, resumo=$7,
      fontes=$8, descartados=$9, modelo=$10, status=$11, criado_em=now()`,
    [cnpj, final.site || null, final.instagram || null, final.facebook || null, final.linkedin || null,
     achou ? confianca : null, resumo, JSON.stringify(fontes), JSON.stringify(descartados), modelo, achou ? 'ok' : 'nada']);

  return { ...final, confianca: achou ? confianca : null, resumo, status: achou ? 'ok' : 'nada', em: new Date().toISOString() };
}

module.exports = { enriquecer, VALIDADE_DIAS, LimiteGroq, urlValida, apareceuNaBusca, chave, extrairJson };
