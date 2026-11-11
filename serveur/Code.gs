// Suivi des études HAC — serveur Google Apps Script, version SÉCURISÉE (appli v17 et suivantes).
// Les données restent dans le même Google Sheet, feuille « Données » [collection | id | json] : aucune migration.
//
// Accès : chaque membre a un code d'accès personnel (jeton). Le serveur ne garde que son empreinte.
//   - creerJeton('Prénom.N')   → à lancer depuis l'éditeur Apps Script : affiche le code UNE seule fois
//   - revoquerJeton('Prénom.N') → désactive le code de ce membre
//   - listerJetons()           → liste les membres et l'état de leur code
// Versions : chaque fiche porte un numéro _v. Une modification faite sur une version dépassée est refusée
// (« conflit ») au lieu d'écraser le travail d'un autre membre.

const COLLECTIONS = ['etudes', 'factures', 'temps', 'formation', 'clients', 'config', 'appareils'];
const TAILLE_MAX = 100000;

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out_({ ok: 'Le script fonctionne.', version: 'securise-1' }); }

function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function egal_(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function jetons_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('TOKENS') || '{}') || {}; } catch (x) { return {}; } }
function membre_(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  var h = sha_(token), t = jetons_(), trouve = null;
  Object.keys(t).forEach(function (m) { if (t[m] && t[m].active === true && egal_(h, String(t[m].h))) trouve = m; });
  return trouve;
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'requete' }); }
  if (!b || typeof b !== 'object') return out_({ error: 'requete' });
  var qui = membre_(b.token);
  if (!qui) return out_({ error: 'auth' });
  try {
    if (b.action === 'ping') return out_({ ok: 1, membre: qui });
    if (b.action === 'loadAll') return out_(verrou_(loadAll_));
    if (b.action === 'save' || b.action === 'delete') return out_(verrou_(function () { return ecrire_(b, qui); }));
    return out_({ error: 'action' });
  } catch (x) {
    console.log('Erreur serveur : ' + (x && x.message));
    return out_({ error: 'serveur' });
  }
}
function verrou_(f) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return f(); } finally { l.releaseLock(); } }

function sheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SSID');
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
    if (ligne < 0) return { ok: 1, version: 0 };                                   // déjà supprimée : rejeu sans effet
    if (b.expected !== version) return { error: 'conflit', version: version };
    sh.deleteRow(ligne);
    return { ok: 1, version: 0 };
  }
  if (actuel && actuel._op === b.op) return { ok: 1, version: version };          // même opération rejouée : déjà faite
  if (b.expected !== version) return { error: 'conflit', version: version };
  delete nouveau._op;
  nouveau._v = version + 1; nouveau._par = qui; nouveau._le = new Date().toISOString(); nouveau._op = b.op;
  var s = JSON.stringify(nouveau);
  if (ligne > 0) sh.getRange(ligne, 3).setValue(s); else sh.appendRow([b.col, b.id, s]);
  return { ok: 1, version: nouveau._v };
}

// ---------- Administration (à lancer depuis l'éditeur Apps Script) ----------
function creerJeton(membre) {
  if (typeof membre !== 'string' || !membre.trim()) throw new Error('Indiquez le nom du membre, ex. creerJeton("Pauline.D")');
  var jeton = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var t = jetons_(); t[membre.trim()] = { h: sha_(jeton), active: true, cree: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty('TOKENS', JSON.stringify(t));
  console.log('Code d’accès de ' + membre + ' (à lui transmettre en privé, il ne sera plus affiché) : ' + jeton);
  return jeton;
}
function revoquerJeton(membre) {
  var t = jetons_(); if (!t[membre]) throw new Error('Membre inconnu : ' + membre);
  t[membre].active = false; t[membre].revoque = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty('TOKENS', JSON.stringify(t));
  console.log('Code de ' + membre + ' désactivé.');
}
function listerJetons() {
  var t = jetons_();
  Object.keys(t).forEach(function (m) { console.log(m + ' : ' + (t[m].active ? 'actif' : 'désactivé') + ' (créé le ' + String(t[m].cree).slice(0, 10) + ')'); });
}
// Raccourci pour l'éditeur : créer son propre code (remplacez le nom puis cliquez sur Exécuter)
function creerMonCode() { return creerJeton('Pauline.D'); }
