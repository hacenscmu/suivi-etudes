// Suivi des études HAC — serveur Google Apps Script, version SÉCURISÉE avec rôles (appli v19 et suivantes).
// Les données restent dans le même Google Sheet, feuille « Données » [collection | id | json] : aucune migration.
//
// Codes d'accès (gérés DANS L'APPLI : Paramètres → Membres et codes d'accès) :
//   - Code des membres : UN code de 8 caractères, stable, commun à tous les membres (tous les droits).
//   - Code salarié     : un code de 8 caractères par nom, créé automatiquement dès que le nom apparaît dans
//                        les JEH ou la formation ; le salarié voit uniquement ce qui le concerne, en lecture.
// Première fois seulement, depuis l'éditeur : exécuter codeMembres() pour afficher le code des membres.

const COLLECTIONS = ['etudes', 'factures', 'temps', 'formation', 'clients', 'config', 'appareils', 'signalements'];
const TAILLE_MAX = 100000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out_({ ok: 'Le script fonctionne.', version: 'securise-4' }); }

function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function egal_(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function props_() { return PropertiesService.getScriptProperties(); }
function jetons_() { try { return JSON.parse(props_().getProperty('TOKENS') || '{}') || {}; } catch (x) { return {}; } }
function enregistrerJetons_(t) { props_().setProperty('TOKENS', JSON.stringify(t)); }
function role_(e) { return e && (e.role || (e.admin === false ? 'salarie' : 'membre')); } // anciens codes = Membre
function ncl_(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

const NOM_MEMBRES = 'Membres';
function codeMembres_() { try { return JSON.parse(props_().getProperty('CODE_MEMBRES') || 'null'); } catch (x) { return null; } }
function creerCodeMembres_() { var c = aleatoire_(8); props_().setProperty('CODE_MEMBRES', JSON.stringify({ h: sha_(c), code: c, cree: new Date().toISOString() })); return c; }
function membre_(token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 200) return null;
  var h1 = sha_(token), h2 = sha_(token.trim().toUpperCase()), cm = codeMembres_();
  if (cm && (egal_(h2, String(cm.h)) || egal_(h1, String(cm.h)))) return NOM_MEMBRES;    // code commun des membres
  var t = jetons_(), trouve = null;
  Object.keys(t).forEach(function (m) { var e = t[m]; if (e && e.active === true && (egal_(h1, String(e.h)) || egal_(h2, String(e.h)))) trouve = m; });
  return trouve;
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'requete' }); }
  if (!b || typeof b !== 'object') return out_({ error: 'requete' });
  var qui = membre_(b.token);
  if (!qui) return out_({ error: 'auth' });
  var role = qui === NOM_MEMBRES ? 'membre' : role_(jetons_()[qui]);
  try {
    if (b.action === 'ping') return out_({ ok: 1, membre: qui, role: role, admin: role === 'membre' });
    if (b.action === 'loadAll') return out_(verrou_(function () { return role === 'membre' ? loadAll_() : vueSalarie_(qui); }));
    if (b.action === 'signaler') return out_(verrou_(function () { return signaler_(b, qui); })); // seule écriture permise à un salarié
    if (role !== 'membre') return out_({ error: 'lecture' });                      // un salarié ne modifie rien d'autre
    if (b.action === 'save' || b.action === 'delete') return out_(verrou_(function () { return ecrire_(b, qui); }));
    if (['membres', 'creerCode', 'reinitialiserCode', 'desactiver', 'reactiver'].indexOf(b.action) >= 0) return out_(verrou_(function () { return gererMembres_(b, qui); }));
    return out_({ error: 'action' });
  } catch (x) {
    console.log('Erreur serveur : ' + (x && x.message));
    return out_({ error: 'serveur' });
  }
}
function verrou_(f) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return f(); } finally { l.releaseLock(); } }

function sheet_() {
  var id = props_().getProperty('SSID');
  if (!id) throw new Error('SSID manquant');
  var sh = SpreadsheetApp.openById(id).getSheetByName('Données');
  if (!sh) throw new Error('Feuille Données absente');
  return sh;
}
function lignes_(sh) { var n = sh.getLastRow() - 1; return n > 0 ? sh.getRange(2, 1, n, 3).getValues() : []; }

