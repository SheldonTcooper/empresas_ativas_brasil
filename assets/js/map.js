/* ═══════════════════════════════════════════════
   map.js — D3 choropleth map of Brazil
   ═══════════════════════════════════════════════ */

let _svgEl, _projFn, _pathFn, _geoData, _zoomBeh, _gEl;
let _mapW = 0, _mapH = 0;

const _colorScale = d3.scaleThreshold()
  .domain([200000, 500000, 1000000, 3000000])
  .range(['#1e3a8a', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd']);

const _CENTS = {
  '11':[-63.0,-10.8],'12':[-70.5,-9.0], '13':[-64.6,-4.5], '14':[-61.4,1.7],
  '15':[-52.5,-4.5], '16':[-51.8,1.5],  '17':[-48.3,-10.2],'21':[-44.5,-5.4],
  '22':[-42.8,-7.7], '23':[-39.4,-5.2], '24':[-36.8,-5.8], '25':[-36.8,-7.2],
  '26':[-37.8,-8.5], '27':[-36.6,-9.7], '28':[-37.4,-10.6],'29':[-41.7,-12.5],
  '31':[-44.5,-18.5],'32':[-40.6,-19.6],'33':[-43.2,-22.0],'35':[-48.5,-22.2],
  '41':[-51.5,-24.8],'42':[-50.5,-27.2],'43':[-53.4,-30.0],
  '50':[-54.8,-20.5],'51':[-55.9,-13.0],'52':[-49.5,-16.0],'53':[-47.9,-15.8],
};

const _BRAZIL_BOX = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[-74,6],[-34,6],[-34,-35],[-74,-35],[-74,6]]]
  }
};

function _stateColor(cod) {
  if (typeof S !== 'undefined' && S.ibge === String(cod)) return '#14b8a6';
  const e = EST[String(cod)];
  return e ? _colorScale(e.e) : '#1a2744';
}

function initMap() {
  if (typeof d3 === 'undefined') { console.error('[map] D3 ausente'); return; }

  const hdr  = document.getElementById('hdr');
  const wrap = document.getElementById('map-wrap');
  const hdrH = hdr ? hdr.offsetHeight : 52;

  _mapW = window.innerWidth;
  _mapH = window.innerHeight - hdrH;

  /* ── Forçar dimensões via JS (ignora todo o CSS de layout) ── */
  wrap.setAttribute('style', [
    'position:absolute',
    'top:'    + hdrH  + 'px',
    'left:0',
    'width:'  + _mapW + 'px',
    'height:' + _mapH + 'px',
    'background:#07101f',
    'overflow:hidden',
  ].join(';') + ';');

  /* Limpa SVG anterior */
  d3.select(wrap).selectAll('svg').remove();
  _geoData = null;

  _svgEl = d3.select(wrap).append('svg')
    .attr('width',  _mapW)
    .attr('height', _mapH)
    .style('display', 'block');

  _gEl = _svgEl.append('g').attr('class', 'geo-group');

  _zoomBeh = d3.zoom()
    .scaleExtent([0.6, 16])
    .on('zoom', e => _gEl.attr('transform', e.transform));
  _svgEl.call(_zoomBeh);

  _projFn = d3.geoMercator();
  _projFn.fitExtent([[24, 24], [_mapW - 24, _mapH - 24]], _BRAZIL_BOX);
  _pathFn = d3.geoPath().projection(_projFn);

  _renderFallback();

  /* Uma única chamada IBGE para todos os 27 estados */
  fetch('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR' +
        '?intrarregiao=UF&resolucao=2&formato=application/vnd.geo%2Bjson')
    .then(r => { if (!r.ok) throw r.status; return r.json(); })
    .then(gj => {
      if (!gj || !gj.features || gj.features.length === 0) return;
      _geoData = gj;
      _gEl.selectAll('*').remove();
      _renderGeoJSON();
    })
    .catch(() => { /* mantém círculos de fallback */ });
}

