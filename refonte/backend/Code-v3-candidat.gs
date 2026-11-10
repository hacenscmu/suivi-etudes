// HAC — backend API v3 candidat. NE PAS DÉPLOYER SUR LE PROJET DE PRODUCTION.
// À tester uniquement dans un projet Apps Script et un Google Sheet de copie.
// Feuilles : Données [collection | id | json], Journal [clé | membre | action | collection | id | empreinte | résultat | date | version avant | état],
// Quarantaine [date | ligne d'origine | collection | id | json brut].
// Le SSID et les empreintes de jetons sont des Script Properties du projet de test.

var API_VERSION = 3;
var MAX_REQUEST_BYTES = 200000;
var MAX_RECORD_BYTES = 50000;
var MAX_TEXT = 2000;
var JOURNAL_DAYS = 30;
var SYSTEM_FIELDS = ['_v', '_par', '_le', '_deleted', '_opId'];
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
var OP_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

var WRITE_COLLECTIONS = [
  'etudes', 'clients', 'membres', 'factures', 'interventions',
  'bvs', 'lignesBV', 'formation', 'config', 'appareils'
];
var READ_COLLECTIONS = WRITE_COLLECTIONS.concat(['temps']);
var CONFIG_IDS = ['main'];

var TXT = {t:'s'}, DATE = {t:'d'}, NUM = {t:'n',min:0}, ORD = {t:'n'};
var ID = {t:'id'}, BOOL = {t:'b'};
var ENUM_RELATION = {t:'e', values:['ponctuelle','longue_duree']};
var ENUM_CADENCE = {t:'e', values:['mensuelle','trimestrielle','semestrielle','annuelle']};

var SCHEMAS = {
  etudes: {
    date:DATE, client:TXT, clientId:ID, num:TXT, resume:TXT, statut:TXT,
    facture:TXT, jeh:NUM, montant:NUM, echeance:DATE, ord:ORD,
    relationType:ENUM_RELATION, cadenceFacturation:ENUM_CADENCE, dateProchaineFacture:DATE
  },
  clients: {
    raisonSociale:TXT, nom:TXT, name:TXT, contact:TXT, email:TXT, telephone:TXT,
    adresse:TXT, codePostal:TXT, ville:TXT, siret:TXT, notes:TXT, statut:TXT,
    relationType:ENUM_RELATION, cadenceFacturation:ENUM_CADENCE, dateProchaineFacture:DATE
  },
  membres: {
    nomComplet:TXT, nom:TXT, prenom:TXT, email:TXT, telephone:TXT,
    role:TXT, actif:BOOL, dateArrivee:DATE, dateDepart:DATE, notes:TXT
  },
  factures: {
    date:DATE, etudeId:{t:'id',req:1},
    type:{t:'e',req:1,values:['Acompte','Intermédiaire','Solde']},
    etat:{t:'e',req:1,values:['Émise','Payée']},
    montant:{t:'n',req:1,min:0}, echeance:DATE, datePaiement:DATE, note:TXT, ord:ORD
  },
  interventions: {
    date:{t:'d',req:1}, etudeId:{t:'id',req:1}, membreId:{t:'id',req:1},
    statut:{t:'e',req:1,values:['Pas payé','Payé','A venir','Non effectué']},
    minutesIndividuelles:{t:'n',req:1,min:0.000001},
    prixJehHt:NUM, note:TXT, ord:ORD
  },
  bvs: {date:DATE, numero:TXT, reference:TXT, periode:TXT, statut:TXT, note:TXT, ord:ORD},
  lignesBV: {
    bvId:{t:'id',req:1}, membreId:{t:'id',req:1}, jeh:{t:'n',req:1,min:0},
    statut:{t:'e',values:['Pas payé','Payé','A venir','Non effectué']},
    note:TXT, ord:ORD
  },
  // Lecture seule : schéma v11, conservé pour audit/migration.
  temps: {
    date:DATE, prenom:TXT, etude:TXT,
    statut:{t:'e',values:['Pas payé','Payé','A venir','Non effectué']},
    min:NUM, nb:{t:'n',min:1,int:1}, jeh:NUM, note:TXT, ord:ORD
  },
  formation: {nom:{t:'s',req:1}, niveaux:{t:'niveaux'}},
  appareils: {nom:TXT, last:TXT, v:NUM},
  config: {
    statuts:{t:'ls'}, factures:{t:'ls'}, mandats:{t:'mandats'},
    relance1:{t:'n',min:0,int:1}, relance2:{t:'n',min:0,int:1},
    tva:{t:'n',min:0,max:1}, smic:NUM, cot:{t:'taux'}, patr:{t:'taux'},
    chomage:{t:'n',min:0,max:1}, cnje:{t:'cnje'}, alertesOn:BOOL, alertesOff:{t:'bools'}
  }
};