// Lecture tolérante : une ligne abîmée est ignorée (et notée dans le journal) au lieu de tout bloquer.
function loadAll_() {
  var out = {};
  lignes_(sheet_()).forEach(function (r, i) {
    if (!r[0]) return;
    try {
      var o = JSON.parse(r[2]);
      if (!o || typeof o !== 'object') throw 0;
      delete o._op;
      (out[r[0]] = out[r[0]] || {})[r[1]] = o;
    } catch (x) { console.log('Ligne ' + (i + 2) + ' illisible (' + r[0] + ' / ' + r[1] + ') : ignorée'); }
  });
  return out;
}
// Vue Salarié : uniquement ses lignes de JEH, ses niveaux de formation, le n° et le résumé de ses études,
// et les réglages nécessaires au calcul de sa paie. Aucune facture, aucun client, aucun autre intervenant.
function vueSalarie_(qui) {
  var tout = loadAll_(), moi = ncl_(qui), out = { etudes: {}, temps: {}, formation: {}, config: {}, signalements: {} };
  Object.keys(tout.signalements || {}).forEach(function (id) { var g = tout.signalements[id]; if (ncl_(g.par) === moi) out.signalements[id] = g; });
  var nums = {};
  Object.keys(tout.temps || {}).forEach(function (id) { var t = tout.temps[id]; if (ncl_(t.prenom) === moi) { out.temps[id] = t; if (t.etude) nums[t.etude] = 1; } });
  Object.keys(tout.formation || {}).forEach(function (id) { var f = tout.formation[id]; if (ncl_(f.nom) === moi) {
    var niv = {}; Object.keys(f.niveaux || {}).forEach(function (n) { if (nums[n]) niv[n] = f.niveaux[n]; }); out.formation[id] = { nom: f.nom, niveaux: niv }; } });
  Object.keys(tout.etudes || {}).forEach(function (id) { var e = tout.etudes[id]; if (e.num && nums[e.num]) out.etudes[id] = { num: e.num, resume: e.resume || '', statut: e.statut || '', date: e.date || '', ord: e.ord }; });
  var c = (tout.config || {}).main || {};
  out.config.main = { tva: c.tva, smic: c.smic, cot: c.cot, patr: c.patr, chomage: c.chomage, mandats: c.mandats, statuts: c.statuts, factures: c.factures, cnje: c.cnje, alertesOn: false };
  return out;
}

function ecrire_(b, qui) {
  if (COLLECTIONS.indexOf(b.col) < 0) return { error: 'collection' };
  if (typeof b.id !== 'string' || !b.id || b.id.length > 100) return { error: 'id' };
  if (typeof b.op !== 'string' || b.op.length < 4 || b.op.length > 100) return { error: 'op' };
  if (typeof b.expected !== 'number' || b.expected < 0 || b.expected % 1 !== 0) return { error: 'expected' };
  var nouveau = null;
  if (b.action === 'save') {
    if (typeof b.json !== 'string' || b.json.length > TAILLE_MAX) return { error: 'taille' };
    try { nouveau = JSON.parse(b.json); } catch (x) { return { error: 'json' }; }
    if (!nouveau || typeof nouveau !== 'object' || Array.isArray(nouveau)) return { error: 'json' };
  }
  var sh = sheet_(), v = lignes_(sh), ligne = -1, actuel = null;
  for (var k = 0; k < v.length; k++) if (v[k][0] === b.col && v[k][1] === b.id) { ligne = k + 2; try { actuel = JSON.parse(v[k][2]); } catch (x) { actuel = null; } break; }
  var version = actuel && typeof actuel._v === 'number' ? actuel._v : 0;
  if (b.action === 'delete') {
    if (ligne < 0) return { ok: 1, version: 0 };
    if (b.expected !== version) return { error: 'conflit', version: version };
    sh.deleteRow(ligne);
    return { ok: 1, version: 0 };
  }
  if (actuel && actuel._op === b.op) return { ok: 1, version: version };
  if (b.expected !== version) return { error: 'conflit', version: version };
  delete nouveau._op;
  nouveau._v = version + 1; nouveau._par = qui; nouveau._le = new Date().toISOString(); nouveau._op = b.op;
  var s = JSON.stringify(nouveau);
  if (ligne > 0) sh.getRange(ligne, 3).setValue(s); else sh.appendRow([b.col, b.id, s]);
  return { ok: 1, version: nouveau._v };
}

