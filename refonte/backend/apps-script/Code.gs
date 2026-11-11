// HAC — serveur Google Apps Script, API v3 (contrat : refonte/backend/contrat-api-v3.md).
// CANDIDAT : à déployer d'abord sur une COPIE du tableur, jamais directement en production.
//
// Feuilles du tableur (propriété de script SSID) :
//   « Données »     [collection | id | json]
//   « Journal »     [opId | empreinte | réponse | date | état | collection | id | membre]   état ∈ pending, committed
//   « Quarantaine » [date | ligne d'origine | collection | id | json brut]
// Propriétés de script :
//   SSID      identifiant du tableur
//   TOKENS    {"membre": {"h": "<sha256 du jeton>", "active": true}}  — jamais le jeton lui-même
//   REVISION  compteur de révisions (informatif)

var API = 3;
var COLLECTIONS_ECRITURE = ['etudes','clients','membres','factures','interventions','bvs','lignesBV','formation','config','appareils'];
var COLLECTIONS_LECTURE = COLLECTIONS_ECRITURE.concat(['temps']);
var ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
var OP_ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
var MAX_REQUETE = 300000, MAX_FICHE = 100000;
var CHAMPS_SERVEUR = ['_v','_par','_le','_deleted','_opId'];

// ---------- Enveloppe ----------
function reponse_(ok, data, error, meta) {
  var b = {ok: ok, apiVersion: API};
  if (ok) b.data = data;
  b.meta = meta || null; b.error = error || null;
  return b;
}
function erreur_(code, message, details) {
  var e = {code: code, message: message}; if (details) e.details = details;
  return reponse_(false, null, e, {revision: revision_()});
}
function sortie_(b) { return ContentService.createTextOutput(JSON.stringify(b)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return sortie_(reponse_(true, {apiVersion: API}, null, null)); }
function doPost(e) { return sortie_(traiter_(e && e.postData && e.postData.contents)); }

// ---------- Utilitaires ----------
function props_() { return PropertiesService.getScriptProperties(); }
function octets_(s) { return Utilities.newBlob(s).getBytes().length; }
function sha_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function egal_(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function simple_(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function cloner_(v) { return JSON.parse(JSON.stringify(v)); }
function stable_(v) {
  if (Array.isArray(v)) return '[' + v.map(stable_).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable_(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}
function ConfigErr(m) { this.config = m; }
function verrou_(f) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return f(); } finally { l.releaseLock(); } }
function feuille_(nom) {
  var id = props_().getProperty('SSID'); if (!id) throw new ConfigErr('SSID manquant'); // jamais de tableur créé en silence
  var sh = SpreadsheetApp.openById(id).getSheetByName(nom); if (!sh) throw new ConfigErr('feuille ' + nom + ' absente');
  return sh;
}
function lignes_(sh) { var n = sh.getLastRow() - 1; return n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : []; }
function revision_() { var r = +props_().getProperty('REVISION'); return isFinite(r) ? r : 0; }

// ---------- Authentification ----------
// Le jeton est comparé à des empreintes : le serveur ne connaît jamais les jetons.
function jetons_() {
  var raw = props_().getProperty('TOKENS'), t;
  try { t = raw ? JSON.parse(raw) : {}; } catch (x) { throw new ConfigErr('TOKENS illisible'); }
  if (!simple_(t)) throw new ConfigErr('TOKENS invalide');
  return t;
}
function membre_(token) {
  var t = jetons_(), h = sha_(token), trouve = null;
  Object.keys(t).forEach(function (m) { var e = t[m]; if (simple_(e) && e.active === true && egal_(h, String(e.h))) trouve = m; });
  return trouve;
}
function roleAcces_(id) {
  var e = jetons_()[id];
  return e && (e.role === 'Membre' || e.role === 'Salarie') ? e.role : null;
}
function nomMembre_(m) { return m.nomComplet || [m.prenom, m.nom].filter(Boolean).join(' ') || m.nom || m.id; }
function codeAleatoire_(n) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', brut = '';
  while (brut.length < n) brut += Utilities.getUuid().replace(/-/g, '').toUpperCase();
  var code = '';
  for (var i = 0; i < n; i++) code += alphabet.charAt(parseInt(brut.charAt(i * 2) + brut.charAt(i * 2 + 1), 16) % alphabet.length);
  return code;
}
function nouveauCode_(id, role, existant) {
  var t = jetons_(), code = codeAleatoire_(role === 'Salarie' ? 8 : 32);
  t[id] = {h: sha_(code), active: true, role: role, cree: new Date().toISOString()};
  if (existant && existant.cree) t[id].cree = existant.cree;
  props_().setProperty('TOKENS', JSON.stringify(t));
  return code;
}
function membreExiste_(id) {
  var I = index_(), e = I.idx['membres\u0001' + id];
  return e && e.o && !e.corrompu && !e.doublon && e.o._deleted !== true ? e.o : null;
}
function nbAdminsActifs_() {
  var t = jetons_(), n = 0;
  Object.keys(t).forEach(function (id) { if (t[id] && t[id].active === true && t[id].role === 'Membre') n++; });
  return n;
}
function chargerAccesAdmin_() {
  var I = index_(), t = jetons_(), codes = [], liste = [];
  Object.keys(I.idx).forEach(function (k) {
    if (k.indexOf('membres\u0001') !== 0) return;
    var e = I.idx[k], id = k.split('\u0001')[1];
    if (!e.o || e.corrompu || e.doublon || e.o._deleted === true) return;
    if (!t[id] || !simple_(t[id]) || (t[id].role !== 'Membre' && t[id].role !== 'Salarie')) {
      var code = nouveauCode_(id, 'Salarie');
      codes.push({id: id, code: code});
      t = jetons_();
    }
    var acces = t[id];
    liste.push({id: id, nom: nomMembre_(e.o), role: acces.role, active: acces.active === true});
  });
  liste.sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); });
  return {membres: liste, codesGeneres: codes};
}
function chargerSalarie_(qui) {
  var I = index_(), data = {};
  COLLECTIONS_LECTURE.forEach(function (c) { data[c] = {}; });
  var membre = fiche_(I, 'membres', qui);
  if (!membre || membre._deleted === true) return data;
  data.membres[qui] = cloner_(membre);
  var configuration = fiche_(I, 'config', 'main');
  if (configuration) data.config.main = {
    smic: configuration.smic,
    cot: configuration.cot,
    patr: configuration.patr,
    chomage: configuration.chomage
  };
  var etudes = {};
  Object.keys(I.idx).forEach(function (k) {
    var e = I.idx[k]; if (!e.o || e.corrompu || e.doublon || e.o._deleted === true) return;
    var p = k.split('\u0001'), c = p[0], id = p[1], o = e.o;
    if (c === 'interventions' && o.membreId === qui) { data.interventions[id] = cloner_(o); etudes[o.etudeId] = true; }
    if (c === 'lignesBV' && o.membreId === qui) data.lignesBV[id] = cloner_(o);
    if (c === 'formation' && o.membreId === qui) {
      data.formation[id] = cloner_(o);
      Object.keys(o.niveaux || {}).forEach(function (etudeId) { etudes[etudeId] = true; });
    }
  });
  Object.keys(I.idx).forEach(function (k) {
    var e = I.idx[k]; if (!e.o || e.corrompu || e.doublon || e.o._deleted === true) return;
    var p = k.split('\u0001'), c = p[0], id = p[1], o = e.o;
    if (c === 'bvs' && Object.keys(data.lignesBV).some(function (lid) { return data.lignesBV[lid].bvId === id; })) {
      var lignesDuBV = Object.keys(I.idx).filter(function (key) {
        var ligne = I.idx[key];
        return key.indexOf('lignesBV\u0001') === 0 && ligne.o && !ligne.corrompu && !ligne.doublon &&
          ligne.o._deleted !== true && ligne.o.bvId === id;
      });
      var bvPerso = lignesDuBV.length === 1 && data.lignesBV[lignesDuBV[0].split('\u0001')[1]] !== undefined;
      var projectionBV = {id: id, date: o.date || '', reference: o.reference || ''};
      if (bvPerso) {
        if (o.net !== undefined) projectionBV.net = o.net;
        if (o.brut !== undefined) projectionBV.brut = o.brut;
      }
      data.bvs[id] = projectionBV;
    }
    if (c === 'etudes' && etudes[id]) data.etudes[id] = {id: id, num: o.num || '', resume: o.resume || '', date: o.date || '', statut: o.statut || ''};
  });
  return data;
}

