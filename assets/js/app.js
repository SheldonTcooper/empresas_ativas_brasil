/* ═══════════════════════════════════════════════
   app.js — Navigation, table, CSV, AI, n8n
   ═══════════════════════════════════════════════ */

const S = {
  ibge: null, uf: null, ufNome: null,
  munId: null, munNome: null,
  cnae: null, cnaeNome: null,
  munList: [], companies: [], filtered: [],
  totalApi: 0, page: 1, source: 'demo',
  listMode: 'mun',
  _lvBackFn: null,
};

/* ════════ VIEW MANAGEMENT ════════ */

function showView(name) {
  document.getElementById('home-view').hidden = name !== 'home';
  document.getElementById('list-view').hidden = name !== 'list';
  document.getElementById('tbl-view').hidden  = name !== 'tbl';
}

/* ════════ NAVIGATION ════════ */

function selEstado(cod) {
  const e = EST[String(cod)]; if (!e) return;
  S.ibge = cod; S.uf = e.uf; S.ufNome = e.n;
  S.munId = null; S.munNome = null; S.cnae = null; S.cnaeNome = null;
  S.listMode = 'mun';
  refreshMapColors();
  crumbs();
  setLvBack('← Mapa do Brasil', goHome);
  setListHead(e.n, `${e.uf} · ${e.r} — selecione um município`, 'Buscar município...');
  showView('list');
  loadMuns();
}

