// CCTV | Esportes: junta o meuguia.tv (canal, horário, título) com a football-data.org (placar, escudos)
// e publica um JSON pronto para o app. Roda a cada poucos minutos pelo GitHub Actions.
import { coletarCBF, testeCBF } from './cbf.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = 'https://meuguia.tv';
const UA = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const CODIGOS = ['BSP', '135', 'ESP', 'ES2', 'ES3', 'ES4', 'ES5', 'OFF', '121', 'SPO', 'SP2', 'SP3'];
const COMPETICOES = ['WC', 'CL', 'BL1', 'DED', 'PD', 'FL1', 'ELC', 'PPL', 'EC', 'SA', 'PL'];
const pad = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- texto ---------- */
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['fc', 'cf', 'sc', 'ec', 'ac', 'afc', 'cd', 'ud', 'sv', 'fk', 'ssc', 'club', 'clube', 'de', 'do', 'da', 'esporte']);
export const tnorm = s => norm(s).split(' ').filter(w => w && !STOP.has(w)).join('');
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const strip = h => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/* ---------- meuguia.tv ---------- */
export function parseCategoria(html) {
  const out = [], re = /<a\b[^>]*href="[^"]*programacao\/canal\/([^"\/?#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) { const nome = strip(m[2]).split(/\d{1,2}:\d{2}/)[0].trim(); if (nome) out.push({ codigo: decodeURIComponent(m[1]), nome }); }
  return out;
}
export const toLines = html => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, '\n'))
  .split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
const DIA = /^(?:domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)(?:-feira)?,?\s*(\d{1,2})\/(\d{1,2})$/i;
const HORA = /^(\d{1,2}):(\d{2})$/;
export function nomeCanal(html, codigo) { const m = /<title>\s*Programa[cç][aã]o\s+([^<]+?)\s*<\/title>/i.exec(html); return m ? decode(m[1]).trim() : codigo; }
export function parseCanal(html, now = Date.now()) {
  const L = toLines(html), progs = [], ref = new Date(now - 3 * 3600e3), y0 = ref.getUTCFullYear(), m0 = ref.getUTCMonth() + 1; let dia = null, cur = null;
  for (const t of L) {
    let m;
    if ((m = DIA.exec(t))) { dia = { d: +m[1], mo: +m[2] }; cur = null; continue; }
    if (dia && (m = HORA.exec(t))) { const y = dia.mo < m0 - 6 ? y0 + 1 : dia.mo > m0 + 6 ? y0 - 1 : y0; cur = { ini: Date.UTC(y, dia.mo - 1, dia.d, +m[1] + 3, +m[2]), titulo: '', genero: '', noAr: false }; progs.push(cur); continue; }
    if (!cur) continue;
    if (/^publicidade:?$/i.test(t)) continue;
    if (/^no ar$/i.test(t)) { cur.noAr = true; continue; }
    if (!cur.titulo) { cur.titulo = t; continue; }
    if (!cur.genero && t.includes('/') && t.length < 60) cur.genero = t;
  }
  progs.sort((a, b) => a.ini - b.ini);
  progs.forEach((p, i) => { p.fim = progs[i + 1] ? progs[i + 1].ini : p.ini + 2 * 3600e3; });
  return progs.filter(p => p.titulo);
}
export function classificar(p) {
  const t = p.titulo, vt = /^(vt|reprise)\b\s*[-:–]?\s*/i.test(t) || /\breprise\b/i.test(t);
  const base = t.replace(/^(vt|reprise)\b\s*[-:–]?\s*/i, '').replace(/\s*-\s*ao vivo\s*$/i, '').trim(), aoVivoTag = /ao vivo/i.test(t), esporte = /^esporte/i.test(p.genero);
  const m = /^(?:[^:]{1,40}:\s*)?(.+?)\s+x\s+(.+)$/i.exec(base);
  const casa = m ? m[1].trim() : '', fora = m ? m[2].replace(/\s+-\s+.*$/, '').trim() : '';
  return { vt, aoVivoTag, esporte, jogo: esporte && !vt && (!!m || aoVivoTag), base, casa, fora, esporteNome: (p.genero.split('/')[1] || '').trim() };
}