// ---------- Index des Données ----------
function index_() {
  var sh = feuille_('Données'), v = lignes_(sh), idx = {}, anomalies = [];
  v.forEach(function (r, i) {
    if (!r[0] && !r[1] && !r[2]) return;
    var c = String(r[0]), id = String(r[1]), k = c + '\u0001' + id, ligne = i + 2;
    if (COLLECTIONS_LECTURE.indexOf(c) < 0) { anomalies.push({collection: c, id: id, ligne: ligne, erreur: 'collection'}); return; }
    if (c === 'config' ? id !== 'main' : !ID_VALIDE.test(id)) { idx[k] = {ligne: ligne, lignes: [ligne], corrompu: true}; anomalies.push({collection: c, id: id, ligne: ligne, erreur: 'id'}); return; }
    if (idx[k]) { idx[k].lignes.push(ligne); idx[k].doublon = true; anomalies.push({collection: c, id: id, ligne: ligne, erreur: 'doublon'}); return; }
    var o = null; try { o = JSON.parse(r[2]); } catch (x) {}
    if (!simple_(o)) { idx[k] = {ligne: ligne, lignes: [ligne], corrompu: true}; anomalies.push({collection: c, id: id, ligne: ligne, erreur: 'json'}); return; }
    if (o.id !== undefined && o.id !== id) { idx[k] = {ligne: ligne, lignes: [ligne], corrompu: true}; anomalies.push({collection: c, id: id, ligne: ligne, erreur: 'id_mismatch'}); return; }
    if (o._v !== undefined && (!Number.isSafeInteger(o._v) || o._v < 1)) { idx[k] = {ligne: ligne, lignes: [ligne], corrompu: true}; anomalies.push({collection: c, id: id, ligne: ligne, erreur: 'version'}); return; }
    o.id = id;
    idx[k] = {ligne: ligne, lignes: [ligne], o: o, v: o._v || 0};
  });
  Object.keys(idx).forEach(function (k) { if (idx[k].doublon) { var p = k.split('\u0001'); anomalies.push({collection: p[0], id: p[1], ligne: idx[k].ligne, erreur: 'doublon'}); } });
  return {sh: sh, idx: idx, anomalies: anomalies};
}
function fiche_(I, c, id) { var e = I.idx[c + '\u0001' + id]; return e && e.o && !e.corrompu && !e.doublon ? e.o : null; }
function vivante_(I, c, id) { var o = fiche_(I, c, id); return !!o && o._deleted !== true; }

