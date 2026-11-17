// CCTV | Coletor da CBF: jogos do dia, canais de transmissão, placar e escudos (site oficial)
// Pouquíssimas chamadas: hoje a cada rodada, amanhã e depois a cada 30 min, ontem só de madrugada.
const BASE = 'https://www.cbf.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BRT = 3 * 3600e3;
export const ymdBR = ms => new Date(ms - BRT).toISOString().slice(0, 10);
const EXTERNO = /youtube|caz[eé]\s?tv|globoplay|prime\s?video|\bmax\b|dazn|paramount|disney|star\+|apple\s?tv|twitch|x\.com|\bn\s?sports\b|nsports|goat|centauro/i;
const EXCLUI = /sub-?\s?\d|feminin|femin|futsal|beach|areia/i;
const INCLUI_PADRAO = '(s[eé]rie\\s*[abcd]\\b|copa do brasil|supercopa)';

const num = v => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return Number.isFinite(n) ? n : null; };
const str = v => (v == null ? '' : String(v)).trim();
const time = t => t && typeof t == 'object' ? { nome: str(t.nome || t.nome_popular || t.sigla), id: t.id != null ? t.id : t.id_equipe, escudo: str(t.url_escudo || t.escudo), gols: num(t.gols != null ? t.gols : t.placar) } : { nome: str(t), id: null, escudo: '', gols: null };

// data "dd/mm/aaaa" ou "aaaa-mm-dd" + hora "19:30" ou "19h30" (horário de Brasília) para ms UTC
export function quando(data, hora) {
  let a = str(data).match(/(\d{4})-(\d{2})-(\d{2})/), d, m, y;
  if (a) { y = +a[1]; m = +a[2]; d = +a[3]; } else { a = str(data).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (!a) return null; d = +a[1]; m = +a[2]; y = +a[3]; }
  const h = str(hora).match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/); const hh = h ? +h[1] : 0, mm = h && h[2] ? +h[2] : 0;
  return Date.UTC(y, m - 1, d, hh, mm) + BRT;
}

// Percorre o JSON sem depender do formato exato: acha todo objeto com id_jogo e guarda os nomes dos grupos acima dele.
export function extrairJogos(json, incluir) {
  const re = new RegExp(incluir || INCLUI_PADRAO, 'i'), saida = [], nomes = new Set();
  const grupoNome = o => str(o.nome || o.nome_campeonato || o.campeonato || o.competicao || o.nome_competicao || o.categoria || o.titulo);
  (function walk(n, ctx) {
    if (Array.isArray(n)) { for (const x of n) walk(x, ctx); return; }
    if (!n || typeof n != 'object') return;
    if (n.id_jogo != null) {
      const comp = ctx.join(' | '); if (ctx[0]) nomes.add(ctx[0]);
      if (EXCLUI.test(comp) || !re.test(comp)) return;
      const c = time(n.mandante), f = time(n.visitante), ini = quando(n.data || n.data_jogo, n.hora || n.horario);
      if (!c.nome || !f.nome || ini == null) return;
      const canais = []; const vistos = new Set();
      for (const t of Array.isArray(n.transmissoes) ? n.transmissoes : []) {
        for (const nome of str(t && t.nome != null ? t.nome : t).split(/\s*[\/,]\s*|\s+e\s+/)) {
          const k = nome.toLowerCase(); if (nome && !vistos.has(k)) { vistos.add(k); canais.push(EXTERNO.test(nome) ? { codigo: '', nome, externo: true } : { codigo: '', nome }); }
        }
      }
      const txt = JSON.stringify([n.status, n.situacao, n.jogo_status, n.fase_jogo]).toLowerCase();
      saida.push({ idCbf: String(n.id_jogo), rodada: num(n.rodada), casa: c.nome, fora: f.nome, escudos: { casa: c.escudo, fora: f.escudo }, ini, golsCasa: c.gols, golsFora: f.gols, local: str(n.local || n.estadio), canais, competicao: ctx[0] || '', encerrado: /encerrad|finaliz/.test(txt), adiado: /adiad|suspens|cancel/.test(txt) });
      return;
    }
    const nm = grupoNome(n), next = nm && !Array.isArray(n) && (Object.values(n).some(v => v && typeof v == 'object')) ? ctx.concat(nm) : ctx;
    for (const k in n) if (n[k] && typeof n[k] == 'object') walk(n[k], next);
  })(json, []);
  return { jogos: saida, competicoes: [...nomes] };
}

