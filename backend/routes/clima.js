const router = require('express').Router();
const https = require('https');
const ESTADOS = require('../lib/estados');

/* Tempo no momento (Open-Meteo, gratuita e sem chave). Resposta em cache por 30 min.
   GET /api/clima                       → Brasil: média e as 27 capitais
   GET /api/clima?uf=PR                 → capital do estado
   GET /api/clima?uf=PR&municipio=NOME  → município (se não achar, devolve a capital com aproximado:true) */

const CAPITAIS = {
  AC:[-9.97,-67.81], AL:[-9.67,-35.74], AP:[0.03,-51.07], AM:[-3.12,-60.02], BA:[-12.97,-38.51],
  CE:[-3.73,-38.52], DF:[-15.78,-47.93], ES:[-20.32,-40.34], GO:[-16.68,-49.25], MA:[-2.53,-44.30],
  MT:[-15.60,-56.10], MS:[-20.47,-54.62], MG:[-19.92,-43.94], PA:[-1.46,-48.50], PB:[-7.12,-34.86],
  PR:[-25.43,-49.27], PE:[-8.05,-34.88], PI:[-5.09,-42.80], RJ:[-22.91,-43.17], RN:[-5.79,-35.21],
  RS:[-30.03,-51.23], RO:[-8.76,-63.90], RR:[2.82,-60.67], SC:[-27.60,-48.55], SP:[-23.55,-46.63],
  SE:[-10.91,-37.07], TO:[-10.18,-48.33],
};

// Códigos WMO → texto e ícone
const WMO = [
  [[0], 'Céu limpo', '☀️'], [[1], 'Predomínio de sol', '🌤️'], [[2], 'Parcialmente nublado', '⛅'], [[3], 'Nublado', '☁️'],
  [[45, 48], 'Neblina', '🌫️'], [[51, 53, 55, 56, 57], 'Garoa', '🌦️'], [[61, 63, 65, 66, 67], 'Chuva', '🌧️'],
  [[71, 73, 75, 77], 'Neve', '❄️'], [[80, 81, 82], 'Pancadas de chuva', '🌧️'], [[85, 86], 'Pancadas de neve', '❄️'],
  [[95, 96, 99], 'Tempestade', '⛈️'],
];
const descreve = c => { const w = WMO.find(([cs]) => cs.includes(c)); return w ? { descricao: w[1], icone: w[2] } : { descricao: '—', icone: '🌡️' }; };

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'EmpresasAtivasBR' }, timeout: 8000 }, res => {
      let corpo = '';
      res.on('data', d => { corpo += d; if (corpo.length > 2e6) req.destroy(new Error('resposta grande demais')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(corpo)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

const cache = new Map();
async function comCache(chave, fn) {
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return hit.v;
  try {
    const v = await fn();
    cache.set(chave, { ts: Date.now(), v });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return v;
  } catch (err) {
    if (hit) return hit.v; // API fora do ar: devolve o último valor conhecido
    throw err;
  }
}

const CAMPOS = 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code';
const arred = n => (n == null ? null : Math.round(n * 10) / 10);
function atual(c) {
  return {
    temp: arred(c.temperature_2m), sensacao: arred(c.apparent_temperature), umidade: c.relative_humidity_2m,
    chuva: arred(c.precipitation), vento: arred(c.wind_speed_10m), ...descreve(c.weather_code),
  };
}

async function tempoEm(pontos) {
  const lat = pontos.map(p => p[0]).join(','), lon = pontos.map(p => p[1]).join(',');
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${CAMPOS}&timezone=auto`);
  return (Array.isArray(d) ? d : [d]).map(x => atual(x.current || {}));
}

const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function coordenadasMunicipio(nome, uf) {
  const estado = ESTADOS.find(e => e.uf === uf);
  const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}&count=20&language=pt&countryCode=BR`);
  const ok = (d.results || []).filter(r => r.country_code === 'BR' && norm(r.admin1) === norm(estado.nome));
  const achou = ok.find(r => norm(r.name) === norm(nome)) || ok[0];
  return achou ? { ponto: [achou.latitude, achou.longitude], nome: achou.name } : null;
}

router.get('/', async (req, res) => {
  const uf = String(req.query.uf || '').toUpperCase();
  const municipio = String(req.query.municipio || '').trim().slice(0, 80);
  try {
    if (!uf) {
      const v = await comCache('brasil', async () => {
        const ufs = Object.keys(CAPITAIS);
        const t = await tempoEm(ufs.map(u => CAPITAIS[u]));
        const itens = ufs.map((u, i) => ({ uf: u, cidade: ESTADOS.find(e => e.uf === u).capital, ...t[i] })).filter(i => i.temp != null);
        const temps = itens.map(i => i.temp);
        return {
          escopo: 'brasil', local: 'Brasil',
          media: arred(temps.reduce((s, x) => s + x, 0) / temps.length),
          min: itens.reduce((a, b) => (b.temp < a.temp ? b : a)),
          max: itens.reduce((a, b) => (b.temp > a.temp ? b : a)),
          itens,
        };
      });
      return res.json(v);
    }
    const estado = ESTADOS.find(e => e.uf === uf);
    if (!estado) return res.status(400).json({ error: 'UF inválida.' });

    const v = await comCache(`${uf}:${norm(municipio)}`, async () => {
      let ponto = null, local = estado.capital, aproximado = false;
      if (municipio) {
        let g = null;
        try { g = await coordenadasMunicipio(municipio, uf); } catch (_) { g = null; }
        if (g) { ponto = g.ponto; local = g.nome; } else aproximado = true;
      }
      const [t] = await tempoEm([ponto || CAPITAIS[uf]]);
      return { escopo: municipio ? 'municipio' : 'estado', uf, local, aproximado, ...t };
    });
    res.json(v);
  } catch (err) {
    console.warn('[clima] indisponível:', err.message);
    res.status(502).json({ error: 'Clima indisponível no momento.' });
  }
});

module.exports = router;
