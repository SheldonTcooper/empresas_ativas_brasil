const router = require('express').Router();

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
// llama-3.3-70b-versatile foi descontinuado no Groq
const GROQ_MODEL = process.env.GROQ_MODELO || 'openai/gpt-oss-120b';

/* ── POST /api/diagnostico ── */
router.post('/', async (req, res, next) => {
  const { empresa, cnae_desc } = req.body;
  if (!empresa?.razao)
    return res.status(400).json({ error: 'Campo empresa.razao é obrigatório' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey)
    return res.status(503).json({ error: 'GROQ_API_KEY não configurada no servidor' });

  const contatos = [empresa.tel1, empresa.tel2, empresa.email].filter(Boolean).join(', ') || 'Não informado';
  const nome     = empresa.fantasia ? `${empresa.razao} (${empresa.fantasia})` : empresa.razao;

  const prompt = `Você é um analista de negócios especializado no mercado brasileiro B2B.
Analise o perfil desta empresa e forneça um diagnóstico estratégico:

Empresa: ${nome}
CNAE / Atividade: ${cnae_desc || 'Não informado'}
Porte: ${empresa.porte}
Data de abertura: ${empresa.abertura}
Localização: ${empresa.municipio} / ${empresa.uf}
Tipo: ${empresa.tipo}
Contatos disponíveis: ${contatos}

Retorne SOMENTE um objeto JSON válido, sem markdown, sem texto antes ou depois:
{
  "perfil": "Descrição do negócio em até 2 frases diretas",
  "potencial": "Alto|Médio|Baixo",
  "justificativa": "Justificativa do potencial em 1 frase",
  "abordagem": ["dica comercial 1", "dica comercial 2", "dica comercial 3"],
  "canal_ideal": "WhatsApp|E-mail|Telefone|LinkedIn|Visita presencial",
  "score": 75,
  "tags": ["tag1", "tag2", "tag3"]
}

score é de 0 a 100 (potencial de conversão). tags devem refletir características relevantes para prospecção.`;

  try {
    const resp = await fetch(GROQ_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens:  600,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Groq ${resp.status}: ${errBody.slice(0,200)}`);
    }

    const data    = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('IA não retornou JSON válido');

    const diagnostico = JSON.parse(match[0]);
    res.json(diagnostico);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
