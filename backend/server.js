require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1); // atrás do Traefik/Nginx: usa o IP real do cliente no rate limit
app.use(compression());

const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS'));
  }
}));
app.use(express.json({ limit: '2mb' }));

app.use(express.static(require('path').join(__dirname, '../public')));

// Limites por IP: freiam a raspagem da base inteira e o uso da chave da IA
const limiteApi = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_POR_MINUTO) || 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um minuto e tente novamente.' },
});
const limiteIA = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_IA_POR_HORA) || 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Limite de análises por hora atingido.' },
});
// Enriquecimento por IA: cada consulta leva ~20s no Groq; limite folgado para uso interno
const limiteEnriq = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_ENRIQ_POR_HORA) || 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Limite de enriquecimentos por hora atingido.' },
});
const limiteRemocao = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitos pedidos seguidos. Tente novamente mais tarde.' },
});

app.use('/api/empresas',    limiteApi,     require('./routes/empresas'));
app.use('/api/estados',     limiteApi,     require('./routes/estados'));
app.use('/api/remocao',     limiteRemocao, require('./routes/remocao'));
app.use('/api/enriquecer',  limiteEnriq,   require('./routes/enriquecimento'));
app.use('/api/diagnostico', limiteIA,      require('./routes/diagnostico'));

app.get('/api/health', (_, res) =>
  res.json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV || 'production' })
);

// Páginas por estado/cidade/atividade, sitemap e páginas legais (depois dos arquivos estáticos)
app.use(require('./routes/paginas'));

app.use((err, req, res, _next) => {
  console.error(err.message);
  const status = err.status || 500;
  // Não expõe mensagens internas (SQL, conexão) para o cliente
  res.status(status).json({ error: status < 500 ? err.message : 'Erro interno. Tente novamente.' });
});

app.listen(PORT, () => {
  console.log(`✓ API rodando na porta ${PORT}`);
  // Pré-calcula totais por estado e listas de municípios/CNAEs para tudo abrir rápido;
  // depois que o cache (12h) vence, a passada seguinte atualiza em segundo plano
  const aquecer = () => require('./routes/estados').calcularTotais()
    .catch(err => console.error('[estados] totais:', err.message))
    .then(() => require('./routes/paginas').aquecerCache());
  aquecer();
  setInterval(aquecer, 12.5 * 60 * 60 * 1000).unref();
});
