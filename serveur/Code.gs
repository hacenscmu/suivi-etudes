// Suivi des études HAC — serveur Google Apps Script, version SÉCURISÉE avec rôles (appli v19 et suivantes).
// Les données restent dans le même Google Sheet, feuille « Données » [collection | id | json] : aucune migration.
//
// Rôles (gérés DANS L'APPLI : Paramètres → Membres et codes d'accès) :
//   - Membre  : toutes les données, tous les droits, gestion des codes. Code long, jamais réaffiché.
//   - Salarié : voit uniquement ce qui le concerne (ses lignes de JEH, sa paie, sa formation), en lecture.
//               Code simple de 8 caractères, visible par les membres pour le lui transmettre.
// Tout nom présent dans les données (JEH, formation) sans rôle Membre devient automatiquement Salarié.
// Une seule action dans l'éditeur, la première fois : exécuter creerMonCode() pour obtenir le premier code Membre.

const COLLECTIONS = ['etudes', 'factures', 'temps', 'formation', 'clients', 'config', 'appareils'];
const TAILLE_MAX = 100000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out_({ ok: 'Le script fonctionne.', version: 'securise-3' }); }

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

function membre_(token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 200) return null;
  var h1 = sha_(token), h2 = sha_(token.trim().toUpperCase()), t = jetons_(), trouve = null;
  Object.keys(t).forEach(function (m) { var e = t[m]; if (e && e.active === true && (egal_(h1, String(e.h)) || egal_(h2, String(e.h)))) trouve = m; });
  return trouve;
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'requete' }); }
  if (!b || typeof b !== 'object') return out_({ error: 'requete' });
  var qui = membre_(b.token);
  if (!qui) return out_({ error: 'auth' });
  var role = role_(jetons_()[qui]);
  try {
    if (b.action === 'ping') return out_({ ok: 1, membre: qui, role: role, admin: role === 'membre' });
    if (b.action === 'loadAll') return out_(verrou_(function () { return role === 'membre' ? loadAll_() : vueSalarie_(qui); }));
    if (b.action === 'changerMonCode') return out_(verrou_(function () { return { ok: 1, membre: qui, code: nouveauCode_(qui, role) }; }));
    if (role !== 'membre') return out_({ error: 'lecture' });                      // un salarié ne modifie rien
    if (b.action === 'save' || b.action === 'delete') return out_(verrou_(function () { return ecrire_(b, qui); }));
    if (['membres', 'creerCode', 'reinitialiserCode', 'desactiver', 'reactiver', 'changerRole'].indexOf(b.action) >= 0) return out_(verrou_(function () { return gererMembres_(b, qui); }));
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
  var tout = loadAll_(), moi = ncl_(qui), out = { etudes: {}, temps: {}, formation: {}, config: {} };
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
    synchroniserNoms_();
    var t = jetons_();
    return { ok: 1, membres: Object.keys(t).sort(function (a, c) { return a.localeCompare(c); }).map(function (m) { var e = t[m], r = role_(e);
      return { nom: m, actif: e.active === true, role: r, code: r === 'salarie' && e.active === true ? e.code || '' : '', change: e.change || e.cree || '' }; }) };
  }
  var t = jetons_(), nom = typeof b.nom === 'string' ? b.nom.trim() : '';
  if (!nom || nom.length > 60) return { error: 'nom' };
  var role = b.role === 'salarie' ? 'salarie' : 'membre';
  if (b.action === 'creerCode') { if (t[nom] && t[nom].active) return { error: 'existe' }; return { ok: 1, nom: nom, role: role, code: nouveauCode_(nom, role) }; }
  if (!t[nom]) return { error: 'inconnu' };
  if (b.action === 'reinitialiserCode') { var r = role_(t[nom]); return { ok: 1, nom: nom, role: r, code: nouveauCode_(nom, r) }; }
  if (nom === qui) return { error: 'soimeme' };
  if (b.action === 'changerRole') return { ok: 1, nom: nom, role: role, code: nouveauCode_(nom, role) }; // nouveau code adapté au rôle
  if (b.action === 'desactiver') { t[nom].active = false; delete t[nom].code; t[nom].revoque = new Date().toISOString(); enregistrerJetons_(t); return { ok: 1 }; }
  if (b.action === 'reactiver') { var r2 = role_(t[nom]); return { ok: 1, nom: nom, role: r2, code: nouveauCode_(nom, r2) }; }
  return { error: 'action' };
}

// ---------- Depuis l'éditeur (première fois, ou secours) ----------
// Remplacez le nom si besoin, choisissez creerMonCode puis Exécuter : le code s'affiche dans le journal.
function creerMonCode() { var c = nouveauCode_('Pauline.D', 'membre'); console.log('Votre code Membre (ne sera plus affiché) : ' + c); return c; }
function listerCodes() { var t = jetons_(); Object.keys(t).forEach(function (m) { console.log(m + ' : ' + role_(t[m]) + (t[m].active ? '' : ' (désactivé)')); }); }