function _renderGeoJSON() {
  const wrap = document.getElementById('map-wrap');
  const tip  = document.getElementById('map-tip');

  /* Refit projeção para as dimensões atuais */
  _projFn.fitExtent([[24, 24], [_mapW - 24, _mapH - 24]], _geoData);
  _pathFn = d3.geoPath().projection(_projFn);

  _gEl.selectAll('path.state-path')
    .data(_geoData.features)
    .join('path')
    .attr('class', 'state-path')
    .attr('d', _pathFn)
    .style('fill', d => _stateColor(d.properties.codarea))
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 0.7)
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
      tip.innerHTML = `<b>${e.n}</b> <span style="color:var(--t2)">${e.uf}</span><br>
        <span style="color:var(--teal)">${e.e.toLocaleString('pt-BR')}</span>
        <span style="color:var(--t2)"> empresas ativas</span>`;
    })
    .on('mouseleave', () => { tip.style.display = 'none'; });

  _gEl.selectAll('text.state-lbl')
    .data(_geoData.features)
    .join('text')
    .attr('class', 'state-lbl')
    .attr('transform', d => {
      const c = _pathFn.centroid(d);
      return isNaN(c[0]) ? null : `translate(${c})`;
    })
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#fff')
    .attr('font-size', '8px')
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    .attr('paint-order', 'stroke')
    .attr('stroke', '#07101f')
    .attr('stroke-width', '3px')
    .text(d => EST[String(d.properties.codarea)]?.uf || '');
}

function _renderFallback() {
  const wrap = document.getElementById('map-wrap');
  const tip  = document.getElementById('map-tip');

  Object.entries(_CENTS).forEach(([cod, lonlat]) => {
    const e = EST[cod]; if (!e) return;
    const pt = _projFn(lonlat);
    if (!pt || isNaN(pt[0]) || isNaN(pt[1])) return;
    const [cx, cy] = pt;
    const r = Math.min(Math.max(e.e / 80000, 8), 44);

    _gEl.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .style('fill', _stateColor(cod))
      .attr('stroke', '#94a3b8').attr('stroke-width', 1)
      .attr('class', 'state-path').style('cursor', 'pointer')
      .attr('data-cod', cod)
      .on('click', ev => {
        ev.stopPropagation();
        if (typeof selEstado === 'function') selEstado(cod);
      })
      .on('mousemove', ev => {
        const rect = wrap.getBoundingClientRect();
        tip.style.display = 'block';
        tip.style.left = (ev.clientX - rect.left + 14) + 'px';
        tip.style.top  = (ev.clientY - rect.top  - 12) + 'px';
        tip.innerHTML = `<b>${e.n}</b> <span style="color:var(--t2)">${e.uf}</span><br>
          <span style="color:var(--teal)">${e.e.toLocaleString('pt-BR')}</span>
          <span style="color:var(--t2)"> empresas</span>`;
      })
      .on('mouseleave', () => { tip.style.display = 'none'; });

    _gEl.append('text')
      .attr('x', cx).attr('y', cy)
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('fill', '#fff').attr('font-size', '7px').attr('font-weight', '700')
      .attr('pointer-events', 'none')
      .attr('paint-order', 'stroke').attr('stroke', '#07101f').attr('stroke-width', '2px')
      .text(e.uf);
  });
}

function refreshMapColors() {
  if (_geoData) {
    _gEl.selectAll('path.state-path')
      .style('fill', d => _stateColor(d.properties.codarea))
      .attr('stroke-width', d =>
        (typeof S !== 'undefined' && S.ibge === String(d.properties.codarea)) ? 2 : 0.7);
  } else {
    _gEl.selectAll('circle.state-path')
      .style('fill', function() { return _stateColor(d3.select(this).attr('data-cod')); });
  }
}

function zoomToState(cod) {
  if (!_geoData || !_svgEl) return;
  const feat = _geoData.features.find(f => String(f.properties.codarea) === cod);
  if (!feat) return;
  const [[x0,y0],[x1,y1]] = _pathFn.bounds(feat);
  const scale = Math.max(0.5, Math.min(12, 0.8 / Math.max((x1-x0)/_mapW, (y1-y0)/_mapH)));
  const tx = _mapW/2 - scale*(x0+x1)/2;
  const ty = _mapH/2 - scale*(y0+y1)/2;
  _svgEl.transition().duration(650)
    .call(_zoomBeh.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function resetMapZoom() {
  if (_svgEl) _svgEl.transition().duration(500).call(_zoomBeh.transform, d3.zoomIdentity);
}
function zoomIn()  { if (_svgEl) _svgEl.transition().duration(300).call(_zoomBeh.scaleBy, 1.5); }
function zoomOut() { if (_svgEl) _svgEl.transition().duration(300).call(_zoomBeh.scaleBy, 0.67); }

/* Reinicializa ao redimensionar a janela */
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(initMap, 250);
});