// Signalement d'une ligne de JEH manquante : le nom est imposé par le serveur (celui du code utilisé).
function signaler_(b, qui) {
  var d = b.signalement;
  if (!d || typeof d !== 'object') return { error: 'json' };
  var txt = function (v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }, nb = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null; };
  var o = { par: qui, date: txt(d.date, 10), etude: txt(d.etude, 40), min: nb(d.min), nb: nb(d.nb) || 1, note: txt(d.note, 500), statut: 'nouveau', le: new Date().toISOString(), _v: 1 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date) || !o.min) return { error: 'incomplet' };
  var id = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  sheet_().appendRow(['signalements', id, JSON.stringify(o)]);
  return { ok: 1, id: id };
}

// ---------- Codes et rôles ----------
function aleatoire_(n) {
  var octets = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid(), Utilities.Charset.UTF_8), s = '';
  for (var i = 0; i < n; i++) s += ALPHABET[(octets[i] & 255) % ALPHABET.length];
  return s;
}
function nouveauCode_(m, role) {
  var t = jetons_(), avant = t[m] || {};
  var code = role === 'salarie' ? aleatoire_(8) : (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  t[m] = { h: sha_(code), active: true, role: role, cree: avant.cree || new Date().toISOString(), change: new Date().toISOString() };
  if (role === 'salarie') t[m].code = code; // code simple visible par les membres pour le transmettre
  enregistrerJetons_(t);
  return code;
}
// Ajoute automatiquement comme Salariés les noms présents dans les données sans code.
function synchroniserNoms_() {
  var tout = loadAll_(), t = jetons_(), connus = {}, ajout = 0;
  Object.keys(t).forEach(function (m) { connus[ncl_(m)] = 1; });
  var noms = [];
  Object.keys(tout.temps || {}).forEach(function (id) { noms.push(tout.temps[id].prenom); });
  Object.keys(tout.formation || {}).forEach(function (id) { noms.push(tout.formation[id].nom); });
  noms.forEach(function (n) { var k = ncl_(n); if (k && !connus[k]) { connus[k] = 1; nouveauCode_(String(n).trim(), 'salarie'); ajout++; } });
  return ajout;
}
function gererMembres_(b, qui) {
  if (b.action === 'membres') {
    var cm = codeMembres_(); if (!cm || !cm.code) { creerCodeMembres_(); cm = codeMembres_(); }
    synchroniserNoms_();
    var t = jetons_(), noms = Object.keys(t).sort(function (a, c) { return a.localeCompare(c); });
    var liste = function (r) { return noms.filter(function (m) { return role_(t[m]) === r; }).map(function (m) { var e = t[m];
      return { nom: m, actif: e.active === true, code: r === 'salarie' && e.active === true ? e.code || '' : '' }; }); };
    return { ok: 1, codeMembres: cm.code, salaries: liste('salarie'), anciens: liste('membre') };
  }
  var t = jetons_(), nom = typeof b.nom === 'string' ? b.nom.trim() : '';
  if (!nom || nom.length > 60 || nom === NOM_MEMBRES) return { error: 'nom' };
  if (b.action === 'creerCode') { if (t[nom] && t[nom].active) return { error: 'existe' }; return { ok: 1, nom: nom, code: nouveauCode_(nom, 'salarie') }; }
  if (!t[nom]) return { error: 'inconnu' };
  if (nom === qui) return { error: 'soimeme' };
  if (b.action === 'reinitialiserCode' || b.action === 'reactiver') { if (role_(t[nom]) !== 'salarie') return { error: 'ancien' }; return { ok: 1, nom: nom, code: nouveauCode_(nom, 'salarie') }; }
  if (b.action === 'desactiver') { t[nom].active = false; delete t[nom].code; t[nom].revoque = new Date().toISOString(); enregistrerJetons_(t); return { ok: 1 }; }
  return { error: 'action' };
}

// ---------- Depuis l'éditeur (première fois, ou secours) ----------
// Choisissez codeMembres puis Exécuter : le code commun des membres s'affiche dans le journal (créé s'il n'existe pas).
function codeMembres() { var cm = codeMembres_(); var c = cm && cm.code ? cm.code : creerCodeMembres_(); console.log('Code des membres : ' + c); return c; }
function listerCodes() { var t = jetons_(); Object.keys(t).forEach(function (m) { console.log(m + ' : ' + role_(t[m]) + (t[m].active ? '' : ' (désactivé)')); }); }
