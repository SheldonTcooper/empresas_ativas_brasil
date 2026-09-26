/* ═══════════════════════════════════════════════
   map.js — D3 choropleth map of Brazil
   Renders an interactive SVG map using IBGE GeoJSON.
   Falls back to centroid circles if the API is unavailable.
   ═══════════════════════════════════════════════ */

let _svgEl, _projFn, _pathFn, _geoData, _zoomBeh, _gEl;

const _colorScale = d3.scaleThreshold()
  .domain([200000, 500000, 1000000, 3000000])
  .range(['#1d3461', '#1e4d8c', '#2563eb', '#3b82f6', '#60a5fa']);

/* Approximate state centroids [lon, lat] for fallback */
const _CENTS = {
  '11':[-63.0,-10.8],'12':[-70.5,-9.0], '13':[-64.6,-4.5], '14':[-61.4,1.7],
  '15':[-52.5,-4.5], '16':[-51.8,1.5],  '17':[-48.3,-10.2],'21':[-44.5,-5.4],
  '22':[-42.8,-7.7], '23':[-39.4,-5.2], '24':[-36.8,-5.8], '25':[-36.8,-7.2],
  '26':[-37.8,-8.5], '27':[-36.6,-9.7], '28':[-37.4,-10.6],'29':[-41.7,-12.5],
  '31':[-44.5,-18.5],'32':[-40.6,-19.6],'33':[-43.2,-22.0],'35':[-48.5,-22.2],
  '41':[-51.5,-24.8],'42':[-50.5,-27.2],'43':[-53.4,-30.0],
  '50':[-54.8,-20.5],'51':[-55.9,-13.0],'52':[-49.5,-16.0],'53':[-47.9,-15.8],
};

function _stateColor(cod) {
  /* Selected state → teal highlight */
  if (typeof S !== 'undefined' && S.ibge === cod) return '#14b8a6';
  const e = EST[String(cod)];
  return e ? _colorScale(e.e) : '#1a2744';
}

function initMap() {
  if (typeof d3 === 'undefined') { console.error('[map] D3 não carregado'); return; }

  const wrap = document.getElementById('map-wrap');
  /* clientWidth/Height pode ser 0 se o flex-layout ainda não computou */
  const W = wrap.clientWidth  || wrap.offsetWidth  || Math.round(window.innerWidth  * 0.72);
  const H = wrap.clientHeight || wrap.offsetHeight || Math.round(window.innerHeight * 0.85);

  _svgEl = d3.select('#map-wrap').append('svg')
    .attr('width', '100%').attr('height', '100%')
    .style('display', 'block');

  _gEl = _svgEl.append('g').attr('class', 'geo-group');

  _zoomBeh = d3.zoom()
    .scaleExtent([0.6, 16])
    .on('zoom', e => _gEl.attr('transform', e.transform));

  _svgEl.call(_zoomBeh);

  _projFn = d3.geoMercator()
    .center([-54, -15])
    .scale(H * 1.55)
    .translate([W / 2, H / 2 + 30]);

  _pathFn = d3.geoPath().projection(_projFn);

  /* Renderiza círculos imediatamente — sem esperar rede */
  _renderFallback();

  /* Tenta IBGE em background para upgrade para polígonos */
  const IBGE_URL =
    'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR' +
    '?formato=application/vnd.geo%2Bjson&divisao=UF&resolucao=2';

  fetch(IBGE_URL)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(gj => {
      _geoData = gj;
      _gEl.selectAll('*').remove(); /* remove circles */
      _renderGeoJSON();
    })
    .catch(() => { /* circles already showing — nothing to do */ });
}