/* ---------- football-data.org ---------- */
const DT = { alemanha: 'Germany', holanda: ['Netherlands', 'Holland'], franca: 'France', inglaterra: 'England', espanha: 'Spain', portugal: 'Portugal', italia: 'Italy', belgica: 'Belgium', croacia: 'Croatia', suica: 'Switzerland', escocia: 'Scotland', grecia: 'Greece', servia: 'Serbia', polonia: 'Poland', suecia: 'Sweden', dinamarca: 'Denmark', noruega: 'Norway', austria: 'Austria', turquia: ['Turkey', 'Türkiye'], ucrania: 'Ukraine', 'republica tcheca': ['Czechia', 'Czech Republic'], tchequia: 'Czechia', hungria: 'Hungary', romenia: 'Romania', eslovaquia: 'Slovakia', eslovenia: 'Slovenia', albania: 'Albania', georgia: 'Georgia', irlanda: ['Ireland', 'Republic of Ireland'], gales: 'Wales', finlandia: 'Finland', islandia: 'Iceland', brasil: 'Brazil', argentina: 'Argentina', uruguai: 'Uruguay', colombia: 'Colombia', chile: 'Chile', paraguai: 'Paraguay', peru: 'Peru', equador: 'Ecuador', bolivia: 'Bolivia', venezuela: 'Venezuela', mexico: 'Mexico', 'estados unidos': ['United States', 'USA'], canada: 'Canada', japao: 'Japan', 'coreia do sul': ['South Korea', 'Korea Republic'], australia: 'Australia', marrocos: 'Morocco', senegal: 'Senegal', egito: 'Egypt', nigeria: 'Nigeria', gana: 'Ghana', camaroes: 'Cameroon', tunisia: 'Tunisia', argelia: 'Algeria', 'costa do marfim': ['Ivory Coast', "Côte d'Ivoire"], ira: 'Iran', 'arabia saudita': 'Saudi Arabia', catar: 'Qatar',
  flamengo: 'CR Flamengo', palmeiras: 'SE Palmeiras', corinthians: 'SC Corinthians Paulista', 'sao paulo': 'São Paulo FC', santos: 'Santos FC', fluminense: 'Fluminense FC', vasco: 'CR Vasco da Gama', botafogo: 'Botafogo FR', gremio: 'Grêmio FBPA', internacional: 'SC Internacional', cruzeiro: 'Cruzeiro EC', 'atletico mg': ['CA Mineiro', 'Atlético Mineiro'], 'atletico go': 'Atlético Goianiense', 'athletico pr': ['CA Paranaense', 'Athletico Paranaense'], 'atletico pr': 'CA Paranaense', bahia: 'EC Bahia', vitoria: 'EC Vitória', fortaleza: 'Fortaleza EC', ceara: 'Ceará SC', sport: 'Sport Club do Recife', bragantino: 'RB Bragantino', juventude: 'EC Juventude', mirassol: 'Mirassol FC', coritiba: 'Coritiba FBC', remo: 'Clube do Remo', chapecoense: 'Chapecoense AF',
  'real madrid': 'Real Madrid CF', barcelona: 'FC Barcelona', 'atletico de madrid': 'Club Atlético de Madrid', bayern: ['FC Bayern München', 'Bayern Munich'], 'bayern de munique': 'FC Bayern München', dortmund: 'Borussia Dortmund', 'borussia dortmund': 'Borussia Dortmund', liverpool: 'Liverpool FC', 'manchester city': 'Manchester City FC', 'manchester united': 'Manchester United FC', arsenal: 'Arsenal FC', chelsea: 'Chelsea FC', tottenham: 'Tottenham Hotspur FC', psg: 'Paris Saint-Germain FC', 'paris saint germain': 'Paris Saint-Germain FC', juventus: 'Juventus FC', milan: 'AC Milan', inter: 'FC Internazionale Milano', 'inter de milao': 'FC Internazionale Milano', napoli: 'SSC Napoli', roma: 'AS Roma', lazio: 'SS Lazio', benfica: 'SL Benfica', porto: 'FC Porto', sporting: 'Sporting Clube de Portugal', ajax: 'AFC Ajax', psv: 'PSV' };
const aliasPt = (pt, tab = {}) => {
  const a = new Set([tnorm(pt)]), k = Object.keys(tab).find(x => norm(x) == norm(pt));
  for (const x of [].concat(k ? tab[k] : [], DT[norm(pt)] || [])) a.add(tnorm(x));
  return [...a].filter(Boolean);
};
const aliasApi = t => [t && t.name, t && t.shortName, t && t.tla].map(tnorm).filter(Boolean);
const igual = (A, B) => A.some(a => B.some(b => a == b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)))));
const STATUS = { IN_PLAY: 'AO_VIVO', PAUSED: 'INTERVALO', FINISHED: 'ENCERRADO', AWARDED: 'ENCERRADO', SCHEDULED: 'AGENDADO', TIMED: 'AGENDADO', POSTPONED: 'ADIADO', SUSPENDED: 'ADIADO', CANCELLED: 'ADIADO' };
export function juntar(jogos, matches, tabTimes = {}) {
  let n = 0;
  for (const j of jogos) {
    if (!j.casa || !j.fora) continue;
    const A = aliasPt(j.casa, tabTimes), B = aliasPt(j.fora, tabTimes);
    for (const x of matches) {
      if (Math.abs(Date.parse(x.utcDate) - j.iniMs) > 4 * 3600e3) continue;
      const H = aliasApi(x.homeTeam), V = aliasApi(x.awayTeam), direto = igual(A, H) && igual(B, V), invertido = !direto && igual(A, V) && igual(B, H);
      if (!direto && !invertido) continue;
      const ft = (x.score && (x.score.fullTime && x.score.fullTime.home != null ? x.score.fullTime : x.score.halfTime)) || {}, h = ft.home ?? null, v = ft.away ?? null;
      j.placar = { casa: invertido ? v : h, fora: invertido ? h : v, status: STATUS[x.status] || x.status, minuto: x.minute ?? null };
      j.escudos = { casa: (invertido ? x.awayTeam : x.homeTeam).crest || '', fora: (invertido ? x.homeTeam : x.awayTeam).crest || '' };
      if (x.competition) j.competicao = { nome: x.competition.name, emblema: x.competition.emblem || '', codigo: x.competition.code };
      n++; break;
    }
  }
  return n;
}