function loadMuns() {
  lvItems('<div class="ld"><div class="sp"></div>Carregando municípios...</div>');
  fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${S.ibge}/municipios?orderBy=nome`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      S.munList = data.map(m => ({ id: m.id, nome: m.nome }));
      renderMuns(S.munList);
    })
    .catch(() => {
      S.munList = (FM[S.uf] || []).map((nome, i) => ({ id: i + 1, nome }));
      renderMuns(S.munList);
    });
}

function renderMuns(list) {
  if (!list.length) { lvItems('<div class="emp">Nenhum município encontrado</div>'); return; }
  lvGrid(list.map(m =>
    `<div class="lv-item" onclick="selMun(${m.id},'${_esc(m.nome)}')">
      <div class="lv-item-main">
        <div class="lv-item-title">${m.nome}</div>
        <div class="lv-item-sub">Cód. IBGE ${m.id}</div>
      </div>
      <span class="lv-item-arrow">›</span>
    </div>`
  ).join(''));
}

function selMun(id, nome) {
  S.munId = id; S.munNome = nome; S.cnae = null; S.cnaeNome = null;
  S.listMode = 'cnae';
  crumbs();
  setLvBack(`← ${S.ufNome}`, () => selEstado(S.ibge));
  setListHead(nome, `${S.ufNome} — selecione uma atividade (CNAE)`, 'Buscar atividade ou código CNAE...');
  renderCnaes(CNAES);
}

function renderCnaes(list) {
  if (!list.length) { lvItems('<div class="emp">Nenhuma atividade encontrada</div>'); return; }
  lvGrid(list.map(([c, d]) =>
    `<div class="lv-item" onclick="selCnae('${c}','${_esc(d)}')">
      <div class="lv-item-main">
        <div class="lv-item-title">${d}</div>
        <div class="lv-item-sub">CNAE ${c}</div>
      </div>
      <span class="lv-item-arrow">›</span>
    </div>`
  ).join(''));
}

function selCnae(cod, desc) {
  S.cnae = cod; S.cnaeNome = desc;
  crumbs();
  showTable(1);
}

function goHome() {
  S.ibge = null; S.uf = null; S.ufNome = null;
  S.munId = null; S.munNome = null; S.cnae = null; S.cnaeNome = null;
  showView('home');
  refreshMapColors();
  resetMapZoom();
  crumbs();
}

function backToMun() {
  S.cnae = null; S.cnaeNome = null;
  S.listMode = 'cnae';
  crumbs();
  setLvBack(`← ${S.ufNome}`, () => selEstado(S.ibge));
  setListHead(S.munNome, `${S.ufNome} — selecione uma atividade`, 'Buscar CNAE...');
  showView('list');
  renderCnaes(CNAES);
}

function lvBack() {
  if (S._lvBackFn) S._lvBackFn();
}

function setLvBack(label, fn) {
  S._lvBackFn = fn;
  document.getElementById('lv-back').textContent = label;
}

/* ════════ TABLE ════════ */

async function showTable(page) {
  showView('tbl');
  S.page = page || 1;
  document.getElementById('tbl-srch').value = '';
  document.getElementById('tbl-body').innerHTML =
    '<tr><td colspan="11" style="text-align:center;padding:40px">' +
    '<div class="sp" style="margin:0 auto 10px"></div>Carregando empresas...</td></tr>';

  const result = await fetchEmpresas(S.ibge, S.uf, S.munNome, S.cnae, S.page);
  S.companies = result.empresas;
  S.filtered  = result.empresas;
  S.totalApi  = result.total;
  S.source    = result.source;

  _updateTblHeader();
  renderRows(S.companies);
  _renderPagination();
}

function _updateTblHeader() {
  const cnt  = document.getElementById('tbl-cnt');
  const demo = document.getElementById('demo-badge');
  cnt.textContent = `${S.filtered.length} de ${S.totalApi.toLocaleString('pt-BR')} empresas`;
  demo.hidden     = S.source !== 'demo';
}

function renderRows(list) {
  document.getElementById('tbl-body').innerHTML = list.map((e, idx) => `
    <tr>
      <td class="td-cnpj">${e.cnpj}</td>
      <td><div style="font-weight:600;max-width:160px">${e.razao}</div></td>
      <td><div style="color:var(--t2);font-size:11px;max-width:120px">${e.fantasia || '—'}</div></td>
      <td>${e.tipo === 'MATRIZ'
            ? '<span class="bm">MATRIZ</span>'
            : '<span class="bf">FILIAL</span>'}</td>
      <td style="white-space:nowrap;font-size:11px">${e.abertura}</td>
      <td style="font-size:11px">${e.porte}</td>
      <td style="font-size:11px;white-space:nowrap">${e.tel1}${e.tel2 ? '<br>' + e.tel2 : ''}</td>
      <td style="font-size:11px;word-break:break-all;max-width:120px">${e.email || '—'}</td>
      <td style="font-size:11px;max-width:170px">
        ${e.logr}, ${e.num}${e.compl ? ', '+e.compl : ''}
        <br><span style="color:var(--t2)">${e.bairro}</span>
      </td>
      <td style="font-family:monospace;font-size:11px">${e.cep}</td>
      <td class="lks">
        <a href="${e.maps}" target="_blank" class="lk lk-mp">📍 Maps</a>
        ${e.wpp ? `<a href="${e.wpp}" target="_blank" class="lk lk-wp">💬 Wpp</a>` : ''}
        <a href="${e.linkedin}"  target="_blank" class="lk lk-li">in</a>
        <a href="${e.instagram}" target="_blank" class="lk lk-ig">📷 IG</a>
        <a href="${e.tiktok||'#'}" target="_blank" class="lk lk-tk" ${!e.tiktok?'style="display:none"':''}>🎵 TK</a>
        <a href="${e.facebook}"  target="_blank" class="lk lk-fb">f</a>
        ${e.site ? `<a href="${e.site}" target="_blank" class="lk lk-wb">🌐</a>` : ''}
        <button class="lk lk-ai" onclick="openDiag(${idx})" title="Diagnóstico IA">🤖 IA</button>
      </td>
    </tr>`
  ).join('') || '<tr><td colspan="11" class="emp">Nenhuma empresa encontrada</td></tr>';
}

function _renderPagination() {
  const el = document.getElementById('tbl-pages');
  if (!el) return;
  const totalPages = Math.ceil(S.totalApi / 50);
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const p = S.page;
  let h = `<span style="font-size:11px;color:var(--t2)">Página ${p} de ${totalPages}</span>`;
  if (p > 1) h += `<button class="btn btn-ghost btn-sm" onclick="showTable(${p-1})">‹ Anterior</button>`;
  if (p < totalPages) h += `<button class="btn btn-ghost btn-sm" onclick="showTable(${p+1})">Próxima ›</button>`;
  el.innerHTML = h;
}

function onTblSearch(v) {
  const t = v.toLowerCase();
  S.filtered = t
    ? S.companies.filter(e =>
        e.razao.toLowerCase().includes(t) ||
        e.cnpj.includes(t) ||
        (e.fantasia || '').toLowerCase().includes(t) ||
        (e.email    || '').toLowerCase().includes(t) ||
        (e.bairro   || '').toLowerCase().includes(t)
      )
    : S.companies;
  document.getElementById('tbl-cnt').textContent =
    `${S.filtered.length} de ${S.totalApi.toLocaleString('pt-BR')} empresas`;
  renderRows(S.filtered);
}

/* ════════ DIAGNÓSTICO IA ════════ */

function openDiag(idx) {
  const e = S.filtered[idx];
  document.getElementById('diag-modal').hidden = false;
  document.getElementById('diag-nome').textContent  = e.razao + (e.fantasia ? ` (${e.fantasia})` : '');
  document.getElementById('diag-cnae').textContent  = S.cnaeNome;
  document.getElementById('diag-porte').textContent = `${e.porte} · ${e.tipo} · desde ${e.abertura}`;
  document.getElementById('diag-body').innerHTML    =
    '<div class="ld"><div class="sp"></div>Analisando com IA Groq...</div>';

  fetchDiagnostico(e, S.cnaeNome)
    .then(d => _renderDiag(d))
    .catch(err => {
      document.getElementById('diag-body').innerHTML =
        `<div style="color:var(--red);padding:20px;text-align:center">
          ⚠ ${err.message.includes('GROQ_API_KEY')
            ? 'Configure GROQ_API_KEY no servidor backend.'
            : err.message}
        </div>`;
    });
}

function _renderDiag(d) {
  const potCor = { Alto:'var(--grn)', Médio:'var(--amb)', Baixo:'#ef4444' };
  const cor    = potCor[d.potencial] || 'var(--acc)';
  document.getElementById('diag-body').innerHTML = `
    <div class="diag-score-wrap">
      <div class="diag-score-ring" style="--score:${d.score};--cor:${cor}">
        <span>${d.score}</span><small>Score</small>
      </div>
      <div>
        <div class="diag-pot" style="color:${cor}">● Potencial ${d.potencial}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:4px">${d.justificativa}</div>
        <div class="diag-canal">🎯 Canal ideal: <b>${d.canal_ideal}</b></div>
      </div>
    </div>
    <div class="diag-sec">
      <div class="diag-sec-title">Perfil do negócio</div>
      <p>${d.perfil}</p>
    </div>
    <div class="diag-sec">
      <div class="diag-sec-title">Dicas de abordagem</div>
      <ul>${(d.abordagem || []).map(a => `<li>${a}</li>`).join('')}</ul>
    </div>
    ${d.tags?.length ? `<div class="diag-tags">${d.tags.map(t=>`<span class="diag-tag">${t}</span>`).join('')}</div>` : ''}
  `;
}

function closeDiag() {
  document.getElementById('diag-modal').hidden = true;
}

/* ════════ CSV EXPORT ════════ */

function exportCSV() {
  const headers = [
    'CNPJ','Razão Social','Nome Fantasia','Tipo','Abertura','Porte','CNAE',
    'Telefone 1','Telefone 2','E-mail','Logradouro','Nº','Complemento','Bairro',
    'Município','UF','CEP','Google Maps','WhatsApp','LinkedIn','Instagram','TikTok','Facebook','Site'
  ];
  const rows = S.filtered.map(e => [
    e.cnpj, e.razao, e.fantasia||'', e.tipo, e.abertura, e.porte, S.cnae,
    e.tel1, e.tel2||'', e.email||'', e.logr, e.num, e.compl||'', e.bairro,
    S.munNome, S.uf, e.cep, e.maps, e.wpp||'', e.linkedin, e.instagram,
    e.tiktok||'', e.facebook, e.site||''
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));

  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');

  navigator.clipboard.writeText(csv)
    .then(() => {
      const btn = document.getElementById('exp-btn');
      btn.textContent = '✓ Copiado!'; btn.style.background = '#14b8a6';
      setTimeout(() => { btn.textContent = '↓ Exportar CSV'; btn.style.background = ''; }, 2500);
    })
    .catch(() => {
      document.getElementById('csv-ta').value = csv;
      document.getElementById('csv-modal').hidden = false;
    });
}

function copiarCSV() {
  const ta = document.getElementById('csv-ta');
  ta.select(); ta.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(ta.value)
    .then(() => { document.getElementById('csv-modal').hidden = true; })
    .catch(() => {});
}

/* ════════ n8n EXPORT ════════ */

async function exportN8n() {
  const btn = document.getElementById('n8n-btn');
  if (!btn) return;
  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  try {
    await sendToN8n({
      timestamp: new Date().toISOString(), estado: S.uf, estado_nome: S.ufNome,
      municipio: S.munNome, municipio_ibge: S.ibge, cnae: S.cnae, cnae_desc: S.cnaeNome,
      total_filtrado: S.filtered.length, source: S.source, empresas: S.filtered,
    });
    btn.textContent = '✓ Enviado!'; btn.style.background = '#14b8a6';
    setTimeout(() => { btn.textContent = '⚡ Enviar n8n'; btn.style.background = ''; btn.disabled = false; }, 3000);
  } catch (err) {
    btn.textContent = '✗ Erro';
    setTimeout(() => { btn.textContent = '⚡ Enviar n8n'; btn.disabled = false; }, 3000);
    alert('Erro ao enviar para n8n:\n' + err.message + '\n\nConfigure window.N8N_WEBHOOK no app.');
  }
}

/* ════════ SEARCH ════════ */

function onSearch(v) {
  const t = v.toLowerCase().trim();
  if (S.listMode === 'mun') {
    renderMuns(S.munList.filter(m => m.nome.toLowerCase().includes(t)));
  } else {
    renderCnaes(CNAES.filter(([c, d]) => d.toLowerCase().includes(t) || c.includes(t)));
  }
}

/* ════════ UI HELPERS ════════ */

function crumbs() {
  let h = `<span class="crumb" onclick="goHome()">🇧🇷 Brasil</span>`;
  if (S.ufNome) {
    const clk = S.munId ? `onclick="selEstado('${S.ibge}')"` : '';
    h += `<span class="csep">›</span>
          <span class="crumb${S.munId ? '' : ' cur'}" ${clk}>${S.uf} — ${S.ufNome}</span>`;
  }
  if (S.munNome) {
    const clk = S.cnae ? `onclick="selMun(${S.munId},'${_esc(S.munNome)}')"` : '';
    h += `<span class="csep">›</span>
          <span class="crumb${S.cnae ? '' : ' cur'}" ${clk}>${S.munNome}</span>`;
  }
  if (S.cnaeNome) {
    h += `<span class="csep">›</span><span class="crumb cur">CNAE ${S.cnae}</span>`;
  }
  document.getElementById('crumbs').innerHTML = h;
}

function setListHead(title, sub, ph) {
  document.getElementById('lv-title').textContent = title;
  document.getElementById('lv-sub').textContent   = sub;
  document.getElementById('lv-srch').placeholder  = ph;
  document.getElementById('lv-srch').value        = '';
}

function lvItems(html) {
  document.getElementById('lv-items').innerHTML = html;
}

function lvGrid(html) {
  document.getElementById('lv-items').innerHTML = `<div class="lv-grid">${html}</div>`;
}

function renderEstados() { /* no-op – states are selected via map only */ }

function _esc(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

/* ════════ INIT ════════ */
window.addEventListener('DOMContentLoaded', () => {
  crumbs();
  /* setTimeout 0 garante que o layout CSS está calculado antes de initMap
     ler getBoundingClientRect() do #map-wrap */
  setTimeout(initMap, 0);
});