function _renderGeoJSON() {
  const tip  = document.getElementById('map-tip');
  const wrap = document.getElementById('map-wrap');

  _gEl.selectAll('path.state-path')
    .data(_geoData.features)
    .join('path')
    .attr('class', 'state-path')
    .attr('d', _pathFn)
    .attr('fill',   d => _stateColor(d.properties.codarea))
    .attr('stroke', '#07101f')
    .attr('stroke-width', 1.2)
    .on('click', (ev, d) => {
      ev.stopPropagation();
      if (typeof selEstado === 'function') selEstado(String(d.properties.codarea));
    })
    .on('mousemove', (ev, d) => {
      const e = EST[String(d.properties.codarea)];
      if (!e) return;
      const rect = wrap.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.left = (ev.clientX - rect.left + 14) + 'px';
      tip.style.top  = (ev.clientY - rect.top  - 12) + 'px';
      tip.innerHTML  = `<b>${e.n}</b>&nbsp;<span style="color:var(--t2)">${e.uf}</span><br>
        <span style="color:var(--teal)">${e.e.toLocaleString('pt-BR')}</span>
        <span style="color:var(--t2)"> empresas ativas</span>`;
    })
    .on('mouseleave', () => { tip.style.display = 'none'; });

  /* State UF labels */
  _gEl.selectAll('text.state-lbl')
    .data(_geoData.features)
    .join('text')
    .attr('class', 'state-lbl')
    .attr('transform', d => `translate(${_pathFn.centroid(d)})`)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', 'rgba(255,255,255,0.72)')
    .attr('font-size', '8px')
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    .text(d => EST[String(d.properties.codarea)]?.uf || '');

  if (typeof renderEstados === 'function') renderEstados(Object.entries(EST));
}

function _renderFallback() {
  const wrap = document.getElementById('map-wrap');
  const tip  = document.getElementById('map-tip');

  Object.entries(_CENTS).forEach(([cod, [lon, lat]]) => {
    const e = EST[cod]; if (!e) return;
    const [cx, cy] = _projFn([lon, lat]);
    const r = Math.min(Math.max(e.e / 80000, 9), 48);

    _gEl.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .attr('fill', _stateColor(cod))
      .attr('stroke', '#07101f').attr('stroke-width', 1.2)
      .attr('class', 'state-path').style('cursor', 'pointer')
      .attr('data-cod', cod)
      .on('click', () => { if (typeof selEstado === 'function') selEstado(cod); })
      .on('mousemove', ev => {
        const rect = wrap.getBoundingClientRect();
        tip.style.display = 'block';
        tip.style.left = (ev.clientX - rect.left + 14) + 'px';
        tip.style.top  = (ev.clientY - rect.top  - 12) + 'px';
        tip.innerHTML = `<b>${e.n}</b>&nbsp;<span style="color:var(--t2)">${e.uf}</span><br>
          <span style="color:var(--teal)">${e.e.toLocaleString('pt-BR')}</span>
          <span style="color:var(--t2)"> empresas</span>`;
      })
      .on('mouseleave', () => { tip.style.display = 'none'; });

    _gEl.append('text')
      .attr('x', cx).attr('y', cy).attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('fill', 'rgba(255,255,255,0.8)').attr('font-size', '8px').attr('font-weight', '700')
      .attr('pointer-events', 'none').text(e.uf);
  });

  if (typeof renderEstados === 'function') renderEstados(Object.entries(EST));
}

function refreshMapColors() {
  if (_geoData) {
    _gEl.selectAll('path.state-path')
      .attr('fill',         d => _stateColor(d.properties.codarea))
      .attr('stroke-width', d => (typeof S !== 'undefined' && S.ibge === String(d.properties.codarea)) ? 2.5 : 1.2);
  } else {
    _gEl.selectAll('circle.state-path')
      .attr('fill', function () {
        return _stateColor(d3.select(this).attr('data-cod'));
      });
  }
}

function zoomToState(cod) {
  if (!_geoData) return;
  const feat = _geoData.features.find(f => String(f.properties.codarea) === cod);
  if (!feat) return;
  const wrap = document.getElementById('map-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const [[x0, y0], [x1, y1]] = _pathFn.bounds(feat);
  const dx = x1 - x0, dy = y1 - y0;
  const scale = Math.max(0.5, Math.min(12, 0.85 / Math.max(dx / W, dy / H)));
  const tx = W / 2 - scale * (x0 + x1) / 2;
  const ty = H / 2 - scale * (y0 + y1) / 2;
  _svgEl.transition().duration(650)
    .call(_zoomBeh.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function resetMapZoom() {
  _svgEl.transition().duration(500).call(_zoomBeh.transform, d3.zoomIdentity);
}
function zoomIn()  { _svgEl.transition().duration(300).call(_zoomBeh.scaleBy, 1.5); }
function zoomOut() { _svgEl.transition().duration(300).call(_zoomBeh.scaleBy, 0.67); }
