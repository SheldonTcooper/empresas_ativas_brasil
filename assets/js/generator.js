/* ═══════════════════════════════════════════════
   generator.js — Demo company data generator
   Generates realistic Brazilian company records for display.
   ═══════════════════════════════════════════════ */

const _NMS = ['Carlos','Ana','Pedro','Maria','João','Sandra','Roberto','Lucia',
  'Fernando','Patricia','Marcos','Claudia','Ricardo','Renata','Eduardo','Cristina',
  'Marcelo','Fernanda','Sérgio','Juliana','Paulo','Carla','André','Beatriz',
  'Rodrigo','Débora','Lucas','Camila','Felipe','Larissa'];

const _SBS = ['Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Alves',
  'Pereira','Lima','Carvalho','Gomes','Costa','Martins','Barbosa','Ribeiro',
  'Rocha','Teixeira','Dias','Nascimento','Monteiro','Azevedo','Cavalcante',
  'Correia','Mendes','Castro','Freitas','Cunha','Araújo','Pinto','Cardoso'];

const _LGRS  = ['Rua','Avenida','Alameda','Travessa','Estrada'];
const _RUAS  = ['das Flores','dos Bandeirantes','Principal','das Palmeiras','da Paz',
  'do Comércio','Industrial','das Acácias','Central','Pres. Vargas','Getúlio Vargas',
  'das Nações','do Progresso','da Liberdade','São José','Santa Maria',
  'XV de Novembro','Sete de Setembro','Tiradentes','Brasil'];
const _BAIRROS = ['Centro','Jardim América','Vila Nova','Bela Vista','São Lucas',
  'Santa Cruz','Jardim das Flores','Vila Esperança','Bairro Alto','São João',
  'Vila Real','Jardim Paulista','Industrial','Centro Comercial','Novo Mundo',
  'Vila Verde','Parque das Nações','Santa Efigênia','Jardim Europa','Boa Vista'];
const _SUFX  = ['Ltda','S.A.','EIRELI','ME','EPP','SS','Unipessoal Ltda'];
const _PPTS  = ['MEI','ME','EPP','MEDIA','GRANDE'];
const _PPWS  = [0.35, 0.30, 0.20, 0.10, 0.05];

const _CEP_F = {
  SP:[1000,19999],RJ:[20000,28999],MG:[30000,39999],ES:[29000,29999],
  BA:[40000,48999],SE:[49000,49999],PE:[50000,56999],AL:[57000,57999],
  PB:[58000,58999],RN:[59000,59999],CE:[60000,63999],PI:[64000,64999],
  MA:[65000,65999],PA:[66000,68999],AP:[68900,68999],AM:[69000,69299],
  RR:[69300,69399],AC:[69900,69999],RO:[76800,76999],TO:[77000,77999],
  GO:[72800,76799],DF:[70000,72799],MS:[79000,79999],MT:[78000,78999],
  PR:[80000,87999],SC:[88000,89999],RS:[90000,99999],
};

const _ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const _rc = (arr) => arr[_ri(0, arr.length - 1)];
const _rw = () => {
  let r = Math.random(), acc = 0;
  for (let i = 0; i < _PPWS.length; i++) {
    acc += _PPWS[i];
    if (r < acc) return _PPTS[i];
  }
  return _PPTS[4];
};

function _fCNPJ(filial) {
  const base = String(_ri(1e7, 9.9e7)).padStart(8, '0');
  const ord  = filial ? String(_ri(2, 99)).padStart(4, '0') : '0001';
  const d1   = _ri(0, 9), d2 = _ri(0, 9);
  const s    = base + ord + d1 + d2;
  return `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}`;
}

function _fTel(cel) {
  const ddd = _ri(11, 99);
  return cel
    ? `(${ddd}) 9${_ri(1e3, 9999)}-${_ri(1e3, 9999)}`
    : `(${ddd}) ${_ri(2e3, 5999)}-${_ri(1e3, 9999)}`;
}

function _fCEP(uf) {
  const [lo, hi] = _CEP_F[uf] || [10000, 99999];
  const n = String(_ri(lo * 1e3, hi * 1e3 + 999)).padStart(8, '0');
  return `${n.slice(0, 5)}-${n.slice(5, 8)}`;
}

function genEmpresas(uf, mun, cnae) {
  const qty = _ri(15, 26);
  const munPre = mun.split(' ')[0];
  const result = [];

  for (let i = 0; i < qty; i++) {
    const filial = Math.random() < 0.22;
    const porte  = _rw();
    const n1 = _rc(_NMS), s1 = _rc(_SBS), s2 = _rc(_SBS);
    const suf = porte === 'MEI' ? 'ME' : _rc(_SUFX);

    let razao;
    if (porte === 'MEI') {
      razao = `${n1} ${s1} ${s2}`;
    } else {
      const variants = [
        `${s1} & ${s2}`,
        `${n1} ${s1}`,
        `${munPre} ${_rc(['Serviços','Comércio','Soluções','Tecnologia','Empreendimentos','Negócios'])}`,
        `Grupo ${s1}`,
        `${s1} ${_rc(['Express','Prime','Pro','Plus','Tech','Store','Center','Net','Hub','Digital'])}`,
      ];
      razao = `${_rc(variants)} ${suf}`;
    }
    razao = razao.toUpperCase();

    const temFt  = Math.random() > 0.42;
    const fantasia = temFt
      ? `${_rc([s1, s2, munPre])} ${_rc(['Shop','Express','Plus','Pro','Tech','Store','Center','Prime','Net'])}`
      : null;

    const logr  = `${_rc(_LGRS)} ${_rc(_RUAS)}`;
    const num   = String(_ri(1, 9999));
    const compl = Math.random() > 0.6
      ? _rc(['Sala 1','Bloco A','Loja 2','Galpão 3','Ap 1','Cobertura','Fundos'])
      : '';
    const bairro = _rc(_BAIRROS);
    const cep    = _fCEP(uf);
    const tel1   = _fTel(porte === 'MEI');
    const tel2   = Math.random() > 0.5 ? _fTel(true) : '';
    const slug   = (fantasia || razao).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
    const email  = Math.random() > 0.28 ? `contato@${slug}.com.br` : '';
    const site   = (porte === 'MEDIA' || porte === 'GRANDE' || Math.random() > 0.68)
      ? `https://www.${slug}.com.br`
      : '';

    const endStr = `${logr}, ${num}${compl ? ', ' + compl : ''}, ${bairro}, ${mun} - ${uf}, ${cep}`;
    const endq   = encodeURIComponent(endStr);
    const nq     = encodeURIComponent(fantasia || razao);
    const abertura = `${String(_ri(1, 28)).padStart(2,'0')}/${String(_ri(1,12)).padStart(2,'0')}/${_ri(1990, 2024)}`;
    const telN   = tel1.replace(/\D/g, '');

    result.push({
      cnpj: _fCNPJ(filial),
      razao, fantasia,
      tipo: filial ? 'FILIAL' : 'MATRIZ',
      abertura, porte, logr, num, compl, bairro, cep, tel1, tel2, email, site,
      maps:     `https://www.google.com/maps/search/?api=1&query=${endq}`,
      linkedin: `https://www.linkedin.com/search/results/companies/?keywords=${nq}`,
      instagram:`https://www.instagram.com/explore/search/keyword/?q=${nq}`,
      facebook: `https://www.facebook.com/search/pages/?q=${nq}`,
      wpp:      Math.random() > 0.38 ? `https://wa.me/55${telN}` : '',
    });
  }
  return result;
}
