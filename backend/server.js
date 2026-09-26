require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS'));
  }
}));
app.use(express.json({ limit: '2mb' }));

app.use('/api/empresas',    require('./routes/empresas'));
app.use('/api/diagnostico', require('./routes/diagnostico'));

app.get('/api/health', (_, res) =>
  res.json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV || 'production' })
);

app.use((err, req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT, () => console.log(`✓ API rodando na porta ${PORT}`));