// ---------- Traitement ----------
function traiter_(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > MAX_REQUETE || octets_(raw) > MAX_REQUETE) return erreur_('PAYLOAD_TOO_LARGE', 'Requête trop volumineuse');
    var q; try { q = JSON.parse(raw); } catch (x) { return erreur_('INVALID_REQUEST', 'JSON invalide'); }
    if (!simple_(q) || q.apiVersion !== API) return erreur_('API_VERSION_MISMATCH', "Version d'API incompatible");
    if (q.action === 'ping' && (typeof q.token !== 'string' || q.token === '' || membre_(q.token) === null)) {
      return reponse_(true, {apiVersion: API, authentifie: false}, null, {revision: revision_()});
    }
    if (typeof q.token !== 'string' || q.token.trim() === '') return erreur_('AUTH_REQUIRED', 'Authentification requise');
    var qui = membre_(q.token);
    if (!qui) return erreur_('AUTH_INVALID', 'Jeton invalide');
    var role = roleAcces_(qui);
    if (!role) return erreur_('AUTH_ROLE_REQUIRED', 'Rôle d’accès non attribué');
    if (q.action === 'ping') return reponse_(true, {apiVersion: API, authentifie: true, membreId: qui, role: role}, null, {revision: revision_()});
    if (q.action === 'loadAll') return verrou_(function () { return role === 'Membre' ? chargerTout_() : reponse_(true, chargerSalarie_(qui), null, {revision: revision_(), schemaVersion: API, vue: 'personnelle'}); });
    if (q.action === 'save' || q.action === 'delete') {
      if (role !== 'Membre') return erreur_('FORBIDDEN', 'Les accès Salarié sont en lecture seule');
      return verrou_(function () { return muter_(q, qui); });
    }
    if (q.action === 'adminAcces' || q.action === 'adminDefinirRole' || q.action === 'adminRegenererCode' || q.action === 'adminDesactiver' || q.action === 'adminReactiver' || q.action === 'changerMonCode') {
      return verrou_(function () { return gererAcces_(q, qui, role); });
    }
    return erreur_('INVALID_REQUEST', 'Action inconnue');
  } catch (x) {
    if (x instanceof ConfigErr) { console.log('Configuration serveur : ' + x.config); return erreur_('INTERNAL_ERROR', 'Configuration du serveur incomplète'); }
    console.log('Erreur serveur : ' + (x && x.name)); // jamais le jeton ni les données
    return erreur_('INTERNAL_ERROR', 'Erreur interne');
  }
}

