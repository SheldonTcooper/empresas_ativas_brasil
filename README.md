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
│   ├── server.js                # entrypoint Express (gzip, rate limit, rotas)
│   ├── lib/
│   │   ├── db.js                # pool do Postgres, cache em memória, slug()
│   │   └── estados.js           # dados fixos dos 27 estados
│   ├── routes/
│   │   ├── empresas.js          # /api/empresas (filtros), /bairros, /segmentos, /cidades, /cnaes, /cnpj/:cnpj
│   │   ├── estados.js           # /api/estados/info (mapa e painel do estado)
│   │   ├── remocao.js           # /api/remocao (pedidos LGPD)
│   │   ├── paginas.js           # /:uf/:cidade/:atividade (SEO), /sitemap.xml, /privacidade, /termos
│   │   └── diagnostico.js       # análise por IA (Groq)
│   ├── paginas/                 # modelos de /privacidade e /termos
│   ├── db/
│   │   ├── schema.sql           # schema completo do banco
│   │   ├── import-fast.sh       # importação completa (só empresas ativas + Simples)
│   │   ├── import-simples.sh    # importa só o Simples Nacional (MEI)
│   │   ├── resume_estab.sh      # script de import (Estabelecimentos)
│   │   ├── filtro_estab.py      # filtro CSV por situação cadastral (padrão: só ativas) respeitando quoting da RFB
│   │   └── ...
│   ├── .env                     # variáveis de ambiente (não versionado)
│   └── package.json
└── public/
    ├── index.html                # painel (SPA single-file)
    ├── flags/                    # bandeiras dos estados
    ├── robots.txt
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
| `GET /api/empresas` | Lista paginada (máx. 200 por página) com total real. Parâmetros abaixo |
| `GET /api/empresas/bairros` | Bairros do escopo/atividade, com contagem |
| `GET /api/empresas/segmentos` | Segmentos prontos (Hospedagem, Bancos, Securitizadora) |
| `GET /api/empresas/cidades?estado=UF` | Municípios do estado com empresas ativas |
| `GET /api/empresas/cnaes?municipio=<codigo>` ou `?estado=UF` | CNAEs com quantidade de empresas, do maior para o menor |
| `GET /api/empresas/cnpj/:cnpj` | Detalhe de uma empresa por CNPJ |
| `GET /api/estados/info` | Dados dos 27 estados + empresas ativas e aberturas nos últimos 30 dias |
| `POST /api/remocao` | Pedido de remoção de CNPJ (LGPD) |
| `GET /api/health` | Health check |

Parâmetros de `/api/empresas` — todos os filtros valem para a base inteira, e o `total` usa o mesmo filtro:

| Parâmetro | Exemplo | Efeito |
|---|---|---|
| `municipio` **ou** `estado` | `7535` / `PR` | Escopo: um município ou o estado inteiro |
| `cnae` **ou** `segmento` | `5611201`, `5611-2/01`, `5611201,5611203` / `hospedagem` | Atividade |
| `secundario=1` | | Também procura no CNAE secundário |
| `q` | `alvaro`, `28.124` | Nome, fantasia, bairro, e-mail ou CNPJ (sem diferenciar acento) |
| `porte` | `MEI`, `ME`, `EPP`, `DEMAIS` | MEI vem da tabela `simples` |
| `abertura_dias` | `90` | Abertas nos últimos N dias |
| `bairro`, `tipo` | `BATEL`, `matriz`/`filial` | |
| `tem_telefone`, `tem_whatsapp`, `tem_email`, `sem_contador` | `1` | Contato válido / celular / e-mail / exclui e-mail de contabilidade |
| `ordem`, `dir` | `nome`/`abertura`/`porte`/`bairro`, `asc`/`desc` | Ordenação |

## Páginas (URLs do painel)

O endereço acompanha a navegação, então dá para compartilhar o link e usar o botão voltar:
`/pr` → municípios · `/pr/curitiba` → atividades · `/pr/curitiba/5611201` → empresas · `/pr/todo-o-estado/hospedagem` → segmento no estado inteiro · `?porte=MEI&whatsapp=1&pagina=2` → filtros.

O servidor entrega cada uma dessas URLs com título, descrição, canonical e Open Graph próprios ("Restaurantes e similares em Curitiba (PR): 5.679 empresas ativas"). URLs com filtros recebem `noindex`. O `/sitemap.xml` é gerado a partir do banco.

## LGPD — remoção de dados

`/privacidade` tem o formulário de remoção, que grava em `pedido_remocao`. Para aprovar um pedido (o CNPJ some de buscas, contagens e exportações):

```sql
INSERT INTO cnpj_oculto (cnpj, pedido_id) SELECT cnpj, id FROM pedido_remocao WHERE id = <protocolo>;
UPDATE pedido_remocao SET status = 'aprovado' WHERE id = <protocolo>;
```

Os pedidos pendentes: `SELECT * FROM pedido_remocao WHERE status = 'pendente' ORDER BY criado_em;`

## Variáveis de ambiente (`backend/.env`)

```
DATABASE_URL=postgresql://usuario:senha@localhost:5432/cnpj_rf
PORT=3002
DATABASE_SSL=false
CORS_ORIGIN=https://empresasativas.online
GROQ_API_KEY=            # reservado para enriquecimento por IA (futuro)
BRASILIO_TOKEN=          # fallback opcional via Brasil.IO quando a busca local retorna 0 resultados
RATE_LIMIT_POR_MINUTO=120    # consultas por IP por minuto na API
RATE_LIMIT_IA_POR_HORA=30
SITE_URL=https://www.empresasativas.online
SITE_RESPONSAVEL=        # nome/razão social e CNPJ do responsável (aparece em /privacidade e /termos)
SITE_EMAIL_CONTATO=      # e-mail de contato LGPD (opcional; sem ele, só o formulário)
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
- **Workflow "Deploy na VPS"** (GitHub → Actions → Run workflow): faz backup da pasta em `/root/backups`, guarda alterações locais num `git stash`, atualiza o código, roda `npm install`, aplica o `schema.sql`, importa o Simples (opcional, necessário uma vez para o porte MEI) e recarrega o PM2.

## Roadmap

- [ ] Importar tabela `socio` (quadro societário)
- [ ] Workflow de enriquecimento via IA (n8n): dados societários, site, redes sociais
- [ ] Mapa de municípios com geometria real (atualmente a navegação por município usa lista pesquisável, não um segundo mapa)
- [x] Paginação completa na tabela de resultados
- [ ] Login / chave de acesso por plano (hoje há limite de consultas por IP)

## Licença

Projeto privado — uso interno.
