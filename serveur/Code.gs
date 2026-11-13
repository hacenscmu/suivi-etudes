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
function doGet() { return out_({ ok: 'Le script fonctionne.', version: 'securise-7' }); }

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
    if (b.action === 'ping') { if (typeof b.nom === 'string' && b.nom.trim() && ncl_(b.nom) !== ncl_(qui)) return out_({ error: 'auth' }); return out_({ ok: 1, membre: qui, role: role, admin: role === 'membre' }); }
    if (b.action === 'loadAll') return out_(verrou_(function () { return role === 'membre' ? loadAll_() : vueSalarie_(qui); }));
    if (b.action === 'changerMonCode') return out_(verrou_(function () { return changerMonCode_(b, qui); }));
    if (b.action === 'signaler') return out_(verrou_(function () { return signaler_(b, qui); })); // seule écriture permise à un salarié
    if (role !== 'membre') return out_({ error: 'lecture' });                      // un salarié ne modifie rien d'autre
    if (b.action === 'save' || b.action === 'delete') return out_(verrou_(function () { return ecrire_(b, qui); }));
    if (['membres', 'creerCode', 'reinitialiserCode', 'desactiver', 'reactiver', 'statut', 'renommer', 'supprimer'].indexOf(b.action) >= 0) return out_(verrou_(function () { return gererMembres_(b, qui); }));
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
  var code = aleatoire_(8);
  t[m] = { h: sha_(code), active: true, role: role, cree: avant.cree || new Date().toISOString(), change: new Date().toISOString(), code: code }; // code simple visible par les membres pour le transmettre
  enregistrerJetons_(t);
  return code;
}
// Ajoute automatiquement comme Salariés les noms présents dans les données sans code.
// Ajoute automatiquement comme Salariés les noms présents dans les données sans compte.
// L'appli d'un membre envoie la liste des noms qu'elle connaît (rapide) ; sinon on relit les données (lent).
// Une personne supprimée n'est jamais recréée automatiquement.
function synchroniserNoms_(liste) {
  var t = jetons_(), connus = {}, ajout = 0, noms = [];
  Object.keys(t).forEach(function (m) { connus[ncl_(m)] = 1; });
  if (Array.isArray(liste)) noms = liste.slice(0, 1000).filter(function (n) { return typeof n === 'string' && n.trim() && n.length <= 60; });
  else { var tout = loadAll_();
    Object.keys(tout.temps || {}).forEach(function (id) { noms.push(tout.temps[id].prenom); });
    Object.keys(tout.formation || {}).forEach(function (id) { noms.push(tout.formation[id].nom); }); }
  noms.forEach(function (n) { var k = ncl_(n); if (k && k !== ncl_(NOM_MEMBRES) && !connus[k]) { connus[k] = 1; nouveauCode_(String(n).trim(), 'salarie'); ajout++; } });
  return ajout;
}
// Statuts des personnes : « membre » (tous les droits), « salarie » (ses données seulement) ou « aucun » (plus d'accès).
// Chacun a son propre mot de passe (8 caractères au départ, puis choisi par la personne). On ne supprime personne : on change le statut.
// Le code commun des membres ne sert plus que de code de secours, lisible seulement dans l'éditeur (fonction codeMembres).
function statutDe_(e) { return !e || e.active !== true ? 'aucun' : role_(e); }
// Un salarié choisit lui-même son code : il n'est plus conservé en clair, les membres ne le voient plus et ne peuvent pas le changer.
function changerMonCode_(b, qui) {
  if (qui === NOM_MEMBRES) return { error: 'commun' };
  var n = typeof b.nouveau === 'string' ? b.nouveau.trim() : '';
  if (n.length < 8 || n.length > 64) return { error: 'longueur' };
  var t = jetons_(), h = sha_(n), cm = codeMembres_();
  if (cm && (egal_(h, String(cm.h)) || egal_(sha_(n.toUpperCase()), String(cm.h)))) return { error: 'pris' };
  var pris = Object.keys(t).some(function (m) { return m !== qui && t[m] && egal_(h, String(t[m].h)); });
  if (pris) return { error: 'pris' };
  var e = t[qui]; if (!e || e.active !== true) return { error: 'auth' };
  e.h = h; delete e.code; e.perso = true; e.change = new Date().toISOString(); enregistrerJetons_(t);
  return { ok: 1 };
}
function gererMembres_(b, qui) {
  if (b.action === 'membres') {
    var cm = codeMembres_(); if (!cm || !cm.code) { creerCodeMembres_(); cm = codeMembres_(); }
    synchroniserNoms_(b.noms);
    var t = jetons_(), noms = Object.keys(t).filter(function (m) { return !t[m].supprime; }).sort(function (a, c) { return a.localeCompare(c); });
    var personnes = noms.map(function (m) { var e = t[m], st = statutDe_(e); return { nom: m, statut: st, code: st !== 'aucun' ? e.code || '' : '', perso: !!e.perso && st !== 'aucun' }; });
    return { ok: 1, personnes: personnes };
  }
  var t = jetons_(), nom = typeof b.nom === 'string' ? b.nom.trim() : '';
  if (!nom || nom.length > 60 || nom === NOM_MEMBRES) return { error: 'nom' };
  if (b.action === 'creerCode') { if (t[nom] && t[nom].active && !t[nom].supprime) return { error: 'existe' }; return { ok: 1, nom: nom, code: nouveauCode_(nom, b.statut === 'membre' ? 'membre' : 'salarie') }; }
  if (!t[nom] || t[nom].supprime) return { error: 'inconnu' };
  if (nom === qui) return { error: 'soimeme' };
  if (b.action === 'supprimer') { t[nom] = { supprime: true, active: false, h: '', revoque: new Date().toISOString() }; enregistrerJetons_(t); return { ok: 1 }; }
  if (b.action === 'renommer') {
    var nv = typeof b.nouveau === 'string' ? b.nouveau.trim() : '';
    if (!nv || nv.length > 60 || ncl_(nv) === ncl_(NOM_MEMBRES)) return { error: 'nom' };
    var deja = Object.keys(t).filter(function (m) { return m !== nom && ncl_(m) === ncl_(nv) && !t[m].supprime; });
    if (deja.length) return { error: 'existe' };
    Object.keys(t).forEach(function (m) { if (m !== nom && ncl_(m) === ncl_(nv)) delete t[m]; }); // ancienne fiche supprimée du même nom
    t[nv] = t[nom]; t[nom] = { supprime: true, active: false, h: '', revoque: new Date().toISOString() }; enregistrerJetons_(t); return { ok: 1, nom: nv };
  }
  var statut = b.action === 'statut' ? b.statut : b.action === 'desactiver' ? 'aucun' : b.action === 'reactiver' ? 'salarie' : null;
  if (b.action === 'reinitialiserCode') return { error: 'interdit' }; // seul le salarié change son code (depuis ses Paramètres)
  if (['membre', 'salarie', 'aucun'].indexOf(statut) < 0) return { error: 'action' };
  if (statut === 'aucun') { t[nom].active = false; delete t[nom].code; t[nom].revoque = new Date().toISOString(); enregistrerJetons_(t); return { ok: 1 }; }
  if (t[nom].active === true && t[nom].code) { t[nom].role = statut; t[nom].change = new Date().toISOString(); enregistrerJetons_(t); return { ok: 1, nom: nom, code: t[nom].code }; }
  return { ok: 1, nom: nom, code: nouveauCode_(nom, statut), nouveau: 1 };
}

// ---------- Depuis l'éditeur (première fois, ou secours) ----------
// Choisissez codeMembres puis Exécuter : le code commun des membres s'affiche dans le journal (créé s'il n'existe pas).
function codeMembres() { var cm = codeMembres_(); var c = cm && cm.code ? cm.code : creerCodeMembres_(); console.log('Code des membres : ' + c); return c; }
function listerCodes() { var t = jetons_(); Object.keys(t).forEach(function (m) { console.log(m + ' : ' + role_(t[m]) + (t[m].active ? '' : ' (désactivé)')); }); }