function chargerTout_() {
  var I = index_(), data = {};
  COLLECTIONS_LECTURE.forEach(function (c) { data[c] = {}; });
  Object.keys(I.idx).forEach(function (k) {
    var e = I.idx[k]; if (e.corrompu || e.doublon) return; // une clé ambiguë n'est jamais publiée
    var p = k.split('\u0001'), o = cloner_(e.o);
    delete o._opId;
    data[p[0]][p[1]] = o;
  });
  return reponse_(true, data, null, {revision: revision_(), schemaVersion: API, anomalies: I.anomalies});
}

function relation_(I, c, r) {
  if (c === 'etudes' && r.clientId && !fiche_(I, 'clients', r.clientId)) return 'Client lié introuvable';
  if (c === 'factures' && (!r.etudeId || !vivante_(I, 'etudes', r.etudeId))) return 'Étude liée introuvable';
  if (c === 'interventions') {
    if (!vivante_(I, 'etudes', r.etudeId)) return 'Étude liée introuvable';
    if (!vivante_(I, 'membres', r.membreId)) return 'Membre lié introuvable';
  }
  if (c === 'lignesBV') {
    if (!vivante_(I, 'bvs', r.bvId)) return 'BV parent introuvable';
    if (!vivante_(I, 'membres', r.membreId)) return 'Membre lié introuvable';
  }
  if (c === 'formation') {
    if (!vivante_(I, 'membres', r.membreId)) return 'Membre de formation introuvable';
    var prefixGrille = 'formation\u0001';
    var autreGrille = Object.keys(I.idx).some(function(key) {
      var e = I.idx[key];
      return key.indexOf(prefixGrille) === 0 && key !== prefixGrille + r.id && e.o &&
        !e.corrompu && !e.doublon && e.o._deleted !== true && e.o.membreId === r.membreId;
    });
    if (autreGrille) return 'Une grille Qualité formation existe déjà pour ce membre';
    if (!simple_(r.niveaux)) return 'Grille de niveaux invalide';
    var idsEtudes = Object.keys(r.niveaux);
    for (var fi = 0; fi < idsEtudes.length; fi++) {
      if (!vivante_(I, 'etudes', idsEtudes[fi])) return 'Étude de formation introuvable';
    }
  }
  return null;
}

