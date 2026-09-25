/* ═══════════════════════════════════════════════
   app.js — Application logic: navigation, table, CSV export
   ═══════════════════════════════════════════════ */

/* ── App State ── */
const S = {
  ibge: null, uf: null, ufNome: null,
  munId: null, munNome: null,
  cnae: null, cnaeNome: null,
  munList: [], companies: [], filtered: [],
};

/* ════════ NAVIGATION ════════ */

function selEstado(cod) {
  const e = EST[String(cod)]; if (!e) return;
  S.ibge = cod; S.uf = e.uf; S.ufNome = e.n;
  S.munId = null; S.munNome = null; S.cnae = null; S.cnaeNome = null;
  refreshMapColors();
  zoomToState(cod);
  crumbs();
  setNav(e.n, `${e.uf} · Selecione um município`, 'Buscar município...');
  loadMuns();
}

function loadMuns() {
  nl('<div class="ld"><div class="sp"></div>Carregando municípios...</div>');
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
  if (!list.length) { nl('<div class="emp">Nenhum município encontrado</div>'); return; }
  nl(list.map(m =>
    `<div class="item" onclick="selMun(${m.id}, '${_esc(m.nome)}')">
      <div>
        <div class="i-title">${m.nome}</div>
        <div class="i-sub">Cód. IBGE ${m.id}</div>
      </div>
    </div>`
  ).join(''));
}

function selMun(id, nome) {
  S.munId = id; S.munNome = nome; S.cnae = null; S.cnaeNome = null;
  crumbs();
  setNav(nome, `${S.ufNome} · Selecione uma atividade (CNAE)`, 'Buscar atividade ou CNAE...');
  renderCnaes(CNAES);
}

function renderCnaes(list) {
  nl(list.map(([c, d]) =>
    `<div class="item" onclick="selCnae('${c}', '${_esc(d)}')">
      <div>
        <div class="i-title">${d}</div>
        <div class="i-sub">CNAE ${c}</div>
      </div>
    </div>`
  ).join('') || '<div class="emp">Nenhuma atividade encontrada</div>');
}

function selCnae(cod, desc) {
  S.cnae = cod; S.cnaeNome = desc;
  crumbs();
  showTable();
}

function goHome() {
  S.ibge = null; S.uf = null; S.ufNome = null;
  S.munId = null; S.munNome = null; S.cnae = null; S.cnaeNome = null;
  hideTable();
  resetMapZoom();
  refreshMapColors();
  crumbs();
  setNav('Estados do Brasil', 'Clique no mapa ou escolha na lista', 'Buscar estado...');
  renderEstados(Object.entries(EST));
}

function backToMun() {
  S.cnae = null; S.cnaeNome = null;
  hideTable();
  crumbs();
  setNav(S.munNome, `${S.ufNome} · Selecione uma atividade`, 'Buscar CNAE...');
  renderCnaes(CNAES);
}

/* ════════ TABLE ════════ */

function showTable() {
  document.getElementById('main').hidden = true;
  document.getElementById('tbl-view').hidden = false;
  S.companies = genEmpresas(S.uf, S.munNome, S.cnae);
  S.filtered  = S.companies;
  document.getElementById('tbl-srch').value = '';
  document.getElementById('tbl-cnt').textContent = `${S.companies.length} registros`;
  renderRows(S.companies);
}

function hideTable() {
  document.getElementById('main').hidden = false;
  document.getElementById('tbl-view').hidden = true;
}

function renderRows(list) {
  document.getElementById('tbl-body').innerHTML = list.map(e => `
    <tr>
      <td class="td-cnpj">${e.cnpj}</td>
      <td><div style="font-weight:600;max-width:160px">${e.razao}</div></td>
      <td><div style="color:var(--t2);font-size:11px;max-width:120px">${e.fantasia || '—'}</div></td>
      <td>${e.tipo === 'MATRIZ' ? '<span class="bm">MATRIZ</span>' : '<span class="bf">FILIAL</span>'}</td>
      <td style="white-space:nowrap;font-size:11px">${e.abertura}</td>
      <td style="font-size:11px">${e.porte}</td>
      <td style="font-size:11px;white-space:nowrap">${e.tel1}${e.tel2 ? '<br>' + e.tel2 : ''}</td>
      <td style="font-size:11px;word-break:break-all;max-width:120px">${e.email || '—'}</td>
      <td style="font-size:11px;max-width:170px">
        ${e.logr}, ${e.num}${e.compl ? ', ' + e.compl : ''}
        <br><span style="color:var(--t2)">${e.bairro}</span>
      </td>
      <td style="font-family:monospace;font-size:11px">${e.cep}</td>
      <td class="lks">
        <a href="${e.maps}"      target="_blank" class="lk lk-mp">📍 Maps</a>
        ${e.wpp ? `<a href="${e.wpp}" target="_blank" class="lk lk-wp">💬 Wpp</a>` : ''}
        <a href="${e.linkedin}"  target="_blank" class="lk lk-li">in</a>
        <a href="${e.instagram}" target="_blank" class="lk lk-ig">📷 IG</a>
        <a href="${e.facebook}"  target="_blank" class="lk lk-fb">f FB</a>
        ${e.site ? `<a href="${e.site}" target="_blank" class="lk lk-wb">🌐</a>` : ''}
      </td>
    </tr>`
  ).join('');
}

