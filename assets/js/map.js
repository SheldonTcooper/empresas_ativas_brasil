/* ═══════════════════════════════════════════════
   map.js — D3 choropleth map of Brazil
   ═══════════════════════════════════════════════ */

let _svgEl, _projFn, _pathFn, _geoData, _zoomBeh, _gEl;

const _colorScale = d3.scaleThreshold()
  .domain([200000, 500000, 1000000, 3000000])
  .range(['#1e3a8a', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd']);

/* Approximate state centroids [lon, lat] */
const _CENTS = {
  '11':[-63.0,-10.8],'12':[-70.5,-9.0], '13':[-64.6,-4.5], '14':[-61.4,1.7],
  '15':[-52.5,-4.5], '16':[-51.8,1.5],  '17':[-48.3,-10.2],'21':[-44.5,-5.4],
  '22':[-42.8,-7.7], '23':[-39.4,-5.2], '24':[-36.8,-5.8], '25':[-36.8,-7.2],
  '26':[-37.8,-8.5], '27':[-36.6,-9.7], '28':[-37.4,-10.6],'29':[-41.7,-12.5],
  '31':[-44.5,-18.5],'32':[-40.6,-19.6],'33':[-43.2,-22.0],'35':[-48.5,-22.2],
  '41':[-51.5,-24.8],'42':[-50.5,-27.2],'43':[-53.4,-30.0],
  '50':[-54.8,-20.5],'51':[-55.9,-13.0],'52':[-49.5,-16.0],'53':[-47.9,-15.8],
};

/* Bounding box polygon of Brazil for reliable fitExtent */
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

function _dims() {
  const wrap = document.getElementById('map-wrap');
  return {
    W: wrap.clientWidth  || wrap.offsetWidth  || Math.round(window.innerWidth  * 0.9),
    H: wrap.clientHeight || wrap.offsetHeight || Math.round(window.innerHeight * 0.9),
  };
}

function initMap() {
  if (typeof d3 === 'undefined') { console.error('[map] D3 não carregado'); return; }

  const { W, H } = _dims();

  _svgEl = d3.select('#map-wrap').append('svg')
    .attr('width', '100%').attr('height', '100%')
    .style('display', 'block');

  _gEl = _svgEl.append('g').attr('class', 'geo-group');

  _zoomBeh = d3.zoom()
    .scaleExtent([0.6, 16])
    .on('zoom', e => _gEl.attr('transform', e.transform));

  _svgEl.call(_zoomBeh);

  _projFn = d3.geoMercator();
  _projFn.fitExtent([[20, 20], [W - 20, H - 20]], _BRAZIL_BOX);
  _pathFn = d3.geoPath().projection(_projFn);

  _renderFallback();

  const CODES = ['11','12','13','14','15','16','17','21','22','23','24',
                 '25','26','27','28','29','31','32','33','35','41','42',
                 '43','50','51','52','53'];
  const IBGE_BASE   = 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/';
  const IBGE_PARAMS = '?formato=application/vnd.geo%2Bjson&resolucao=2';

  Promise.all(CODES.map(code =>
    fetch(IBGE_BASE + code + IBGE_PARAMS)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(gj => {
        const feat = gj.features ? gj.features[0] : gj;
        return { type: 'Feature', geometry: feat.geometry, properties: { codarea: code } };
      })
      .catch(() => null)
  )).then(features => {
    const valid = features.filter(Boolean);
    if (!valid.length) return;
    _geoData = { type: 'FeatureCollection', features: valid };
    _gEl.selectAll('*').remove();
    _renderGeoJSON();
  }).catch(() => {});
}

function _renderGeoJSON() {
  const { W, H } = _dims();
  const tip  = document.getElementById('map-tip');
  const wrap = document.getElementById('map-wrap');

  _projFn.fitExtent([[20, 20], [W - 20, H - 20]], _geoData);
  _pathFn = d3.geoPath().projection(_projFn);

  _gEl.selectAll('path.state-path')
    .data(_geoData.features)
    .join('path')
    .attr('class', 'state-path')
    .attr('d', _pathFn)
    .style('fill', d => _stateColor(d.properties.codarea))
    .attr('stroke', '#334155')
    .attr('stroke-width', 0.8)
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
}

function _renderFallback() {
  const { W, H } = _dims();
  const wrap = document.getElementById('map-wrap');
  const tip  = document.getElementById('map-tip');

  /* _projFn already fitted to _BRAZIL_BOX in initMap */

  Object.entries(_CENTS).forEach(([cod, lonlat]) => {
    const e = EST[cod]; if (!e) return;
    const pt = _projFn(lonlat);
    if (!pt || isNaN(pt[0]) || isNaN(pt[1])) return;
    const [cx, cy] = pt;
    const r = Math.min(Math.max(e.e / 80000, 9), 48);

    _gEl.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .style('fill', _stateColor(cod))
      .attr('stroke', '#334155').attr('stroke-width', 0.8)
      .attr('class', 'state-path').style('cursor', 'pointer')
      .attr('data-cod', cod)
      .on('click', (ev) => {
        ev.stopPropagation();
        if (typeof selEstado === 'function') selEstado(cod);
      })
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
      .attr('fill', 'rgba(255,255,255,0.85)').attr('font-size', '8px').attr('font-weight', '700')
      .attr('pointer-events', 'none').text(e.uf);
  });
}

function refreshMapColors() {
  if (_geoData) {
    _gEl.selectAll('path.state-path')
      .style('fill',        d => _stateColor(d.properties.codarea))
      .attr('stroke-width', d => (typeof S !== 'undefined' && S.ibge === String(d.properties.codarea)) ? 2.5 : 1.2);
  } else {
    _gEl.selectAll('circle.state-path')
      .style('fill', function() { return _stateColor(d3.select(this).attr('data-cod')); });
  }
}

function zoomToState(cod) {
  if (!_geoData) return;
  const feat = _geoData.features.find(f => String(f.properties.codarea) === cod);
  if (!feat) return;
  const { W, H } = _dims();
  const [[x0, y0], [x1, y1]] = _pathFn.bounds(feat);
  const dx = x1 - x0, dy = y1 - y0;
  const scale = Math.max(0.5, Math.min(12, 0.85 / Math.max(dx / W, dy / H)));
  const tx = W / 2 - scale * (x0 + x1) / 2;
  const ty = H / 2 - scale * (y0 + y1) / 2;
  _svgEl.transition().duration(650)
    .call(_zoomBeh.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function resetMapZoom() {
  if (_svgEl) _svgEl.transition().duration(500).call(_zoomBeh.transform, d3.zoomIdentity);
}
function zoomIn()  { if (_svgEl) _svgEl.transition().duration(300).call(_zoomBeh.scaleBy, 1.5); }
function zoomOut() { if (_svgEl) _svgEl.transition().duration(300).call(_zoomBeh.scaleBy, 0.67); }