function dateValide_(s) {
  if(typeof s!=='string') return false;
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if(!m) return false;
  var d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return d.getUTCFullYear()==+m[1]&&d.getUTCMonth()==+m[2]-1&&d.getUTCDate()==+m[3];
}
function texte_(v){return typeof v==='string'&&v.trim()!=='';}
function nombreNonNegatif_(v){return typeof v==='number'&&isFinite(v)&&v>=0;}
function nombrePositif_(v){return typeof v==='number'&&isFinite(v)&&v>0;}
function validerMetier_(c,r) {
  if(Object.keys(r).length>100) return 'Trop de champs dans la fiche';
  if(c==='clients'&&!texte_(r.raisonSociale)&&!texte_(r.nom)&&!texte_(r.name)) return 'Nom du client requis';
  if(c==='membres'&&!texte_(r.nomComplet)&&!texte_(r.nom)&&!texte_(r.prenom)) return 'Nom du membre requis';
  if(c==='etudes'){
    if(!dateValide_(r.date)||!texte_(r.num)||!texte_(r.statut)||!nombreNonNegatif_(r.montant)) return 'Étude : date, numéro, statut ou montant invalide';
    if(!texte_(r.client)&&!r.clientId) return 'Étude : client ou clientId requis';
    if(r.clientId&&(typeof r.clientId!=='string'||!ID_VALIDE.test(r.clientId))) return 'Étude : clientId invalide';
    var signe=['Devis signé','Convention signée','Convention étudiant avant réalisation','En réalisation','Archivée'];
    if(signe.indexOf(r.statut)>=0&&!nombrePositif_(r.jeh)) return 'Étude signée : prix unitaire JEH client HT positif requis';
  }
  if(c==='factures'&&(typeof r.etudeId!=='string'||!ID_VALIDE.test(r.etudeId)||!texte_(r.type)||!texte_(r.etat)||!nombreNonNegatif_(r.montant)))
    return 'Facture : étude, type, état ou montant invalide';
  if(c==='interventions'){
    if(typeof r.etudeId!=='string'||!ID_VALIDE.test(r.etudeId)||typeof r.membreId!=='string'||!ID_VALIDE.test(r.membreId)||
       !dateValide_(r.date)||['Payé','Pas payé','A venir','Non effectué'].indexOf(r.statut)<0||
       !nombrePositif_(r.minutesIndividuelles)||(r.prixJehHt!==undefined&&r.prixJehHt!==null&&!nombreNonNegatif_(r.prixJehHt)))
      return 'Intervention : étude, membre, date, statut, durée ou prix invalide';
  }
  if(c==='lignesBV'&&(typeof r.bvId!=='string'||!ID_VALIDE.test(r.bvId)||typeof r.membreId!=='string'||!ID_VALIDE.test(r.membreId)||!nombreNonNegatif_(r.jeh)))
    return 'Ligne BV : BV, membre ou nombre de JEH invalide';
  if(c==='formation'){
    if(!texte_(r.nom)) return 'Nom de formation requis';
    if(typeof r.membreId!=='string'||!ID_VALIDE.test(r.membreId)) return 'Membre de formation invalide';
    if(!simple_(r.niveaux)||Object.keys(r.niveaux).length>500) return 'Grille de niveaux invalide';
    var niveauxIds=Object.keys(r.niveaux);
    for(var ni=0;ni<niveauxIds.length;ni++){
      var niveau=r.niveaux[niveauxIds[ni]];
      if(!ID_VALIDE.test(niveauxIds[ni])||!Number.isInteger(niveau)||niveau<0||niveau>4) return 'Niveau de formation invalide';
    }
  }
  return '';
}