/* ---------- montagem do JSON ---------- */
const isoBR = ms => { const d = new Date(ms - 3 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00-03:00`; };
export function montar(grades, now) {
  const r = new Date(now - 3 * 3600e3), de = Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate(), 3), ate = de + 2 * 86400e3, mapa = new Map();
  for (const [codigo, g] of Object.entries(grades)) for (const p of g.programas || []) {
    if (p.fim <= de || p.ini >= ate) continue;
    const c = classificar(p), chave = p.ini + '|' + norm(c.base);
    let j = mapa.get(chave);
    if (!j) mapa.set(chave, j = { id: Math.abs([...chave].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36), iniMs: p.ini, inicio: isoBR(p.ini), fim: isoBR(p.fim), titulo: c.base, tipo: c.jogo ? 'jogo' : 'programa', vt: c.vt, aoVivoTag: c.aoVivoTag, genero: p.genero, esporte: c.esporteNome, casa: c.casa, fora: c.fora, canais: [] });
    if (!j.canais.some(x => x.codigo == codigo)) j.canais.push({ codigo, nome: g.nome || codigo });
    j.fim = isoBR(Math.max(Date.parse(j.fim), p.fim));
  }
  return [...mapa.values()].sort((a, b) => a.iniMs - b.iniMs);
}

/* ---------- execução ---------- */
async function getText(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
    catch (e) { err = e; await sleep(800 * (i + 1)); }
  }
  throw err;
}

// Junta os jogos da CBF com os do guia: a CBF manda (canal, placar, escudo); o guia entra como reserva de canal.
export function mesclarCBF(jogos, cbf, now, tabTimes = {}) {
  const usados = new Set(); let n = 0, novos = 0;
  const ch = (a, b) => { const k = new Set(a.map(c => norm(c.nome))); return a.concat(b.filter(c => !k.has(norm(c.nome)))); };
  for (const c of cbf) {
    const A = aliasPt(c.casa, tabTimes), B = aliasPt(c.fora, tabTimes);
    const g = jogos.find(j => !usados.has(j) && j.tipo == 'jogo' && !j.vt && j.casa && Math.abs(j.iniMs - c.ini) <= 3 * 3600e3 && igual(A, aliasPt(j.casa, tabTimes)) && igual(B, aliasPt(j.fora, tabTimes)));
    if (g) usados.add(g), n++; else novos++;
    const fim = g ? Date.parse(g.fim) : c.ini + 2 * 3600e3;
    const dec = now - c.ini, temGols = c.golsCasa != null && c.golsFora != null && dec >= 0;
    const status = c.adiado ? 'ADIADO' : c.encerrado || (temGols && dec > 135 * 60e3) ? 'ENCERRADO' : temGols ? 'AO_VIVO' : null;
    const j = { id: 'cbf' + c.idCbf, inicio: new Date(c.ini).toISOString(), fim: new Date(Math.max(fim, c.ini + 3600e3)).toISOString(), titulo: c.casa + ' x ' + c.fora, tipo: 'jogo', vt: false, aoVivoTag: g ? g.aoVivoTag : dec >= 0 && dec < 135 * 60e3, genero: 'Esporte/Futebol', esporte: 'Futebol', casa: c.casa, fora: c.fora, canais: ch(c.canais, g ? g.canais : []), escudos: c.escudos, competicao: { nome: c.competicao, codigo: 'CBF' }, rodada: c.rodada, local: c.local, fonte: 'cbf', iniMs: c.ini };
    if (status && status != 'ADIADO' && temGols) j.placar = { casa: c.golsCasa, fora: c.golsFora, status, minuto: null };
    else if (status == 'ADIADO') j.placar = { casa: null, fora: null, status, minuto: null };
    if (g) jogos.splice(jogos.indexOf(g), 1, j); else jogos.push(j);
  }
  return { casados: n, novos };
}

const lerJson = (p, pad2) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : pad2; } catch { return pad2; } };
const ymd = ms => new Date(ms).toISOString().slice(0, 10);

export async function main() {
  const now = Date.now(), CFG = lerJson('config.json', {}), E = CFG.esportes || {}, prev = lerJson('dados/esportes.json', null), grades = lerJson('dados/grades.json', {});
  const novas = {}; let ok = 0, falhas = 0;
  const codigos = new Map(CODIGOS.map(c => [c, null]));
  try { for (const c of parseCategoria(await getText(BASE + '/programacao/categoria/Esportes'))) codigos.set(c.codigo, c.nome); } catch (e) { console.error('categoria:', e.message); }
  for (const c of E.extras || []) if (!codigos.has(String(c))) codigos.set(String(c), null);
  for (const [codigo, nome] of codigos) {
    const velho = grades[codigo];
    if (velho && now - velho.t < 25 * 60e3 && (velho.programas || []).length) { novas[codigo] = velho; ok++; continue; }
    try {
      const html = await getText(`${BASE}/programacao/canal/${encodeURIComponent(codigo)}`), programas = parseCanal(html, now);
      if (!programas.length) throw new Error('sem programas');
      novas[codigo] = { t: now, nome: nome || nomeCanal(html, codigo), programas: programas.filter(p => p.fim > now - 12 * 3600e3 && p.ini < now + 4 * 86400e3) }; ok++;
    } catch (e) { falhas++; console.error('canal', codigo, e.message); if (velho) novas[codigo] = velho; }
    await sleep(400);
  }
  let jogos, meuguiaEm = new Date(now).toISOString();
  if (!ok && prev) { jogos = prev.jogos.map(j => ({ ...j, iniMs: Date.parse(j.inicio) })); meuguiaEm = prev.meuguia_em || prev.atualizado; }
  else jogos = montar(novas, now);
  let apiOk = false, apiEm = prev && prev.api_em || null;
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (token) {
      const url = `https://api.football-data.org/v4/matches?dateFrom=${ymd(now - 36 * 3600e3)}&dateTo=${ymd(now + 3 * 86400e3)}&competitions=${(E.competicoes || COMPETICOES).join(',')}`;
      const r = await fetch(url, { headers: { 'X-Auth-Token': token }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const n = juntar(jogos, (await r.json()).matches || [], E.times || {}); apiOk = true; apiEm = new Date(now).toISOString(); console.log('placares ligados:', n);
    } else console.error('sem FOOTBALL_DATA_TOKEN');
  } catch (e) { console.error('api:', e.message); if (prev) for (const j of jogos) { const o = prev.jogos.find(x => x.id == j.id); if (o && !j.placar) { j.placar = o.placar; j.escudos = o.escudos; j.competicao = o.competicao; } } }
  let cbfOk = false, cbfDiag = [], cbfComps = [];
  try {
    const cc = lerJson('dados/cbf.json', {}), r = await coletarCBF(now, cc, E.cbf || {});
    cbfDiag = r.diag; cbfComps = r.competicoes; cbfOk = r.ok; console.log('cbf:', JSON.stringify(r.diag));
    if (r.ok) { const m = mesclarCBF(jogos, r.jogos, now, E.times || {}); console.log('cbf jogos:', r.jogos.length, JSON.stringify(m)); }
    mkdirSync('out', { recursive: true }); writeFileSync('out/cbf.json', JSON.stringify(r.cache));
  } catch (e) { console.error('cbf:', e.message); try { writeFileSync('out/cbf.json', JSON.stringify(lerJson('dados/cbf.json', {}))); } catch {} }
  jogos.sort((a, b) => a.iniMs - b.iniMs);
  const saida = { v: 1, atualizado: new Date(now).toISOString(), meuguia_ok: ok > 0, meuguia_em: meuguiaEm, api_ok: apiOk, api_em: apiEm, cbf_ok: cbfOk, cbf_diag: cbfDiag, cbf_competicoes: cbfComps, canais_guia: [...codigos].map(([c, n]) => ({ codigo: c, nome: (novas[c] && novas[c].nome) || n || c })), jogos: jogos.map(({ iniMs, ...j }) => j) };
  mkdirSync('out', { recursive: true });
  writeFileSync('out/esportes.json', JSON.stringify(saida)); writeFileSync('out/grades.json', JSON.stringify(novas));
  console.log(`ok: ${ok} canais, ${falhas} falhas, ${saida.jogos.length} itens`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) (process.argv.includes('--teste-cbf') ? testeCBF() : main()).catch(e => { console.error(e); process.exit(1); });
