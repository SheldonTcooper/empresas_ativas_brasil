/* Segmentos amigáveis = grupos de atividades (CNAE / CONCLA).
   Cada segmento é definido por prefixos do código CNAE ("47" = todo o comércio varejista,
   "4711" = hipermercados e supermercados) e expandido para os códigos de 7 dígitos
   existentes na tabela cnae — assim a busca usa os índices por CNAE. */
const { pool, comCache } = require('./db');

const DEFINICOES = [
  { id: 'alimentacao',     nome: 'Restaurantes e alimentação',      prefixos: ['561', '562'] },
  { id: 'hospedagem',      nome: 'Hospedagem',                      prefixos: ['551', '559'] },
  { id: 'varejo',          nome: 'Comércio varejista',              prefixos: ['47'] },
  { id: 'supermercados',   nome: 'Supermercados e mercearias',      prefixos: ['4711', '4712', '4721', '4729'] },
  { id: 'farmacias',       nome: 'Farmácias e drogarias',           prefixos: ['4771'] },
  { id: 'atacado',         nome: 'Comércio atacadista',             prefixos: ['46'] },
  { id: 'veiculos',        nome: 'Veículos, peças e oficinas',      prefixos: ['45'] },
  { id: 'combustiveis',    nome: 'Postos de combustível',           prefixos: ['4731', '4732'] },
  { id: 'construcao',      nome: 'Construção',                      prefixos: ['41', '42', '43'] },
  { id: 'imobiliario',     nome: 'Imobiliárias',                    prefixos: ['68'] },
  { id: 'industria',       nome: 'Indústria',                       prefixos: Array.from({ length: 24 }, (_, i) => String(10 + i)) },
  { id: 'ind_alimentos',   nome: 'Indústria de alimentos e bebidas', prefixos: ['10', '11'] },
  { id: 'agro',            nome: 'Agronegócio',                     prefixos: ['01', '02', '03'] },
  { id: 'transporte',      nome: 'Transporte e logística',          prefixos: ['49', '50', '51', '52', '53'] },
  { id: 'ti',              nome: 'Tecnologia da informação',        prefixos: ['62', '631'] },
  { id: 'telecom',         nome: 'Telecomunicações',                prefixos: ['61'] },
  { id: 'marketing',       nome: 'Marketing e publicidade',         prefixos: ['731', '732'] },
  { id: 'contabilidade',   nome: 'Contabilidade e consultoria',     prefixos: ['692', '702'] },
  { id: 'advocacia',       nome: 'Advocacia',                       prefixos: ['6911'] },
  { id: 'engenharia',      nome: 'Engenharia e arquitetura',        prefixos: ['711', '712'] },
  { id: 'saude',           nome: 'Saúde',                           prefixos: ['86', '87', '88'] },
  { id: 'educacao',        nome: 'Educação',                        prefixos: ['85'] },
  { id: 'beleza',          nome: 'Beleza e estética',               prefixos: ['9602'] },
  { id: 'academias',       nome: 'Academias e esportes',            prefixos: ['931'] },
  { id: 'bancos',          nome: 'Bancos e cooperativas de crédito', prefixos: ['642', '643'] },
  { id: 'seguros',         nome: 'Seguros e corretoras',            prefixos: ['651', '652', '653', '662'] },
  { id: 'securitizadora',  nome: 'Securitizadoras',                 prefixos: ['6492'] },
  { id: 'energia',         nome: 'Energia e gás',                   prefixos: ['35'] },
];

const SEGMENTOS = Object.fromEntries(DEFINICOES.map(d => [d.id, { nome: d.nome, prefixos: d.prefixos, cnaes: [] }]));

// Expande os prefixos para os códigos de 7 dígitos (uma vez por dia; tabela cnae muda pouco)
function prepararSegmentos() {
  return comCache('segmentos', async () => {
    const { rows } = await pool.query('SELECT codigo FROM cnae');
    const codigos = rows.map(r => String(r.codigo).trim()).filter(c => /^\d{7}$/.test(c)).sort();
    for (const s of Object.values(SEGMENTOS)) s.cnaes = codigos.filter(c => s.prefixos.some(p => c.startsWith(p)));
    return SEGMENTOS;
  }, 24 * 60 * 60 * 1000);
}

module.exports = { SEGMENTOS, prepararSegmentos };