function valider_(q) {
  if (COLLECTIONS_ECRITURE.indexOf(q.collection) < 0)
    return COLLECTIONS_LECTURE.indexOf(q.collection) >= 0 ? ['READ_ONLY_COLLECTION', 'Collection en lecture seule'] : ['UNKNOWN_COLLECTION', 'Collection inconnue'];
  // config est une fiche unique : seul l'identifiant « main » est accepté, et elle ne se supprime pas.
  if (q.collection === 'config' ? q.id !== 'main' : (typeof q.id !== 'string' || !ID_VALIDE.test(q.id))) return ['INVALID_REQUEST', 'Identifiant absent ou invalide'];
  if (q.action === 'delete' && q.collection === 'config') return ['INVALID_REQUEST', 'La configuration principale ne peut pas être supprimée'];
  if (typeof q.opId !== 'string' || !OP_ID_VALIDE.test(q.opId)) return ['INVALID_REQUEST', 'opId absent ou invalide'];
  if (typeof q.expectedVersion !== 'number' || q.expectedVersion % 1 !== 0 || q.expectedVersion < (q.action === 'delete' ? 1 : 0) || q.expectedVersion > 9007199254740991)
    return ['INVALID_REQUEST', 'expectedVersion invalide'];
  if (q.action === 'save') {
    if (!simple_(q.record) || q.record.id !== q.id || q.record._deleted === true) return ['INVALID_REQUEST', 'Enregistrement invalide ou identifiant incohérent'];
    var metier=validerMetier_(q.collection,q.record); if(metier) return ['INVALID_REQUEST',metier];
    if (octets_(JSON.stringify(q.record)) > MAX_FICHE) return ['PAYLOAD_TOO_LARGE', 'Enregistrement trop volumineux'];
  }
  return null;
}

// Mutation récupérable : 1) Journal « pending »  2) fiche écrite avec _opId  3) Journal « committed » + réponse.
// Une panne entre deux étapes est résolue au prochain accès à la fiche ou au rejeu de l'opération :
// si la fiche porte _opId, l'écriture a eu lieu ; sinon l'opération est close en OP_INTERRUPTED (rien écrit).
function journal_() { var sh = feuille_('Journal'); return {sh: sh, v: lignes_(sh)}; }
function clore_(J, i, rep) { J.sh.getRange(i + 2, 3).setValue(JSON.stringify(rep)); J.sh.getRange(i + 2, 5).setValue('committed'); J.v[i][2] = JSON.stringify(rep); J.v[i][4] = 'committed'; return rep; }
function resoudre_(J, I, c, id) {
  for (var i = 0; i < J.v.length; i++) {
    var r = J.v[i]; if (r[4] !== 'pending' || r[5] !== c || r[6] !== id) continue;
    var o = fiche_(I, c, id), faite = !!o && o._opId === r[0];
    clore_(J, i, faite ? reponse_(true, sansInterne_(o), null, {revision: revision_()})
                       : reponse_(false, null, {code: 'OP_INTERRUPTED', message: 'Opération interrompue, rien n’a été écrit : créer une nouvelle opération avec un nouvel opId'}, {revision: revision_()}));
  }
}
function trouver_(J, opId) {
  var t = []; for (var i = 0; i < J.v.length; i++) if (J.v[i][0] === opId) t.push(i);
  if (t.length > 1) throw new ConfigErr('Journal : opId en double');
  return t.length ? t[0] : -1;
}
function sansInterne_(o) { var c = cloner_(o); delete c._opId; return c; }

