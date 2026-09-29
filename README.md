# EmpresasAtivasBR

Dashboard B2B para busca e prospecção de empresas ativas no Brasil, com dados reais e completos da Receita Federal (CNPJ). Permite localizar empresas por estado, município e CNAE, com informações de contato (telefone, e-mail, endereço) e links prontos para Google Maps, WhatsApp, LinkedIn, Instagram e Facebook.

🔗 **Produção:** [empresasativas.online](https://empresasativas.online)

## Visão geral

O sistema importa a base pública de CNPJs da Receita Federal (Dados Abertos) para um banco PostgreSQL próprio e expõe uma API REST consumida por um painel web dark-mode. O fluxo de navegação é:

```
Mapa do Brasil (por estado)
  → Lista de municípios do estado (dados reais)
    → CNAEs ativos naquele município (dados reais)
      → Tabela de empresas ativas daquele CNAE/município
```

Cada empresa retornada já vem com CNPJ formatado, razão social, nome fantasia, tipo (matriz/filial), porte, data de abertura, telefone, e-mail, endereço completo e links prontos para Google Maps, WhatsApp, LinkedIn, Instagram e Facebook.

## Stack técnica

- **Backend:** Node.js + Express, `pg` (node-postgres)
- **Banco de dados:** PostgreSQL 16 (nativo, não containerizado)
- **Frontend:** HTML/CSS/JS puro (sem framework), Leaflet.js para o mapa de estados
- **Infraestrutura:** VPS Ubuntu 24.04, PM2 (gerenciamento de processo), Docker + Traefik v3.6 (proxy reverso / roteamento de domínio / TLS via Let's Encrypt)
- **Dados:** Dados Abertos do CNPJ (Receita Federal), atualizados mensalmente

## Estrutura do projeto

```
empresas_ativas_brasil/
├── backend/
│   ├── server.js                # entrypoint Express
│   ├── routes/
│   │   ├── empresas.js          # rotas /api/empresas, /cidades, /cnaes, /cnpj/:cnpj
│   │   └── diagnostico.js       # rota de diagnóstico/health
│   ├── db/
│   │   ├── schema.sql           # schema completo do banco
│   │   ├── resume_estab.sh      # script de import (Estabelecimentos)
│   │   ├── filtro_ativos.py     # filtro CSV (apenas situação ativa) respeitando quoting da RFB
│   │   └── ...
│   ├── .env                     # variáveis de ambiente (não versionado)
│   └── package.json
└── public/
    ├── index.html                # painel (SPA single-file)
    └── brasil.geojson             # geometria dos estados para o mapa
```

## Banco de dados

Schema em `public` (sem prefixo de schema customizado), tabelas principais:

| Tabela | Descrição | Volume atual |
|---|---|---|
| `empresa` | Dados cadastrais (razão social, natureza jurídica, porte, capital social) | ~70 milhões |
| `estabelecimento` | Endereço, contato, CNAE, situação cadastral por estabelecimento | ~28 milhões (ativos) |
| `municipio` | Municípios do Brasil (código IBGE + descrição) | 5.572 |
| `cnae` | Catálogo de códigos CNAE | 1.359 |
| `socio` | Quadro societário (uso futuro — enriquecimento) | — |
| `simples`, `natureza_juridica`, `qualificacao`, `motivo`, `pais` | Tabelas de apoio/domínio | — |

Índices relevantes em `estabelecimento`: `(cnpj_basico, cnpj_ordem, cnpj_dv)` (PK), `municipio`, `cnae_fiscal`, `situacao_cadastral`, e índices compostos `(municipio, cnae_fiscal, situacao_cadastral)` / `(uf, cnae_fiscal, situacao_cadastral)` para as consultas do painel.

### Importação de dados

Os arquivos da Receita Federal são baixados de um mirror (`dados-abertos-rf-cnpj.casadosdados.com.br`, atualizado mensalmente) — o domínio oficial `dadosabertos.rfb.gov.br` apresentou instabilidade de conexão em diversos pontos de teste.

Pontos de atenção no formato dos arquivos CSV da RFB, tratados nos scripts de import:

- Arquivos extraídos não têm extensão `.csv`.
- Todos os campos vêm entre aspas duplas, e nomes de empresa podem conter `;` dentro das aspas — por isso o filtro usa o módulo `csv` do Python (respeitando `quotechar`) em vez de `awk -F';'`.
- `capital_social` usa vírgula decimal (`"5000,00"`) — coluna armazenada como `TEXT` para evitar erro de conversão.
- Campos de data podem vir vazios (`""`) ou com o valor sentinela `"0"` — normalizados para `NULL` via `FORCE_NULL` no `COPY` + pré-processamento em Python.
- Import feito via tabela de staging (`CREATE TABLE ... (LIKE estabelecimento)`) + `INSERT ... ON CONFLICT DO NOTHING`, evitando que uma linha problemática derrube o lote inteiro (COPY é tudo-ou-nada).

## API

Base: `/api/empresas`

| Rota | Descrição |
|---|---|
| `GET /api/empresas?municipio=<codigo>&cnae=<codigo>&page=&limit=` | Lista empresas ativas por município + CNAE (paginado, limite máx. 200) |
| `GET /api/empresas/cidades?estado=UF` | Lista municípios de um estado que possuem empresas ativas |
| `GET /api/empresas/cnaes?estado=UF&municipio=<codigo>` | Lista CNAEs ativos em um município (ou estado) |
| `GET /api/empresas/cnpj/:cnpj` | Detalhe de uma empresa por CNPJ |
| `GET /api/diagnostico` (ou `/api/health`) | Health check |

## Variáveis de ambiente (`backend/.env`)

```
DATABASE_URL=postgresql://usuario:senha@localhost:5432/cnpj_rf
PORT=3002
DATABASE_SSL=false
CORS_ORIGIN=https://empresasativas.online
GROQ_API_KEY=            # reservado para enriquecimento por IA (futuro)
BRASILIO_TOKEN=          # fallback opcional via Brasil.IO quando a busca local retorna 0 resultados
```

## Rodando localmente

```bash
cd backend
npm install
cp .env.example .env   # preencha DATABASE_URL etc.
npm start              # ou: npm run dev (nodemon)
```

O `server.js` serve o frontend estático (`public/`) e a API na mesma porta.

## Deploy (produção)

- Processo gerenciado via **PM2** (`pm2 start server.js --name empresas-api`), com `pm2 save` + `pm2 startup systemd` para sobreviver a reinicializações da VPS.
- Roteamento de domínio via **Traefik** (provider de arquivo estático, `backend-config.yml`), apontando `empresasativas.online` para `http://172.18.0.1:3002` (gateway Docker → host).
- TLS automático via Let's Encrypt (resolver `mytlschallenge` do Traefik).

## Roadmap

- [ ] Importar tabela `socio` (quadro societário)
- [ ] Workflow de enriquecimento via IA (n8n): dados societários, site, redes sociais
- [ ] Mapa de municípios com geometria real (atualmente a navegação por município usa lista pesquisável, não um segundo mapa)
- [ ] Paginação completa na tabela de resultados (hoje limitada a 200 registros por consulta)

## Licença

Projeto privado — uso interno.