function envelope_(ok, data, error, meta) {
  return {
    ok: ok,
    apiVersion: API_VERSION,
    ...(ok ? {data:data} : {}),
    meta: meta || {},
    error: error || null
  };
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function ok_(data, meta) { return envelope_(true, data, null, meta); }
function fail_(code, message, details) {
  var e = {code:code, message:message};
  if (details) e.details = details;
  return envelope_(false, null, e, {revision:revision_()});
}
function bytes_(s) { return Utilities.newBlob(s).getBytes().length; }
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
}
function same_(a,b) {
  if (typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false;
  var d=0; for(var i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i);
  return d===0;
}
function props_(){return PropertiesService.getScriptProperties();}
function tokens_(){
  var raw=props_().getProperty('TOKENS'); if(!raw) return {};
  var t; try{t=JSON.parse(raw);}catch(e){throw new Error('TOKENS illisible');}
  if(!t||typeof t!=='object'||Array.isArray(t)) throw new Error('TOKENS invalide');
  return t;
}
function auth_(token){
  if(typeof token!=='string'||token.length>200) return null;
  var p=token.split('.');
  if(p.length!==2||!/^[A-Za-z0-9_-]{1,64}$/.test(p[0])||!/^[0-9a-f]{64}$/.test(p[1])) return null;
  var entry=tokens_()[p[0]];
  if(!entry||entry.active!==true||typeof entry.hash!=='string') return null;
  return same_(sha_(token),entry.hash)?p[0]:null;
}
function failedAuth_(){
  var c=CacheService.getScriptCache(), k='hac-v3-auth:'+new Date().toISOString().slice(0,13);
  var n=(Number(c.get(k))||0)+1; c.put(k,String(n),7200);
  if(n===100) console.log('Alerte : 100 échecs d’authentification dans l’heure');
}
function revision_(){return Number(props_().getProperty('REVISION')||0);}
function bumpRevision_(){
  var n=revision_()+1; props_().setProperty('REVISION',String(n)); return n;
}

function doGet(){
  return out_(ok_({service:'HAC API',apiVersion:API_VERSION},{revision:revision_()}));
}
function doPost(e){
  try {
    var raw=e&&e.postData&&e.postData.contents;
    if(typeof raw!=='string'||raw.length>MAX_REQUEST_BYTES||bytes_(raw)>MAX_REQUEST_BYTES)
      return out_(fail_('INVALID_REQUEST','Corps de requête absent ou trop volumineux'));
    var b; try{b=JSON.parse(raw);}catch(x){return out_(fail_('INVALID_REQUEST','JSON invalide'));}
    if(!b||typeof b!=='object'||Array.isArray(b))
      return out_(fail_('INVALID_REQUEST','La requête doit être un objet'));
    if(b.apiVersion!==API_VERSION)
      return out_(fail_('API_VERSION_MISMATCH','Le client et le serveur doivent utiliser API v3'));
    if(b.action==='ping'){
      var pingWho=null;
      try{pingWho=auth_(b.token);}catch(x){}
      return out_(ok_({apiVersion:API_VERSION,authentifie:!!pingWho},{revision:revision_()}));
    }
    var who;
    try{who=auth_(b.token);}catch(x){return out_(fail_('SERVER_CONFIG','Configuration des jetons invalide'));}
    if(!who){failedAuth_();return out_(fail_((typeof b.token==='string'&&b.token)?'AUTH_INVALID':'AUTH_REQUIRED','Authentification requise ou invalide'));}
    if(b.action==='loadAll') return out_(locked_(loadAll_));
    if(b.action==='save'||b.action==='delete') return out_(locked_(function(){return mutate_(b,who);}));
    return out_(fail_('INVALID_REQUEST','Action inconnue'));
  } catch(x) {
    console.log('Erreur API v3 : '+(x&&x.name));
    return out_(fail_('INTERNAL_ERROR','Erreur interne du serveur'));
  }
}
function locked_(fn){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{return fn();}finally{lock.releaseLock();}
}
function spreadsheet_(){
  var id=props_().getProperty('SSID');
  if(!id) throw new Error('SSID manquant dans les propriétés du projet de test');
  return SpreadsheetApp.openById(id);
}
function sheet_(name){
  var sh=spreadsheet_().getSheetByName(name);
  if(!sh) throw new Error('Feuille '+name+' absente ; initialiser uniquement sur une copie');
  return sh;
}
function rows_(sh){
  var n=sh.getLastRow()-1;
  return n>0?sh.getRange(2,1,n,sh.getLastColumn()).getValues():[];
}
function initialiserFeuillesV3(){
  // À exécuter uniquement sur une copie dédiée. Ne crée ni ne modifie la feuille Données.
  var ss=spreadsheet_();
  if(!ss.getSheetByName('Données')) throw new Error('La feuille Données doit déjà exister sur la copie');
  var journal=ss.getSheetByName('Journal');
  if(!journal){journal=ss.insertSheet('Journal');journal.appendRow(['clé','membre','action','collection','id','empreinte','résultat','date','version avant','état']);}
  var quarantine=ss.getSheetByName('Quarantaine');
  if(!quarantine){quarantine=ss.insertSheet('Quarantaine');quarantine.appendRow(['date','ligne d’origine','collection','id','json brut']);}
  return {journal:true,quarantaine:true};
}

function index_(){
  var sh=sheet_('Données'), values=rows_(sh), idx={}, bad=[];
  values.forEach(function(row,i){
    if(!row[0]&&!row[1]&&!row[2]) return;
    var col=String(row[0]), id=String(row[1]), key=col+'\u0001'+id, line=i+2;
    if(READ_COLLECTIONS.indexOf(col)<0){bad.push({collection:col,id:id,line:line,reason:'unknown_collection'});return;}
    if(!validIdForCollection_(col,id)){bad.push({collection:col,id:id,line:line,reason:'invalid_id'});return;}
    if(idx[key]){
      idx[key].duplicate=true; idx[key].lines.push(line);
      bad.push({collection:col,id:id,line:line,reason:'duplicate'});
      return;
    }
    var obj; try{obj=JSON.parse(row[2]);}catch(x){obj=null;}
    if(!obj||typeof obj!=='object'||Array.isArray(obj)){
      idx[key]={line:line,lines:[line],corrupt:true}; bad.push({collection:col,id:id,line:line,reason:'invalid_json'}); return;
    }
    if(obj.id!==undefined&&obj.id!==id){
      idx[key]={line:line,lines:[line],corrupt:true}; bad.push({collection:col,id:id,line:line,reason:'id_mismatch'}); return;
    }
    obj.id=id;
    idx[key]={line:line,lines:[line],obj:obj,version:(Number.isSafeInteger(obj._v)&&obj._v>=0)?obj._v:0};
  });
  return {sheet:sh,index:idx,anomalies:bad};
}
function loadAll_(){
  var I=index_(), data={};
  READ_COLLECTIONS.forEach(function(c){data[c]={};});
  Object.keys(I.index).forEach(function(key){
    var e=I.index[key];
    if(e.corrupt||e.duplicate) return;
    var p=key.split('\u0001'), obj={};
    Object.keys(e.obj).forEach(function(k){if(k!=='_opId')obj[k]=e.obj[k];});
    data[p[0]][p[1]]=obj; // Les tombstones _deleted restent visibles pour empêcher la résurrection par cache.
  });
  return ok_(data,{revision:revision_(),anomalies:I.anomalies});
}

function validIdForCollection_(col,id){return col==="config"?id==="main":typeof id==="string"&&ID_RE.test(id);}
function dateOk_(s){
  if(typeof s!=='string') return false;
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if(!m) return false;
  var d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return d.getUTCFullYear()==+m[1]&&d.getUTCMonth()==+m[2]-1&&d.getUTCDate()==+m[3];
}
function numOk_(v,f){
  return typeof v==='number'&&isFinite(v)&&(f.min===undefined||v>=f.min)&&
    (f.max===undefined||v<=f.max)&&(!f.int||v%1===0);
}
function plain_(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function fieldOk_(f,v){
  switch(f.t){
    case 's': return typeof v==='string'&&v.length<=MAX_TEXT;
    case 'd': return dateOk_(v);
    case 'n': return numOk_(v,f);
    case 'id': return typeof v==='string'&&ID_RE.test(v);
    case 'e': return f.values.indexOf(v)>=0;
    case 'b': return typeof v==='boolean';
    case 'ls': return Array.isArray(v)&&v.length<=100&&v.every(function(x){return typeof x==='string'&&x.length<=200;});
    case 'niveaux': return plain_(v)&&Object.keys(v).every(function(k){var x=v[k];return x===null||(typeof x==='number'&&x>=0&&x<=4&&x%1===0);});
    case 'taux': return plain_(v)&&Object.keys(v).every(function(k){return numOk_(v[k],{min:0,max:1});});
    case 'bools': return plain_(v)&&Object.keys(v).every(function(k){return typeof v[k]==='boolean';});
    case 'mandats': return Array.isArray(v)&&v.length<=100&&v.every(function(m){return plain_(m)&&typeof m.nom==='string'&&m.nom.length<=200&&(!m.debut||dateOk_(m.debut))&&(!m.fin||dateOk_(m.fin));});
    case 'cnje': return plain_(v)&&(!v.date||dateOk_(v.date))&&['min','max','maxInt'].every(function(k){return v[k]===undefined||v[k]===null||numOk_(v[k],{min:0});});
  }
  return false;
}
function validateRecord_(col,id,record){
  if(!plain_(record)||record.id!==id) return 'record.id doit correspondre à id';
  for(var i=0;i<SYSTEM_FIELDS.length;i++){
    if(Object.prototype.hasOwnProperty.call(record,SYSTEM_FIELDS[i])) return 'champ système interdit : '+SYSTEM_FIELDS[i];
  }
  if(col==='config'&&CONFIG_IDS.indexOf(id)<0) return 'identifiant config interdit';
  var schema=SCHEMAS[col]; if(!schema) return 'collection inconnue';
  for(var field in record){
    if(field==='id') continue;
    if(!Object.prototype.hasOwnProperty.call(schema,field)) return 'champ inconnu : '+field;
    var value=record[field];
    if(value===null||value==='') continue;
    if(!fieldOk_(schema[field],value)) return 'valeur invalide : '+field;
  }
  for(var required in schema){
    if(schema[required].req&&(record[required]===undefined||record[required]===null||record[required]===''))
      return 'champ requis : '+required;
  }
  return '';
}
function active_(I,col,id){
  var e=I.index[col+'\u0001'+id];
  return e&&!e.corrupt&&!e.duplicate&&e.obj&&!e.obj._deleted?e:null;
}
function relationError_(I,col,record){
  if(col==='etudes'&&record.clientId&&!active_(I,'clients',record.clientId)) return 'Client lié introuvable';
  if(col==='factures'&&!active_(I,'etudes',record.etudeId)) return 'Étude liée introuvable';
  if(col==='interventions'){
    if(!active_(I,'etudes',record.etudeId)) return 'Étude liée introuvable';
    if(!active_(I,'membres',record.membreId)) return 'Membre lié introuvable';
  }
  if(col==='lignesBV'){
    if(!active_(I,'bvs',record.bvId)) return 'BV parent introuvable';
    if(!active_(I,'membres',record.membreId)) return 'Membre lié introuvable';
  }
  return '';
}
function dependanceError_(I,col,id){
  var refs={
    clients:[['etudes','clientId']],
    etudes:[['factures','etudeId'],['interventions','etudeId']],
    membres:[['interventions','membreId'],['lignesBV','membreId']],
    bvs:[['lignesBV','bvId']]
  }[col]||[];
  for(var i=0;i<refs.length;i++){
    var collection=refs[i][0],field=refs[i][1];
    var found=Object.keys(I.index).some(function(key){
      var e=I.index[key];return key.indexOf(collection+'\u0001')===0&&!e.corrupt&&!e.duplicate&&e.obj&&!e.obj._deleted&&e.obj[field]===id;
    });
    if(found) return 'Suppression refusée : des fiches '+collection+' référencent encore cet élément';
  }
  return '';
}

function journal_(){var sh=sheet_('Journal');return {sheet:sh,values:rows_(sh)};}
function journalFind_(J,key){
  var hits=[];
  for(var i=0;i<J.values.length;i++) if(J.values[i][0]===key) hits.push(i);
  if(hits.length>1) throw new Error('Clé de journal dupliquée');
  if(!hits.length) return null;
  var row=J.values[hits[0]], result=null;
  if(row[9]==='committed'){try{result=JSON.parse(row[6]);}catch(x){throw new Error('Résultat de journal illisible');}}
  return {line:hits[0]+2,key:row[0],fingerprint:row[5],result:result,state:row[9]};
}
function journalCommit_(J,line,result){
  J.sheet.getRange(line,7).setValue(JSON.stringify(result));
  J.sheet.getRange(line,10).setValue('committed');
  return result;
}
function recoverPending_(J,I,col,id){
  for(var i=0;i<J.values.length;i++){
    var row=J.values[i];
    if(row[9]!=='pending'||row[3]!==col||row[4]!==id) continue;
    var current=I.index[col+'\u0001'+id];
    var applied=current&&current.obj&&current.obj._opId===row[0];
    var result=applied
      ? envelope_(true,{id:id,version:current.version},{},{revision:revision_()})
      : envelope_(false,null,{code:'OP_INTERRUPTED',message:'La mutation n’a pas été appliquée ; créer une nouvelle opération avec un nouvel opId'},{revision:revision_()});
    journalCommit_(J,i+2,result);
    J.values[i][6]=JSON.stringify(result); J.values[i][9]='committed';
  }
}
function conflict_(code,message,details){
  return envelope_(false,null,{code:code,message:message,details:details||null},{revision:revision_()});
}
function mutate_(b,who){
  var action=b.action, col=b.collection, id=b.id;
  if(WRITE_COLLECTIONS.indexOf(col)<0){
    return conflict_(READ_COLLECTIONS.indexOf(col)>=0?'READ_ONLY_COLLECTION':'UNKNOWN_COLLECTION',
      READ_COLLECTIONS.indexOf(col)>=0?'La collection historique temps est en lecture seule':'Collection inconnue');
  }
  if(!validIdForCollection_(col,id)) return conflict_('INVALID_REQUEST','Identifiant absent ou invalide');
  if(action==='delete'&&col==='config') return conflict_('INVALID_REQUEST','La configuration principale ne peut pas être supprimée');
  if(typeof b.opId!=='string'||!OP_RE.test(b.opId)) return conflict_('INVALID_REQUEST','opId stable absent ou invalide');
  if(typeof b.expectedVersion!=='number'||!Number.isSafeInteger(b.expectedVersion)||
     b.expectedVersion<(action==='delete'?1:0)) return conflict_('INVALID_REQUEST','expectedVersion invalide');

  var record=null, recordJson='';
  if(action==='save'){
    record=b.record;
    var validation=validateRecord_(col,id,record);
    if(validation) return conflict_('INVALID_REQUEST',validation);
    recordJson=JSON.stringify(record);
    if(bytes_(recordJson)>MAX_RECORD_BYTES) return conflict_('PAYLOAD_TOO_LARGE','Fiche trop volumineuse');
  }
  var fingerprint=sha_(JSON.stringify([action,col,id,b.expectedVersion,recordJson]));
  var operationKey=who+':'+b.opId;
  var J=journal_(), I=index_();
  recoverPending_(J,I,col,id);
  var previous=journalFind_(J,operationKey);
  if(previous){
    if(previous.fingerprint!==fingerprint) return conflict_('DUPLICATE_OPERATION','opId déjà utilisé avec un autre contenu');
    return previous.result;
  }

  var entry=I.index[col+'\u0001'+id];
  if(entry&&(entry.corrupt||entry.duplicate)) return conflict_('INVALID_REQUEST','Fiche corrompue ou dupliquée ; quarantaine administrateur requise');
  var currentVersion=entry?entry.version:0;
  var currentActive=entry&&!entry.obj._deleted;
  var result=null;
  if(action==='delete'&&!currentActive) result=conflict_('NOT_FOUND','Fiche absente ou déjà supprimée');
  else if(action==='save'&&entry&&entry.obj._deleted) result=conflict_('NOT_FOUND','Fiche supprimée ; restauration explicite non prise en charge');
  else if(currentVersion!==b.expectedVersion) result=conflict_('VERSION_CONFLICT','Version obsolète',{currentVersion:currentVersion});
  if(result){
    J.sheet.appendRow([operationKey,who,action,col,id,fingerprint,JSON.stringify(result),new Date().toISOString(),currentVersion,'committed']);
    return result;
  }

  if(action==='save'){
    var relation=relationError_(I,col,record);
    if(relation) return conflict_('INVALID_REQUEST',relation);
  } else {
    var dependency=dependanceError_(I,col,id);
    if(dependency) return conflict_('INVALID_REQUEST',dependency);
  }

  J.sheet.appendRow([operationKey,who,action,col,id,fingerprint,'',new Date().toISOString(),currentVersion,'pending']);
  var journalLine=J.sheet.getLastRow();
  var nextVersion=currentVersion+1;
  var next=action==='save'
    ? Object.assign({},record,{_v:nextVersion,_par:who,_le:new Date().toISOString(),_opId:operationKey})
    : {id:id,_deleted:true,_v:nextVersion,_par:who,_le:new Date().toISOString(),_opId:operationKey};
  var serialized=JSON.stringify(next);
  if(entry) I.sheet.getRange(entry.line,3).setValue(serialized);
  else I.sheet.appendRow([col,id,serialized]);
  bumpRevision_();
  var success=envelope_(true,{id:id,version:nextVersion,_v:nextVersion,_deleted:!!next._deleted},null,{revision:revision_()});
  return journalCommit_(J,journalLine,success);
}

function enregistrerJeton(membre,token){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(membre)||typeof token!=='string'||token.length>200||token.split('.').length!==2)
    throw new Error('Paramètres de jeton invalides');
  var parts=token.split('.');
  if(parts[0]!==membre||!/^[0-9a-f]{64}$/.test(parts[1])) throw new Error('Format membre.secret invalide');
  var all=tokens_(); all[membre]={hash:sha_(token),active:true,created:new Date().toISOString()};
  props_().setProperty('TOKENS',JSON.stringify(all));
}
function revoquerJeton(membre){
  var all=tokens_(); if(all[membre]){all[membre].active=false;all[membre].revoked=new Date().toISOString();props_().setProperty('TOKENS',JSON.stringify(all));}
}
function purgerJournal(){
  return locked_(function(){
    var J=journal_(), limit=new Date(Date.now()-JOURNAL_DAYS*864e5).toISOString(), removed=0;
    for(var i=J.values.length-1;i>=0;i--){
      if(J.values[i][9]==='committed'&&String(J.values[i][7])<limit){J.sheet.deleteRow(i+2);removed++;}
    }
    return removed; // Les lignes pending ne sont jamais purgées.
  });
}