function dependance_(I, c, id) {
  var references = {
    clients:[['etudes','clientId']],
    etudes:[['factures','etudeId'],['interventions','etudeId']],
    membres:[['interventions','membreId'],['lignesBV','membreId'],['formation','membreId']],
    bvs:[['lignesBV','bvId']]
  }[c] || [];
  for (var i=0;i<references.length;i++) {
    var collection=references[i][0], field=references[i][1], prefix=collection+'\u0001';
    var trouve=Object.keys(I.idx).some(function(key) {
      var e=I.idx[key];
      return key.indexOf(prefix)===0 && e.o && !e.corrompu && !e.doublon &&
        e.o._deleted!==true && e.o[field]===id;
    });
    if (trouve) return 'Suppression refusée : des fiches '+collection+' référencent encore cet élément';
  }
  if (c === 'etudes') {
    var prefixFormation = 'formation\u0001';
    var grilleTrouvee = Object.keys(I.idx).some(function(key) {
      var entree = I.idx[key];
      return key.indexOf(prefixFormation) === 0 && entree.o && !entree.corrompu && !entree.doublon &&
        entree.o._deleted !== true && entree.o.niveaux &&
        Object.prototype.hasOwnProperty.call(entree.o.niveaux, id);
    });
    if (grilleTrouvee) return 'Suppression refusée : la grille Qualité formation référence encore cette étude';
  }
  return '';
}

function gererAcces_(q, qui, role) {
  var t = jetons_(), cible = q.membreId;
  if (q.action === 'changerMonCode') {
    var codePerso = nouveauCode_(qui, role, t[qui]);
    return reponse_(true, {code: codePerso, role: role}, null, {revision: revision_()});
  }
  if (role !== 'Membre') return erreur_('FORBIDDEN', 'Action réservée aux membres administrateurs');
  if (q.action === 'adminAcces') return reponse_(true, chargerAccesAdmin_(), null, {revision: revision_()});
  if (typeof cible !== 'string' || !ID_VALIDE.test(cible) || !membreExiste_(cible)) return erreur_('NOT_FOUND', 'Membre introuvable');
  var acces = t[cible];
  if (!acces || !simple_(acces)) return erreur_('NOT_FOUND', 'Accès non initialisé ; actualisez la liste des accès');
  if (q.action === 'adminDefinirRole') {
    if (q.role !== 'Membre' && q.role !== 'Salarie') return erreur_('INVALID_REQUEST', 'Rôle invalide');
    if (acces.role === q.role) return reponse_(true, {role: q.role, code: null}, null, {revision: revision_()});
    if (acces.role === 'Membre' && q.role === 'Salarie' && nbAdminsActifs_() <= 1) return erreur_('LAST_ADMIN', 'Le dernier accès Membre ne peut pas être rétrogradé');
    var codeRole = nouveauCode_(cible, q.role, acces);
    return reponse_(true, {role: q.role, code: codeRole}, null, {revision: revision_()});
  }
  if (q.action === 'adminRegenererCode') {
    var codeNouveau = nouveauCode_(cible, acces.role, acces);
    return reponse_(true, {role: acces.role, code: codeNouveau}, null, {revision: revision_()});
  }
  if (q.action === 'adminDesactiver' || q.action === 'adminReactiver') {
    if (q.action === 'adminDesactiver' && cible === qui) return erreur_('SELF_DEACTIVATE', 'Vous ne pouvez pas désactiver votre propre accès');
    if (q.action === 'adminDesactiver' && acces.role === 'Membre' && acces.active === true && nbAdminsActifs_() <= 1) return erreur_('LAST_ADMIN', 'Le dernier accès Membre ne peut pas être désactivé');
    t = jetons_(); t[cible].active = q.action === 'adminReactiver';
    if (t[cible].active) delete t[cible].revoque; else t[cible].revoque = new Date().toISOString();
    props_().setProperty('TOKENS', JSON.stringify(t));
    return reponse_(true, {active: t[cible].active}, null, {revision: revision_()});
  }
  return erreur_('INVALID_REQUEST', 'Action inconnue');
}