async function pegar(url, tent = 2) {
  let st = 0;
  for (let i = 0; i < tent; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': BASE + '/futebol-brasileiro/jogos' }, signal: AbortSignal.timeout(20000) });
      st = r.status;
      if (r.status == 429 && i + 1 < tent) { await sleep(6000); continue; }
      if (!r.ok) return { st, erro: 'HTTP ' + r.status };
      const txt = await r.text();
      try { return { st, json: JSON.parse(txt) }; } catch { return { st, erro: 'resposta não é JSON: ' + txt.slice(0, 80).replace(/\s+/g, ' ') }; }
    } catch (e) { return { st, erro: String(e.message || e) }; }
  }
  return { st, erro: 'HTTP ' + st };
}

// cache: { dias: { 'aaaa-mm-dd': { t, jogos } } }. Devolve { ok, jogos, competicoes, diag, cache }
export async function coletarCBF(now, cache, cfg = {}) {
  const dias = (cache && cache.dias) || {}, novo = {}, diag = [], hoje = ymdBR(now), horaBR = new Date(now - BRT).getUTCHours();
  const alvo = [[0, 0], [1, 30], [2, 30]]; if (horaBR < 4) alvo.unshift([-1, 20]);
  let chamadas = 0, ok = 0, comps = new Set();
  for (const [d, minutos] of alvo) {
    const dia = ymdBR(now + d * 86400e3), velho = dias[dia];
    if (velho && now - velho.t < minutos * 60e3) { novo[dia] = velho; ok++; diag.push({ dia, fonte: 'cache' }); continue; }
    if (chamadas++) await sleep(2500);
    const [a, m, dd] = dia.split('-'), r = await pegar(`${BASE}/api/cbf/calendario/jogos/${a}/${m}/${dd}`);
    if (r.json) { const x = extrairJogos(r.json, cfg.incluir); novo[dia] = { t: now, jogos: x.jogos, competicoes: x.competicoes }; ok++; diag.push({ dia, status: r.st, jogos: x.jogos.length }); }
    else { diag.push({ dia, status: r.st, erro: r.erro }); if (velho) novo[dia] = velho; }
  }
  const jogos = []; for (const d in novo) { for (const j of novo[d].jogos) jogos.push(j); for (const c of novo[d].competicoes || []) comps.add(c); }
  return { ok: ok > 0, jogos, competicoes: [...comps], diag, cache: { dias: novo } };
}

// teste isolado: node atualizar-esportes.mjs --teste-cbf
export async function testeCBF() {
  const url = `${BASE}/api/cbf/calendario/jogos/${ymdBR(Date.now()).replace(/-/g, '/')}`;
  console.log('GET', url);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': BASE + '/futebol-brasileiro/jogos' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log('status:', r.status, '| tipo:', r.headers.get('content-type'), '| servidor:', r.headers.get('server'), '| tamanho:', t.length);
    console.log('início da resposta:', t.slice(0, 500).replace(/\s+/g, ' '));
    try { const x = extrairJogos(JSON.parse(t)); console.log('JSON ok. jogos reconhecidos:', x.jogos.length, '| competições:', JSON.stringify(x.competicoes)); console.log('exemplo:', JSON.stringify(x.jogos[0] || null)); }
    catch (e) { console.log('não é JSON legível:', e.message); }
  } catch (e) { console.log('falhou:', e.message); }
}