function onTblSearch(v) {
  const t = v.toLowerCase();
  S.filtered = t
    ? S.companies.filter(e =>
        e.razao.toLowerCase().includes(t) ||
        e.cnpj.includes(t) ||
        (e.fantasia || '').toLowerCase().includes(t) ||
        (e.email    || '').toLowerCase().includes(t) ||
        e.bairro.toLowerCase().includes(t)
      )
    : S.companies;
  document.getElementById('tbl-cnt').textContent = `${S.filtered.length} registros`;
  renderRows(S.filtered);
}

/* ════════ CSV EXPORT ════════ */

function exportCSV() {
  const headers = [
    'CNPJ','Razão Social','Nome Fantasia','Tipo','Abertura','Porte','CNAE',
    'Telefone 1','Telefone 2','E-mail','Logradouro','Nº','Complemento','Bairro',
    'Município','UF','CEP','Google Maps','WhatsApp','LinkedIn','Instagram','Facebook','Site'
  ];
  const rows = S.filtered.map(e => [
    e.cnpj, e.razao, e.fantasia || '', e.tipo, e.abertura, e.porte, S.cnae,
    e.tel1, e.tel2 || '', e.email || '', e.logr, e.num, e.compl || '', e.bairro,
    S.munNome, S.uf, e.cep, e.maps, e.wpp || '', e.linkedin, e.instagram, e.facebook, e.site || ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv = '﻿' + [headers.join(','), ...rows].join('\n');

  navigator.clipboard.writeText(csv)
    .then(() => {
      const btn = document.getElementById('exp-btn');
      btn.textContent = '✓ Copiado!';
      btn.style.background = '#14b8a6';
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

/* ════════ SEARCH ════════ */

function onSearch(v) {
  const t = v.toLowerCase().trim();
  if (!S.uf && !S.munId) {
    renderEstados(Object.entries(EST).filter(([, e]) =>
      e.n.toLowerCase().includes(t) || e.uf.toLowerCase().includes(t)
    ));
  } else if (S.uf && !S.munId) {
    renderMuns(S.munList.filter(m => m.nome.toLowerCase().includes(t)));
  } else if (S.munId) {
    renderCnaes(CNAES.filter(([c, d]) =>
      d.toLowerCase().includes(t) || c.includes(t)
    ));
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
    const clk = S.cnae ? `onclick="selMun(${S.munId}, '${_esc(S.munNome)}')"` : '';
    h += `<span class="csep">›</span>
          <span class="crumb${S.cnae ? '' : ' cur'}" ${clk}>${S.munNome}</span>`;
  }
  if (S.cnaeNome) {
    h += `<span class="csep">›</span><span class="crumb cur">CNAE ${S.cnae}</span>`;
  }
  document.getElementById('crumbs').innerHTML = h;
}

function setNav(title, sub, ph) {
  document.getElementById('nav-title').textContent = title;
  document.getElementById('nav-sub').textContent   = sub;
  document.getElementById('srch').placeholder      = ph;
  document.getElementById('srch').value            = '';
}

function nl(html) { document.getElementById('nav-list').innerHTML = html; }

function renderEstados(entries) {
  const sorted = [...entries].sort((a, b) => b[1].e - a[1].e);
  nl(sorted.map(([cod, e]) => `
    <div class="item" onclick="selEstado('${cod}')">
      <div class="item-body">
        <div class="i-title">${e.n}</div>
        <div class="i-sub">${e.uf} · ${e.r}</div>
      </div>
      <div class="i-badge">
        ${e.e >= 1e6 ? (e.e / 1e6).toFixed(1) + 'M' : (e.e / 1e3).toFixed(0) + 'k'}
      </div>
    </div>`
  ).join(''));
}

function _esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ════════ INIT ════════ */
window.addEventListener('DOMContentLoaded', () => {
  crumbs();
  setNav('Estados do Brasil', 'Clique no mapa ou escolha na lista', 'Buscar estado...');
  initMap();
});