function muter_(q, qui) {
  var inv = valider_(q); if (inv) return erreur_(inv[0], inv[1]);
  var empreinte = sha_(stable_({action: q.action, collection: q.collection, id: q.id, record: q.action === 'save' ? q.record : null, expectedVersion: q.expectedVersion}));
  var J = journal_(), I = index_();
  resoudre_(J, I, q.collection, q.id);
  var k = trouver_(J, q.opId);
  if (k >= 0) {
    if (J.v[k][1] !== empreinte) return erreur_('DUPLICATE_OPERATION', 'opId déjà utilisé avec un contenu différent');
    try { return JSON.parse(J.v[k][2]); } catch (x) { throw new ConfigErr('Journal : réponse illisible'); }
  }
  var e = I.idx[q.collection + '\u0001' + q.id];
  if (e && (e.doublon || e.corrompu)) return erreur_('INVALID_REQUEST', 'Fiche à réparer par un administrateur (doublon ou ligne illisible)');
  var courant = e ? e.o : null, version = e ? e.v : 0;
  if (q.expectedVersion !== version || (q.action === 'save' && courant && courant._deleted === true))
    return erreur_('VERSION_CONFLICT', 'La fiche a changé depuis sa dernière lecture', {currentVersion: version});
  if (q.action === 'delete' && (!courant || courant._deleted === true)) return erreur_('NOT_FOUND', 'Fiche introuvable');
  if (q.action === 'delete') { var dependance=dependance_(I,q.collection,q.id); if (dependance) return erreur_('INVALID_REQUEST',dependance); }
  var suivant;
  if (q.action === 'save') {
    var rel = relation_(I, q.collection, q.record); if (rel) return erreur_('INVALID_REQUEST', rel);
    suivant = cloner_(q.record);
    CHAMPS_SERVEUR.forEach(function (f) { delete suivant[f]; }); // le serveur ne fait pas confiance aux champs système
  } else suivant = {_deleted: true};
  suivant.id = q.id; suivant._v = version + 1; suivant._par = qui; suivant._le = new Date().toISOString(); suivant._opId = q.opId;

  J.sh.appendRow([q.opId, empreinte, '', new Date().toISOString(), 'pending', q.collection, q.id, qui]);   // étape 1
  var ligneJ = J.sh.getLastRow() - 2; J.v.push([q.opId, empreinte, '', '', 'pending', q.collection, q.id, qui]);
  var s = JSON.stringify(suivant);
  if (e) I.sh.getRange(e.ligne, 3).setValue(s); else I.sh.appendRow([q.collection, q.id, s]);              // étape 2
  props_().setProperty('REVISION', String(revision_() + 1));
  return clore_(J, ligneJ, reponse_(true, sansInterne_(suivant), null, {revision: revision_()}));          // étape 3
}

// ---------- Administration (éditeur Apps Script uniquement, jamais par doPost) ----------
// Le jeton est généré hors d'Apps Script (crypto.getRandomValues) ; on n'enregistre ici que son empreinte.
function enregistrerJeton(membre, empreinte, role) {
  if (!ID_VALIDE.test(membre) || !/^[0-9a-f]{64}$/.test(empreinte) || (role !== 'Membre' && role !== 'Salarie')) throw new Error('paramètres invalides');
  var t = jetons_(); t[membre] = {h: empreinte, active: true, role: role, cree: new Date().toISOString()};
  props_().setProperty('TOKENS', JSON.stringify(t));
}
function revoquerJeton(membre) {
  var t = jetons_();
  if (t[membre]) { t[membre].active = false; t[membre].revoque = new Date().toISOString(); props_().setProperty('TOKENS', JSON.stringify(t)); }
}
function mettreEnQuarantaine(collection, id) {
  return verrou_(function () {
    var I = index_(), e = I.idx[collection + '\u0001' + id]; if (!e || !(e.doublon || e.corrompu)) throw new Error('fiche saine');
    var Q = feuille_('Quarantaine'), now = new Date().toISOString(), L = e.lignes.slice().sort(function (a, b) { return b - a; });
    L.forEach(function (l) { Q.appendRow([now, l, collection, id, I.sh.getRange(l, 3).getValues()[0][0]]); });
    var garde = L.pop(); L.forEach(function (l) { I.sh.deleteRow(l); });
    I.sh.getRange(garde, 3).setValue(JSON.stringify({id: id, _deleted: true, _v: Math.floor(Date.now() / 1000), _par: 'admin', _le: now}));
    return e.lignes.length;
  });
}
