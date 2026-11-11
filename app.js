(function(){
"use strict";
/* ---------- utilitaires ---------- */
const $=(s,e)=>(e||document).querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const nf2=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const nf3=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3});
const eur=n=>nf2.format(n||0)+' €';
const nf1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1});
const eur0=n=>nf0.format(Math.round(n||0))+' €';
const num=v=>(v===null||v===undefined||v===''||isNaN(Number(v)))?0:Number(v);
const isNum=v=>v!==null&&v!==undefined&&v!==''&&!isNaN(Number(v));
const dnum=s=>{if(!s)return null;const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);if(!m)return null;const t=Date.UTC(+m[1],+m[2]-1,+m[3]),d=new Date(t);return d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?t/864e5:null}; // refuse les dates impossibles (31 février…)
const dstr=n=>new Date(n*864e5).toISOString().slice(0,10);
const now=new Date();const TODAY=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/864e5;
const fdate=n=>{const d=new Date(n*864e5);return d.toLocaleDateString('fr-FR',{timeZone:'UTC'})};
const MOIS=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const sGet=k=>{try{return localStorage.getItem(k)||''}catch(e){return ''}};
const sSet=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch(e){}};
const CONN=()=>({url:lsGet('suivi.url')||'',token:lsGet('suivi.token')||''}); // code d'accès personnel (v16)
const UNLOCKED=()=>true; // plus de mot de passe dans l’appli

/* ---------- configuration par défaut (réglages, pas de données) ---------- */
const DEFAULT_CFG={
 statuts:['Faisabilité','Devis envoyé','Devis signé','Convention envoyée','Convention signée','Convention étudiant avant réalisation','En réalisation','Archivée','Refusé / sans suite'],
 factures:['Sans acompte','Acompte à facturer','Acompte facturé','Acompte encaissé','Intermédiaire encaissé','Solde à facturer','Solde facturé','Solde encaissé'],
 mandats:[],
 relance1:3,relance2:10,tva:0.2,smic:12.02,
 cot:{maladie:0.013,retraiteP:0.069,retraiteD:0.004,csgD:0.068,csgND:0.029},
 patr:{maladie:0.13,at:0.0123,retraiteP:0.0855,retraiteD:0.0211,famille:0.0525,autres:0},
 chomage:0,
 cnje:{date:'',min:80,max:450,maxInt:300}
};
const COT_LAB={maladie:'maladie',retraiteP:'retraite plafonnée',retraiteD:'retraite déplafonnée',csgD:'CSG déductible',csgND:'CSG/CRDS non déductible'};
const PATR_LAB={maladie:'maladie',at:'accidents du travail',retraiteP:'retraite plafonnée',retraiteD:'retraite déplafonnée',famille:'famille',autres:'autres'};
const IN_PROGRESS=['Faisabilité','Devis envoyé','Devis signé','Convention envoyée','Convention signée','Convention étudiant avant réalisation','En réalisation'];
const SIGNED=['Devis signé','Convention signée','Convention étudiant avant réalisation','En réalisation','Archivée'];
const L_STAT=['Convention signée','Convention étudiant avant réalisation','En réalisation','Archivée'];
const INVOICED=['Acompte facturé','Facture intermédiaire','Solde facturé'];
const BV_STAT=['Pas payé','Payé','A venir','Non effectué'];

/* ---------- état ---------- */
const S={etudes:{},factures:{},temps:{},formation:{},clients:{},cfg:null};
let loaded={etudes:false,factures:false,temps:false,formation:false,clients:false,cfg:false};
let db=null,userCap=null,canWrite=true,tab=(lsGet('suivi.tab')==='temps'&&(lsSet('suivi.fseg','jeh'),lsSet('suivi.tab','finances')),['factures','remun'].includes(lsGet('suivi.tab'))&&lsSet('suivi.tab','finances'),['dash','etudes','finances','temps','formation','params'].includes(lsGet('suivi.tab'))?lsGet('suivi.tab'):'dash'),mandatSel=lsGet('suivi.mandat')||'Tous les mandats';
let dirty=false,pendingRender=false,timeoutNote=false,dbErr='';
// un mandat finit la veille du début du suivant ; le dernier n'a pas de fin
function withEnds(ms){const st=ms.map(m=>dnum(m.debut));return ms.map((m,i)=>{const a=st[i];if(a===null)return Object.assign({},m,{fin:''});const nx=st.filter(x=>x!==null&&x>a);return Object.assign({},m,{fin:nx.length?dstr(Math.min(...nx)-1):'2999-12-31',ouvert:!nx.length})})}
const cfg=()=>{const c=S.cfg||{};const d=DEFAULT_CFG;const o=Object.assign({},d,c,{cot:Object.assign({},d.cot,c.cot),patr:Object.assign({},d.patr,c.patr),cnje:Object.assign({},d.cnje,c.cnje)});o.mandats=withEnds(o.mandats||[]);return o};
const sorted=col=>Object.keys(S[col]).map(id=>Object.assign({id},S[col][id])).sort((a,b)=>(a.ord||0)-(b.ord||0));

/* ---------- persistance ---------- */
const queue={};
function save(path,obj){
  if(!db)return;
  queue[path]=(queue[path]||Promise.resolve()).then(()=>db.doc(path).set(obj)).catch(e=>{dbErr=(e&&e.code==='invalid_argument')?'Vous n’avez pas le droit de modifier ces données.':'Enregistrement impossible pour le moment.';if(e&&e.code==='invalid_argument')canWrite=false;renderStatus()});
}
function del(col,id){delete S[col][id];if(db){const p=col+'/'+id;queue[p]=(queue[p]||Promise.resolve()).then(()=>db.doc(p).delete()).catch(()=>{dbErr='Suppression impossible pour le moment.';renderStatus()})}}
function saveRow(col,id){save(col+'/'+id,S[col][id])}
function saveCfg(){save('config/main',S.cfg||{})}
function newId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
function addRow(col,defaults){const id=newId(col[0]);S[col][id]=Object.assign({ord:Date.now()},defaults);saveRow(col,id);render();return id}

/* ---------- calculs ---------- */
const F_TYPES=['Acompte','Intermédiaire','Solde'],F_ETATS=['Émise','Payée'];
// anciennes lignes = paiements reçus : le type se déduit de la note
function normFact(f){if(!f.type)f.type=/solde/i.test(f.note||'')?'Solde':/interm/i.test(f.note||'')?'Intermédiaire':'Acompte';if(!f.etat)f.etat='Payée';
  f.paid=f.etat==='Payée';f.de=dnum(f.date);f.dp=f.paid?dnum(f.datePaiement||f.date):null;f.ech=dnum(f.echeance);f.d=f.paid?f.dp:f.de;f.late=!f.paid&&f.ech!==null&&f.ech<TODAY}
// statut financier calculé : statut de l'étude + factures
function finStatus(e){
  const inv=e.inv,st=e.statut;
  if(st==='Refusé / sans suite')return inv.length?(inv.some(f=>!f.paid)?'Facture émise':'Encaissé'):'';
  const sol=inv.filter(f=>f.type==='Solde');
  if(sol.length)return inv.every(f=>f.paid)?'Solde encaissé':'Solde facturé'; // encaissé seulement si TOUTES les factures sont payées
  const unpaid=inv.find(f=>!f.paid);
  if(unpaid)return unpaid.type==='Intermédiaire'?'Facture intermédiaire':'Acompte facturé'; // une facture antérieure impayée n'est plus masquée
  const last=inv[inv.length-1];
  if(!last)return st==='Archivée'?(num(e.montant)>0?'Solde à facturer':''):L_STAT.includes(st)?'Acompte à facturer':'';
  if(!last.paid)return last.type==='Intermédiaire'?'Facture intermédiaire':'Acompte facturé';
  if(st==='Archivée')return 'Solde à facturer';
  return last.type==='Intermédiaire'?'Intermédiaire encaissé':'Acompte encaissé';
}
function mandatOf(dn,c){if(dn===null)return '';for(const m of c.mandats){const a=dnum(m.debut),b=dnum(m.fin);if(a!==null&&b!==null&&dn>=a&&dn<=b)return m.nom}return ''}
const ncl=t=>String(t||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
function clientDe(nom){const k=ncl(nom);if(!k)return null;const id=Object.keys(S.clients).find(i=>ncl(S.clients[i].nom)===k);return id?Object.assign({id},S.clients[id]):null}
function compute(){
  const c=cfg(),tva=c.tva,etudes=sorted('etudes'),fact=sorted('factures'),temps=sorted('temps');
  const chom=num(c.chomage);
  const patrTot=Object.values(c.patr).reduce((a,v)=>a+num(v),0);
  const cotTot=Object.values(c.cot).reduce((a,v)=>a+num(v),0);
  const baseJEH=4*num(c.smic);
  const cnjeDate=dnum(c.cnje.date);
  fact.forEach(f=>{normFact(f);f.mandat=mandatOf(f.d,c)});
  const pay=fact.filter(f=>f.paid);
  temps.forEach(t=>{t.d=dnum(t.date);t.mandat=mandatOf(t.d,c);t.I=(isNum(t.min)&&num(t.nb)>0)?num(t.min)/480/num(t.nb):null;t.J=t.I===null?null:t.I*num(t.jeh);t.stat=t.statut||'Pas payé'});
  const byEtude={};temps.forEach(t=>{if(t.etude)(byEtude[t.etude]=byEtude[t.etude]||[]).push(t)});
  const personEtude={};temps.forEach(t=>{if(t.prenom&&t.etude&&t.I!==null){const k=t.etude+'\u0001'+t.prenom;personEtude[k]=(personEtude[k]||0)+t.I}});
  const nums={};etudes.forEach(e=>{if(e.num)nums[e.num]=(nums[e.num]||0)+1});
  etudes.forEach(e=>{
    e.d=dnum(e.date);e.mandat=mandatOf(e.d,c);
    e.inv=e.num?fact.filter(f=>f.etude===e.num).sort((a,b)=>(a.de||0)-(b.de||0)):[];
    e.K=e.inv.filter(f=>f.paid).reduce((a,f)=>a+num(f.montant),0);
    e.facture=finStatus(e);
    const ue=e.inv.filter(f=>!f.paid&&f.ech!==null).map(f=>f.ech);e.echeance=ue.length?dstr(Math.min(...ue)):'';
    e.J=(num(e.jeh)&&num(e.montant))?Math.max(0,num(e.montant)/(1+tva)-num(e.frais))/num(e.jeh):null; // les frais (labo…) ne sont pas des JEH
    e.L=L_STAT.includes(e.statut)?num(e.montant)-e.K:null;
    const ls=byEtude[e.num]||[];e.lines=ls;
    if(!e.num||!ls.length)e.N='';
    else if(ls.some(t=>!['Payé','A venir','Non effectué'].includes(t.stat)))e.N='À payer';
    else if(ls.some(t=>t.stat==='A venir'))e.N='À venir';
    else if(ls.some(t=>t.stat==='Payé'))e.N='Payé';
    else e.N='Non effectué';
    e.cnje=!!(cnjeDate!==null&&((e.d!==null&&e.d>=cnjeDate)||(e.statut!=='Archivée'&&e.statut!=='Refusé / sans suite')));
    e.R=ls.length?ls.reduce((a,t)=>a+num(t.I),0):null;
    e.S=ls.length?Math.max(...ls.map(t=>num(t.jeh))):null;
    const cost=ls.reduce((a,t)=>(['A venir','Non effectué'].includes(t.stat)||t.I===null)?a:a+num(t.J)*(1+chom)+t.I*baseJEH*patrTot,0);
    e.P=num(e.montant)?cost/(num(e.montant)/(1+tva)):null;
    const cf=clientDe(e.client);if(cf){if(!e.collab)e.collab=cf.collab;if(!e.cadence)e.cadence=cf.cadence;if(!e.adresse)e.adresse=cf.adresse}
    e.alerts=alertsOf(e,c,ls,nums,personEtude,fact).filter(a=>alertOn(a,c));
  });
  // Fiches clients : une par nom de client (fiche saisie ou déduite des études). Statut par rapport au mandat en cours.
  const mCour=mandatOf(TODAY,c),cles={};
  Object.keys(S.clients).forEach(id=>{const o=S.clients[id];if(o.nom)cles[ncl(o.nom)]=Object.assign({id},o)});
  etudes.forEach(e=>{const k=ncl(e.client);if(k&&!cles[k])cles[k]={id:null,nom:e.client.trim()}});
  const clients=Object.values(cles).map(cl=>{const E=etudes.filter(e=>ncl(e.client)===ncl(cl.nom)),S2=E.filter(e=>SIGNED.includes(e.statut));
    const enM=mCour?E.filter(e=>e.mandat===mCour):[],avant=mCour?E.filter(e=>e.mandat!==mCour&&e.d!==null&&e.d<TODAY):[];
    const der=E.reduce((a,e)=>Math.max(a,e.d||0),0),recent=der&&TODAY-der<=365;
    // Avec un mandat en cours : par rapport au mandat. Sans mandat défini : sur les 12 derniers mois.
    const statut=!E.length?'Sans étude':mCour?(enM.length?(avant.length?'Fidèle':'Nouveau'):'Ancien client'):(recent?(E.length>1?'Fidèle':'Nouveau'):'Ancien client');
    return Object.assign({},cl,{etudes:E,nb:E.length,ca:S2.reduce((a,e)=>a+num(e.montant),0),enc:E.reduce((a,e)=>a+num(e.K),0),reste:E.reduce((a,e)=>a+Math.max(0,num(e.L)),0),alertes:E.reduce((a,e)=>a+e.alerts.length,0),derniere:E.reduce((a,e)=>Math.max(a,e.d||0),0)||null,statut})}).sort((a,b)=>(b.derniere||0)-(a.derniere||0));
  return {c,etudes,fact,pay,temps,tva,chom,patrTot,cotTot,baseJEH,personEtude,clients};
}
const ALERTS=[
['retard',/^Retard de/,'Retard de paiement (+ relances)','Facture émise et échéance dépassée.'],
['arch_reste',/^Archivée mais reste/,'Archivée mais reste à encaisser','Le client doit encore payer.'],
['arch_solde',/^Archivée sans solde/,'Archivée sans solde encaissé','Le solde n’est pas marqué encaissé.'],
['arch_bv',/^Archivée mais BV/,'Archivée mais BV non payés','Un intervenant est encore « À payer ».'],
['enc_sup',/^Encaissé supérieur/,'Encaissé supérieur au montant','Erreur de saisie ou trop-perçu.'],
['acompte',/^Facturer l’acompte/,'Facturer l’acompte','Convention signée ou en réalisation sans facture.'],
['echeance',/^Renseigner l’échéance/,'Renseigner l’échéance','Facture émise sans date d’échéance.'],
['temps',/^Renseigner le temps/,'Renseigner le temps de travail','En réalisation sans ligne de temps.'],
['jeh_manq',/^Prix de la JEH manquant/,'Prix de la JEH manquant','Lignes de temps mais JEH client vide.'],
['rem_sup',/^Rémunérations supérieures/,'Rémunérations > montant HT','Les rémunérations dépassent le montant.'],
['payer_bv',/^Payer les BV/,'Payer les BV','Solde encaissé, intervenants « À payer ».'],
['archiver',/^Tout est soldé/,'Tout est soldé : archiver','Rien à encaisser, BV payés.'],
['refusee',/^Étude refusée/,'Étude refusée mais facturée','Refusée avec facture ou encaissement.'],
['solde_reste',/^Solde encaissé mais/,'Solde encaissé mais reste à encaisser','Montant ou encaissé à corriger.'],
['solde_af',/^Facturer le solde/,'Facturer le solde','Étude archivée, solde pas encore facturé.'],
['periodique',/^Facture périodique/,'Facture périodique à émettre','Étude récurrente : période écoulée sans facture.'],
['date',/^Renseigner la date/,'Renseigner la date de création','Étude rattachée à aucun mandat.'],
['double',/^N° d’étude en double/,'N° d’étude en double','Deux études avec le même numéro.'],
['cnje_cli',/^CNJE : JEH client/,'CNJE : JEH client hors fourchette','JEH client hors min–max.'],
['cnje_int',/^CNJE : JEH intervenant/,'CNJE : JEH intervenant trop élevée','Au-dessus du plafond intervenant.'],
['cnje_fact',/^CNJE : nb de JEH/,'CNJE : JEH facturées non entières','Montant ÷ TVA ÷ JEH non entier.'],
['cnje_rem',/^CNJE : JEH rémunérées/,'CNJE : JEH rémunérées non entières','Par intervenant sur une étude.'],
['cnje_diff',/^CNJE : JEH facturées \(/,'CNJE : facturées ≠ rémunérées','Les deux totaux diffèrent.']];
function alertOn(a,c){if(c.alertesOn===false)return false;const off=c.alertesOff||{};const k=ALERTS.find(x=>x[1].test(a));return !(k&&off[k[0]])}
function alertsOf(e,c,ls,nums,pe,fact){
  const A=[],st=e.statut,fa=e.facture,ech=dnum(e.echeance),tva=c.tva;
  const L=num(e.L),K=num(e.K),I=num(e.montant);
  if(INVOICED.includes(fa)&&ech!==null&&ech<TODAY){const r=TODAY-ech;A.push('Retard de '+r+' j'+(r>c.relance2?' : 2e relance':(r>=c.relance1?' : 1re relance par mail':'')))}
  if(st==='Archivée'&&L>0)A.push('Archivée mais reste à encaisser');
  if(st==='Archivée'&&fa!=='Solde encaissé')A.push('Archivée sans solde encaissé');
  if(st==='Archivée'&&e.N==='À payer')A.push('Archivée mais BV non payés');
  if(I>0&&K>I)A.push('Encaissé supérieur au montant');
  if(fa==='Acompte à facturer')A.push('Facturer l’acompte');
  if(fa==='Solde à facturer')A.push('Facturer le solde');
  if(INVOICED.includes(fa)&&ech===null&&st!=='Archivée'&&st!=='Refusé / sans suite')A.push('Renseigner l’échéance de paiement');
  if(st==='En réalisation'&&!ls.length)A.push('Renseigner le temps de travail (onglet Temps de travail)');
  if(ls.length&&!isNum(e.jeh))A.push('Prix de la JEH manquant : rémunérations calculées à 0 €');
  const sumJ=ls.reduce((a,t)=>a+num(t.J),0);
  if(I>0&&sumJ>I/(1+tva)+1e-9)A.push('Rémunérations supérieures au montant HT');
  if(fa==='Solde encaissé'&&st!=='Archivée'&&e.N==='À payer')A.push('Payer les BV');
  if(fa==='Solde encaissé'&&st!=='Archivée'&&st!=='Refusé / sans suite'&&I>0&&e.N!=='À payer'&&L<=0)A.push('Tout est soldé : archiver l’étude');
  if(st==='Refusé / sans suite'&&e.inv.length)A.push('Étude refusée mais facturée');
  if(fa==='Solde encaissé'&&L>0)A.push('Solde encaissé mais reste à encaisser');
  // Étude récurrente : une facture par période (Manuel trésorerie : « une facture chaque mois pour les études en cours »)
  if(e.collab==='Récurrente'&&e.cadence&&IN_PROGRESS.includes(st)){const mois={Mensuelle:1,Trimestrielle:3,Semestrielle:6,Annuelle:12}[e.cadence];
    const ref=e.inv.length?Math.max(...e.inv.map(f=>f.de||0)):e.d;if(mois&&ref){const r=new Date(ref*864e5);r.setUTCMonth(r.getUTCMonth()+mois);const lim=r.getTime()/864e5;
      if(lim<=TODAY)A.push('Facture périodique à émettre ('+e.cadence.toLowerCase()+', dernière le '+fdate(ref)+')')}}
  if(e.d===null)A.push('Renseigner la date de création');
  if(e.num&&nums[e.num]>1)A.push('N° d’étude en double');
  if(e.cnje){
    if(isNum(e.jeh)&&(num(e.jeh)<c.cnje.min||num(e.jeh)>c.cnje.max))A.push('CNJE : JEH client ('+num(e.jeh)+' €) hors de '+c.cnje.min+'–'+c.cnje.max+' €');
    if(e.S!==null&&e.S>c.cnje.maxInt)A.push('CNJE : JEH intervenant ('+e.S+' €) supérieure à '+c.cnje.maxInt+' €');
    if(num(e.J)>0&&Math.abs(num(e.J)-Math.round(num(e.J)))>0.005)A.push('CNJE : nb de JEH facturées non entier ('+nf3.format(Math.round(num(e.J)*1000)/1000)+')');
    const bad=[];const seen={};
    ls.forEach(t=>{if(t.prenom&&t.I!==null&&!seen[t.prenom]){seen[t.prenom]=1;const s=pe[e.num+'\u0001'+t.prenom];if(Math.abs(s-Math.round(s))>0.005)bad.push(t.prenom)}});
    if(bad.length)A.push('CNJE : JEH rémunérées non entières ('+bad.join(', ')+')');
    if(['Convention étudiant avant réalisation','En réalisation','Archivée'].includes(st)&&(num(e.J)>0||e.R!==null)&&Math.abs(num(e.J)-num(e.R))>0.005)A.push('CNJE : JEH facturées ('+nf3.format(Math.round(num(e.J)*1000)/1000)+') ≠ JEH rémunérées ('+nf3.format(Math.round(num(e.R)*1000)/1000)+')');
  }
  return A;
}
function persons(D){const seen={},out=[];D.temps.forEach(t=>{if(t.prenom&&!seen[t.prenom]){seen[t.prenom]=1;out.push(t.prenom)}});return out}
function costOf(D,pr,filter){ // coût Junior d'une personne (Payé + non payé), comme le classeur
  const L=D.temps.filter(t=>t.prenom===pr&&t.I!==null&&(!filter||filter(t)));
  const paid=L.filter(t=>t.stat==='Payé'),unp=L.filter(t=>!['Payé','A venir','Non effectué'].includes(t.stat));
  const sI=a=>a.reduce((s,t)=>s+t.I,0),sJ=a=>a.reduce((s,t)=>s+num(t.J),0);
  const f=(I,J)=>J*(1+D.chom)+(I<=0?0:Math.max(I,1))*D.baseJEH*D.patrTot;
  // Minimum de 1 JEH PAR BV : les lignes payées sont regroupées par date de BV (lignes passées à « Payé » le même jour).
  const bvs={};paid.forEach(t=>{const k=t.bvDate||'historique';(bvs[k]=bvs[k]||[]).push(t)});
  const paidCost=Object.values(bvs).reduce((a,g)=>a+f(sI(g),sJ(g)),0);
  return {paidI:sI(paid),paidJ:sJ(paid),unpI:sI(unp),unpJ:sJ(unp),nbBV:Object.keys(bvs).length,cost:f(sI(unp),sJ(unp))+paidCost};
}
function remun(D){
  const rows=persons(D).map(pr=>{const x=costOf(D,pr);const brut=x.unpJ,I=Math.round(x.unpI*1e6)/1e6;
    const net=brut-(I<=0?0:Math.max(I,1))*D.baseJEH*D.cotTot;
    const cout=brut+(I<=0?0:Math.max(I,1))*D.baseJEH*D.patrTot+brut*D.chom;
    return {nom:pr,jehPay:Math.round(x.paidI*1e6)/1e6,dejaPaye:x.paidJ,jeh:I,brut,net,cout}});
  const T=rows.reduce((a,r)=>({jehPay:a.jehPay+r.jehPay,dejaPaye:a.dejaPaye+r.dejaPaye,jeh:a.jeh+r.jeh,brut:a.brut+r.brut,net:a.net+r.net,cout:a.cout+r.cout}),{jehPay:0,dejaPaye:0,jeh:0,brut:0,net:0,cout:0});
  return {rows,T};
}
function dash(D,sel){
  const all=sel==='Tous les mandats';const c=D.c;
  const inM=e=>all||e.mandat===sel;
  const E=D.etudes.filter(inM);
  const sumBy=(arr,f,keys)=>arr.filter(e=>keys.includes(e.statut)).reduce((a,e)=>a+num(f(e)),0);
  const tva1=1+D.tva;
  const encTTC=all?D.etudes.reduce((a,e)=>a+e.K,0):D.pay.filter(f=>f.mandat===sel).reduce((a,f)=>a+num(f.montant),0);
  const enc=encTTC/tva1;
  const persN=persons(D);
  const dep=persN.reduce((a,p)=>a+costOf(D,p,t=>all||t.mandat===sel).cost,0);
  const ca=sumBy(E,e=>e.montant,SIGNED)/tva1,reste=sumBy(E,e=>e.L,SIGNED)/tva1;
  const archive=sumBy(E,e=>e.montant,['Archivée'])/tva1;
  const retard=E.reduce((a,e)=>a+e.inv.filter(f=>f.late).reduce((b,f)=>b+num(f.montant),0),0)/tva1; // seules les factures échues et impayées, filtre de mandat respecté
  const jehF=sumBy(E,e=>e.J,SIGNED),jehR=D.temps.filter(t=>all||t.mandat===sel).reduce((a,t)=>a+num(t.I),0);
  const TM=D.temps.filter(t=>all||t.mandat===sel),fait=TM.filter(t=>t.statut==='Payé'||t.statut==='Pas payé');
  const parEt={};fait.forEach(t=>{if(t.prenom)parEt[t.prenom]=(parEt[t.prenom]||0)+num(t.I)});
  const jehParEtud=Object.entries(parEt).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  const mois=[];{const n=new Date();for(let k=5;k>=0;k--){const m=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth()-k,1));mois.push({k:m.toISOString().slice(0,7),l:m.toLocaleDateString('fr-FR',{month:'short',timeZone:'UTC'}).replace('.',''),v:0})}}
  fait.forEach(t=>{if(t.d===null)return;const k=dstr(t.d).slice(0,7),m=mois.find(x=>x.k===k);if(m)m.v+=num(t.I)});
  const jehEtud=fait.reduce((a,t)=>a+num(t.I),0),nbEtud=new Set(fait.filter(t=>num(t.I)>0).map(t=>t.prenom)).size,aClasser=TM.filter(t=>!t.statut).length; // JEH réellement réalisées par les étudiants
  const nbSigned=E.filter(e=>SIGNED.includes(e.statut)).length;
  const cnt=k=>E.filter(e=>e.statut===k).length;
  const groups={'Faisabilité':cnt('Faisabilité'),'Devis envoyé':cnt('Devis envoyé'),'Devis signé':cnt('Devis signé'),'Conv. envoyée':cnt('Convention envoyée'),'Conv. signée':cnt('Convention signée')+cnt('Convention étudiant avant réalisation'),'En réalisation':cnt('En réalisation')};
  const enCours=Object.values(groups).reduce((a,b)=>a+b,0);
  // clients
  const valid=D.etudes.filter(e=>e.client&&e.statut&&e.statut!=='Refusé / sans suite'&&e.d!==null);
  const mand=c.mandats.map(m=>({nom:m.nom,a:dnum(m.debut),b:dnum(m.fin)}));
  const before=(cl,start)=>D.etudes.filter(e=>e.client===cl&&e.d!==null&&e.d<start&&e.statut!=='Refusé / sans suite').length;
  const cm={};valid.forEach(e=>{const k=e.client+'\u0001'+e.mandat;(cm[k]=cm[k]||{client:e.client,mandat:e.mandat,first:e.d,n:0});cm[k].first=Math.min(cm[k].first,e.d)});
  const cmList=Object.values(cm);
  cmList.forEach(x=>{const m=mand.find(m=>m.nom===x.mandat);x.prev=m&&m.a!==null?before(x.client,m.a):0});
  const byClient={};valid.forEach(e=>{(byClient[e.client]=byClient[e.client]||[]).push(e)});
  const cli=Object.keys(byClient).map(cl=>{
    const ds=byClient[cl].map(e=>e.d);const first=Math.min(...ds);
    const nb=cmList.filter(x=>x.client===cl).length;
    const m0=mand.filter(m=>m.a!==null&&m.a<=first).sort((a,b)=>b.a-a.a)[0];
    let fid=null;if(m0&&m0.b!==null){const later=ds.filter(d=>d>m0.b);if(later.length)fid=Math.min(...later)}
    return {cl,first,nb,fid};
  });
  const nouveaux=all?cli.length:cmList.filter(x=>x.mandat===sel&&x.prev===0).length;
  const fideles=all?cli.filter(x=>x.nb>=2).length:cmList.filter(x=>x.mandat===sel&&x.prev>0).length;
  // séries temporelles (50 points)
  let t0,t1;
  if(all){
    const ds=D.pay.map(f=>f.d).filter(d=>d!==null),st=mand.map(m=>m.a).filter(x=>x!==null),en=mand.map(m=>m.b).filter(x=>x!==null);
    const first=[...ds,...st];t0=first.length?Math.min(...first):TODAY;
    t1=en.length?Math.min(TODAY,Math.max(...en)):TODAY;
  }else{
    const m=mand.find(m=>m.nom===sel);
    t0=m&&m.a!==null?m.a:TODAY;
    t1=m&&m.b!==null?Math.min(TODAY,m.b):TODAY;
  }
  if(t1<=t0)t1=t0+1;
  const pts=[];for(let k=0;k<50;k++)pts.push(t0+Math.round(k*(t1-t0)/49));
  const ser={enc:[],dep:[],tot:[],fid:[]};
  pts.forEach(T=>{
    const na=!all&&T>TODAY;
    if(na){ser.enc.push(null);ser.dep.push(null);ser.tot.push(null);ser.fid.push(null);return}
    ser.enc.push(D.pay.filter(f=>f.d!==null&&f.d<=T&&(all||f.mandat===sel)).reduce((a,f)=>a+num(f.montant),0)/tva1);
    ser.dep.push(D.temps.filter(t=>t.d!==null&&t.d<=T&&t.I!==null&&!['A venir','Non effectué'].includes(t.stat)&&(all||t.mandat===sel)).reduce((a,t)=>a+num(t.J)*(1+D.chom)+t.I*D.baseJEH*D.patrTot,0));
    if(all){ser.tot.push(cli.filter(x=>x.first<=T).length);ser.fid.push(cli.filter(x=>x.fid!==null&&x.fid<=T).length)}
    else{ser.tot.push(cmList.filter(x=>x.mandat===sel&&x.first<=T).length);ser.fid.push(cmList.filter(x=>x.mandat===sel&&x.prev>0&&x.first<=T).length)}
  });
  const withAlert=D.etudes.filter(e=>e.alerts.length);
  return {all,jehEtud,nbEtud,aClasser,jehParEtud,jehMois:mois,total:E.length,enc,dep,recette:enc-dep,ca,reste,archive,retard,jehF,jehR,nbSigned,groups,enCours,archivees:cnt('Archivée'),refusees:cnt('Refusé / sans suite'),nouveaux,fideles,pts,t0,t1,ser,withAlert,nbAlerts:withAlert.reduce((a,e)=>a+e.alerts.length,0)};
}

/* ---------- graphiques SVG ---------- */
const PAL=['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];
function donut(parts,center,sub){
  const tot=parts.reduce((a,p)=>a+p.v,0),R=62,C=2*Math.PI*R;let off=0,segs='';
  if(tot>0)parts.forEach(p=>{if(p.v<=0)return;const len=C*p.v/tot;segs+=`<circle cx="90" cy="90" r="${R}" fill="none" stroke="${p.c}" stroke-width="30" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`;off+=len});
  else segs=`<circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--line)" stroke-width="30"/>`;
  return `<svg viewBox="0 0 180 180" role="img" aria-label="${esc(sub)}">${segs}<text class="ctr" x="90" y="92" text-anchor="middle" dominant-baseline="middle" style="font-size:36px">${center}</text></svg>`;
}
function legendHtml(parts){return '<div class="legend">'+parts.map(p=>`<span><i style="background:${p.c}"></i>${esc(p.l)} · ${p.v}</span>`).join('')+'</div>'}
function smooth(a){const f=(x,i)=>x[i]===null?null:((x[i-1]==null?x[i]:x[i-1])+2*x[i]+(x[i+1]==null?x[i]:x[i+1]))/4;const o=a.map((_,i)=>f(a,i));return o}
let GRAD=0;
function lineChart(pts,series,fmt,int){
  const W=560,H=230,pl=44,pr=10,pt=12,pb=26;
  const sm=series.map(s=>({c:s.c,l:s.l,a:smooth(smooth(s.v)),area:s.area}));
  let mx=0;sm.forEach(s=>s.a.forEach(v=>{if(v!==null&&v>mx)mx=v}));if(mx<=0)mx=1;
  const nice=int?Math.max(4,Math.ceil(mx/4)*4):(()=>{const p=Math.pow(10,Math.floor(Math.log10(mx)));const m=mx/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p})();
  const X=i=>pl+(W-pl-pr)*i/(pts.length-1),Y=v=>pt+(H-pt-pb)*(1-v/nice);
  let g='';for(let k=0;k<=4;k++){const v=nice*k/4,y=Y(v);g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl-6}" y="${y+3}" text-anchor="end">${fmt(v)}</text>`}
  let lastLab=-99;pts.forEach((T,i)=>{const d=new Date(T*864e5),prev=i?new Date(pts[i-1]*864e5):null;if((!prev||prev.getUTCMonth()!==d.getUTCMonth())&&i-lastLab>=7&&i<=pts.length-4){lastLab=i;g+=`<text x="${X(i)}" y="${H-8}" text-anchor="middle">${MOIS[d.getUTCMonth()]}${d.getUTCMonth()===0||i===0?' '+String(d.getUTCFullYear()).slice(2):''}</text>`}});
  let defs='',fills='',lines='';
  sm.forEach((s,k)=>{let d='',started=false,lastI=0;s.a.forEach((v,i)=>{if(v===null)return;d+=(started?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);started=true;lastI=i});
    if(!d)return;
    const id='gr'+(++GRAD),fc=s.c==='var(--c3)'?'var(--c5)':s.c;
    defs+=`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${fc};stop-opacity:.6"/><stop offset="1" style="stop-color:${fc};stop-opacity:.14"/></linearGradient>`;
    fills+=`<path d="${d}L${X(lastI)} ${Y(0)}L${X(s.a.findIndex(v=>v!==null))} ${Y(0)}Z" fill="url(#${id})"/>`;
    lines+=`<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`});
  g+=fills+lines;
  return `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" role="img"><defs>${defs}</defs>${g}</svg></div><div class="legend">${sm.map(s=>`<span><i style="background:${s.c}"></i>${esc(s.l)}</span>`).join('')}</div>`;
}

/* ---------- champs de saisie ---------- */
const attr=(c,id,f)=>`data-c="${c}" data-id="${id}" data-f="${f}"`;
const inT=(c,r,f,ph)=>`<input ${attr(c,r.id,f)} value="${esc(r[f])}" placeholder="${esc(ph||'')}">`;
const inN=(c,r,f)=>`<input type="number" step="any" inputmode="decimal" ${attr(c,r.id,f)} value="${r[f]===null||r[f]===undefined?'':esc(r[f])}">`;
const inD=(c,r,f)=>`<input type="date" ${attr(c,r.id,f)} value="${esc(r[f])}">`;
const sel=(c,r,f,opts,blank)=>{const v=r[f]||'';const o=opts.slice();if(v&&!o.includes(v))o.push(v);return `<select ${attr(c,r.id,f)}>${blank!==false?'<option value=""></option>':''}${o.map(x=>`<option${x===v?' selected':''}>${esc(x)}</option>`).join('')}</select>`};
const delBtn=(c,id)=>`<button class="x" data-del="${c}:${id}" title="Supprimer la ligne" aria-label="Supprimer la ligne">✕</button>`;

/* ---------- vues ---------- */
// Rôle Salarié : uniquement « Moi » (ses JEH, sa paie, sa formation) et Réglages ; données déjà filtrées par le serveur.
const SALARIE=lsGet('suivi.role')==='salarie'&&!!lsGet('suivi.token')&&!!lsGet('suivi.url');
const TABS=SALARIE?[['moi','Moi'],['params','Paramètres']]:[['dash','Tableau de bord'],['etudes','Suivi des études'],['finances','Finances'],['formation','Qualité formation'],['params','Paramètres']];
if(SALARIE&&!['moi','params'].includes(tab))tab='moi';
const ICO={
 trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
 sign:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/>',
 hour:'<path d="M6 3h12M6 21h12"/><path d="M7 3v3a5 5 0 0 0 2 4l3 2-3 2a5 5 0 0 0-2 4v3M17 3v3a5 5 0 0 1-2 4l-3 2 3 2a5 5 0 0 1 2 4v3"/>',
 pie:'<path d="M12 3v9h9"/><path d="M20.5 15A9 9 0 1 1 9 3.5"/>',
 list:'<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
 alert:'<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
 bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 chart:'<path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/>',
 euro:'<circle cx="12" cy="12" r="9"/><path d="M15 9.2a3.6 3.6 0 1 0 0 5.6M8 11h5.5M8 13h5.5"/>',
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2 .8 3.5 2.6 3.5 5.7"/>',
 ok:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
 warn:'<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'};
const ic=(k,sz)=>`<svg class="ico" viewBox="0 0 24 24" width="${sz||16}" height="${sz||16}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
const TAB_SHORT={moi:'Moi',dash:'Tableau',etudes:'Études',finances:'Finances',factures:'Factures',temps:'JEH',remun:'Paie',formation:'Formation',params:'Réglages',legende:'Légende'};
const TAB_ICON={
 moi:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
 dash:'<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
 etudes:'<path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7.5 15h9"/>',
 factures:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
 temps:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 remun:'<circle cx="12" cy="12" r="9"/><path d="M15 9.2a3.6 3.6 0 1 0 0 5.6M8 11h5.5M8 13h5.5"/>',
 finances:'<circle cx="12" cy="12" r="9"/><path d="M15 9.2a3.6 3.6 0 1 0 0 5.6M8 11h5.5M8 13h5.5"/>',
 formation:'<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5"/>',
 params:'<path d="M3 6h9M16 6h5M3 12h3M10 12h11M3 18h11M18 18h3"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
 legende:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'};
function renderNav(){$('#nav').innerHTML=TABS.map(([k,l])=>`<button data-tab="${k}" aria-current="${k===tab}" aria-label="${l}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[k]}</svg><span>${TAB_SHORT[k]}</span></button>`).join('')}
let conflitMsg='';
function renderStatus(){
  let h='';
  if(conflitMsg)h+='<div class="msg err">'+esc(conflitMsg)+'</div>';
  if(timeoutNote)h+='<div class="msg">Les données sont encore en cours de chargement : si ce message reste, vérifiez la connexion.</div>';
  if(dbErr)h+='<div class="msg err">'+esc(dbErr)+'</div>';
  if(db&&!canWrite&&!SALARIE)h+='<div class="msg">Lecture seule : vous ne pouvez pas modifier ces données.</div>';
  $('#status').innerHTML=h;
}
async function doSync(){
  const u=($('#syu').value||'').trim(),tok=(($('#syt')||{}).value||'').trim(),m=$('#sym');
  const say=(t,bad)=>{m.textContent=t;m.className='msg'+(bad?' err':'');m.hidden=false};
  if(!/^https:\/\/script\.google\.com\//.test(u))return say('L’adresse doit commencer par https://script.google.com/…',1);
  if(!tok)return say('Saisissez votre code d’accès personnel (donné par la trésorerie).',1);
  say('Connexion…');
  try{
    const post=b=>fetch(u,{method:'POST',body:JSON.stringify(Object.assign({token:tok},b)),redirect:'follow'}).then(r=>r.json());
    const pg=await post({action:'ping'});
    if(pg&&pg.error==='auth')return say('Code d’accès refusé : vérifiez-le auprès de la trésorerie.',1);
    if(pg&&pg.error)return say('Ce script n’est pas à jour : installez la version sécurisée du Code.gs (serveur/Code.gs).',1);
    lsSet('suivi.token',tok);if(pg&&pg.membre)lsSet('suivi.membre',pg.membre);lsSet('suivi.admin',pg&&pg.admin?'1':'');lsSet('suivi.role',pg&&pg.role||'membre');if(pg&&pg.role==='salarie')lsSet('suivi.tab','moi');
    const srv=await post({action:'loadAll'});
    if(srv&&srv.error)return say('Erreur du script : '+srv.error,1);
    const has=Object.values(srv||{}).some(o=>o&&Object.keys(o).length);
    if(!has){
      let loc={};try{loc=JSON.parse(lsGet('suivi.cache')||'{}')||{}}catch(e){}
      for(const col of Object.keys(loc))for(const id of Object.keys(loc[col]||{})){const r=await post({action:'save',col,id,json:JSON.stringify(loc[col][id]),expected:0,op:newId('o')});if(r&&r.error)return say('Erreur du script : '+r.error,1)}
    }else{lsSet('suivi.cache',JSON.stringify(srv))}
    lsSet('suivi.url',u);location.reload();
  }catch(e){say('Connexion impossible : vérifiez l’adresse et le réseau.',1)}
}
let codeDemande=false;function demanderCode(){if(codeDemande)return;codeDemande=true;try{openSheet('code')}catch(e){}}
function addBtn(label,act){return `<div class="plus"><button class="b" data-add="${act}">+ ${label}</button></div>`}
let HSEL='';
function render(){
  renderNav();renderStatus();
  const v=$('#view');
  document.body.classList.remove('login');
  const ready=Object.values(loaded).every(Boolean);
  if(!ready){v.innerHTML='<div class="card">Chargement des données…</div>';return}
  const active=document.activeElement,fk=active&&active.dataset&&active.dataset.c?active.dataset.c+'|'+active.dataset.id+'|'+active.dataset.f:null,scrollY=window.scrollY;
  const D=compute();
  const views={moi:vMoi,dash:vDash,etudes:vEtudes,finances:vFinances,factures:vFactures,temps:vTemps,remun:vRemun,formation:vFormation,params:vParams};
  const scrolls=[...document.querySelectorAll('.tw')].map(e=>e.scrollLeft);
  v.innerHTML=views[tab](D);
  const hs=$('#hsel');if(hs)hs.innerHTML=tab==='finances'?HSEL:tab==='dash'?HSEL+'<button class="pen" type="button" data-dashed="1" aria-label="Modifier le tableau de bord"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>':'';
  
  document.querySelectorAll('.tw').forEach((e,i)=>{if(scrolls[i])e.scrollLeft=scrolls[i]});
  if(fk){const [c,id,f]=fk.split('|');const el=v.querySelector(`[data-c="${c}"][data-id="${id}"][data-f="${f}"]`);if(el){el.focus({preventScroll:true});try{if(el.setSelectionRange&&el.type!=='number'&&el.type!=='date')el.setSelectionRange(el.value.length,el.value.length)}catch(e){}}}
  window.scrollTo(0,scrollY);
}
const DASH_BLOCKS=[['banner','Bandeau des alertes'],['kpis','Recette, CA signé, à encaisser'],['jeh','JEH réalisées par les étudiants'],['alert','Alertes à traiter'],['vue','Où en sont les études ?'],['det','Détail des études en cours'],['enc','Encaissé et dépenses'],['cli','Clients totaux et fidèles']];
// disposition propre à chaque appareil (non synchronisée)
function dashLocal(){try{return JSON.parse(lsGet('suivi.dash')||'{}')||{}}catch(e){return {}}}
function dashSave(x){lsSet('suivi.dash',JSON.stringify(x))}
function dashLayout(){const c=dashLocal();const all=DASH_BLOCKS.map(x=>x[0]);const o=(c.order||[]).filter(k=>all.includes(k));all.forEach(k=>{if(!o.includes(k))o.push(k)});return {order:o,hide:c.hide||{}}}
function dashSec(){const L=dashLayout(),lab=Object.fromEntries(DASH_BLOCKS);
  return {k:'dash',t:'Tableau de bord',b:()=>`<div class="small" style="margin-bottom:8px">Glissez ⠿ pour changer l’ordre, l’interrupteur pour afficher ou masquer. Réglage propre à cet appareil.</div><div class="led">${L.order.map(k=>`<div class="li dli"><span class="hdl" data-k="dash" aria-label="Déplacer"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></span><label class="tg"><span><b>${esc(lab[k])}</b></span><input type="checkbox" data-dshow="${k}" ${L.hide[k]?'':'checked'}><i></i></label></div>`).join('')}</div>`}}
function vDash(D){
  const c=D.c;const M=['Tous les mandats'].concat(c.mandats.map(m=>m.nom));if(!M.includes(mandatSel))mandatSel='Tous les mandats';
  const d=dash(D,mandatSel);
  HSEL=`<select id="msel" aria-label="Mandat">${M.map(m=>`<option${m===mandatSel?' selected':''}>${esc(m)}</option>`).join('')}</select>`;
  const n=d.withAlert.length;
  const banner=n===0?`<div class="banner ok">${ic('ok',16)}<span>Tout est à jour : aucune alerte à traiter</span></div>`:`<div class="banner">${ic('warn',16)}<span>${n} étude(s) à traiter · ${d.nbAlerts} alerte(s)</span></div>`;
  const kpi=(l,v,note,k)=>`<div class="kpi"><div class="lab">${ic(k,15)}<span>${l}</span></div><div class="val">${v}</div>${note?`<div class="note">${note}</div>`:''}</div>`;
  const vue=[{l:'En cours',v:d.enCours,c:'var(--acc)'},{l:'Archivées',v:d.archivees,c:'var(--arch)'},{l:'Refusées',v:d.refusees,c:PAL[2]}];
  const det=Object.keys(d.groups).map((k,i)=>({l:k,v:d.groups[k],c:'var(--s'+(i+1)+')'}));
  const al=d.withAlert.slice(0,6);
  const R=remun(D);
  const alHtml=al.length?`<ul class="al">${al.map(e=>`<li><b>${esc(e.num||'(sans n°)')}</b> · ${esc(e.alerts.join(' · '))}</li>`).join('')}</ul>`:'<div class="small">Rien à signaler.</div>';
  const mf=v=>nf0.format(v);
  const jmx=Math.max(d.jehF,d.jehR),jgap=d.jehR-d.jehF;
  const pe=d.ca>0?Math.min(100,Math.round(d.enc/d.ca*100)):0;
  const B={banner:banner,kpis:`<div class="card kpis">
    ${kpi('RECETTE',eur0(d.recette),d.all?'encaissé − dépenses':'','trend')}
    ${kpi('CA SIGNÉ HT',eur0(d.ca),d.all?'dont archivé : '+nf0.format(Math.round(d.archive))+' €':'','sign')}
    ${kpi('À ENCAISSER HT',eur0(d.reste),d.all?'dont retard '+nf0.format(Math.round(d.retard))+' €':'','hour')}
    <div class="sve"><div class="svh"><span><b>${eur0(d.enc)}</b> encaissés sur <b>${eur0(d.ca)}</b> signés</span><b class="pct">${d.ca>0?Math.round(d.enc/d.ca*100):0} %</b></div><div class="svt"><i style="width:${pe}%"></i></div></div>
  </div>`,
   vue:`<div class="card"><h3>${ic('pie')}Où en sont les études ?</h3><div class="hint">Vue d’ensemble</div><div class="donutbox">${donut(vue,d.total,'Études au total')}</div>${legendHtml(vue)}</div>`,
   det:`<div class="card"><h3>${ic('list')}Détail des études en cours</h3><div class="hint">Nombre d’études par statut</div><div class="donutbox">${donut(det,d.enCours,'Détail des études en cours')}</div>${legendHtml(det)}</div>`,
   alert:n?`<div class="card alc"><h3>${ic('bell')}Alertes à traiter<span class="cnt">${d.nbAlerts}</span></h3>${al.map(e=>`<button class="ali" data-open="${e.id}"><span class="aln"><b>${esc(e.num||'(sans n°)')}</b><small>${esc(e.client||'')}</small></span><span class="alx">${e.alerts.map(a=>`<span>${ic('warn',13)}${esc(a)}</span>`).join('')}</span><span class="chev">›</span></button>`).join('')}${n>6?`<button class="b ghost addl" data-goalerts="1">Voir les ${n} études</button>`:''}</div>`:`<div class="card alc ok"><h3>${ic('ok')}Alertes à traiter</h3><div class="small">Rien à signaler.</div></div>`,
   jeh:(()=>{const mx=Math.max(...d.jehMois.map(m=>m.v),0.0001),cur=d.jehMois[5].v;
     return `<div class="card jehk2"><div class="jk-h"><span class="jk-ic">${ic('users',16)}</span><div><b>JEH réalisées</b><small>${d.all?'Tout l’historique':esc(mandatSel)} · par les étudiants</small></div></div>
      <div class="jk-b"><div class="jk-n"><div class="jehbig">${nf1.format(Math.round(d.jehEtud*10)/10)}</div><div class="jk-s">JEH · ${d.nbEtud} étudiant${d.nbEtud>1?'s':''}</div>${cur>0?`<div class="jk-m">+${nf1.format(Math.round(cur*10)/10)} ce mois-ci</div>`:''}</div>
      <div class="jk-g">${d.jehMois.map((m,i)=>`<div class="jk-c${i===5?' cur':''}"><span class="jk-v">${m.v?nf1.format(Math.round(m.v*10)/10):''}</span><span class="jk-bar"><i style="height:${Math.max(4,Math.round(m.v/mx*100))}%"></i></span><small>${esc(m.l)}</small></div>`).join('')}</div></div></div>`})(),
   enc:`<div class="card"><h3>${ic('trend')}Encaissé et dépenses</h3><div class="hint">${d.all?'Cumul HT · tout l’historique':'Cumul HT · '+esc(mandatSel)} · du ${fdate(d.t0)} au ${fdate(d.t1)}</div>${lineChart(d.pts,[{c:'var(--c1)',l:'Encaissé HT',v:d.ser.enc,area:true},{c:'var(--c3)',l:'Dépenses',v:d.ser.dep}],v=>mf(v)+' €')}<div class="tiles"><div class="tile"><div class="tr"><span class="ti"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-4v4"/><path d="M17 13.5h.01"/></svg></span><b class="tm">${eur0(d.enc)}</b></div><small>Encaissé HT</small></div><div class="tile"><div class="tr"><span class="ti"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M17 9v8M14.5 14.5 17 17l2.5-2.5"/></svg></span><b class="tm">${eur0(d.dep)}</b></div><small>Dépenses${d.enc?' · '+Math.round(d.dep/d.enc*100)+' % du CA':''}</small></div></div></div>`,
   cli:`<div class="card"><h3>${ic('users')}Clients totaux et fidèles</h3><div class="hint">Cumul · en rose = les clients fidèles · du ${fdate(d.t0)} au ${fdate(d.t1)}</div>${lineChart(d.pts,[{c:'var(--c3)',l:'Clients totaux',v:d.ser.tot,area:true},{c:'var(--c1)',l:'Clients fidèles',v:d.ser.fid}],v=>String(Math.round(v)),true)}<div class="tiles"><div class="tile"><div class="tr"><span class="ti"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/></svg></span><b>${d.nouveaux}</b></div><small>Nouveaux clients</small></div><div class="tile"><div class="tr"><span class="ti"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg></span><b>${d.fideles}</b></div><small>Clients fidèles</small></div></div></div>`};
  const L=dashLayout();
  return `<div class="dgrid">${L.order.filter(k=>!L.hide[k]).map(k=>k==='banner'||k==='kpis'?`<div class="full">${B[k]}</div>`:B[k]).join('')}</div>`;
}
/* ---------- listes en cartes ---------- */
const FLT={etudes:{q:'',s:'all'},factures:{q:'',s:'all'},temps:{q:'',s:'all'}};
const ST_N={'Faisabilité':1,'Devis envoyé':2,'Devis signé':3,'Convention envoyée':4,'Convention signée':5,'Convention étudiant avant réalisation':5,'En réalisation':6};
const stCls=s=>s==='Archivée'?'arch':s==='Refusé / sans suite'?'ref':ST_N[s]?'s'+ST_N[s]:'dev';
const bvCls=s=>s==='Pas payé'?'on':s==='Payé'?'arch':s==='A venir'?'dev':'ref';
const pill=(t,c)=>t?`<span class="pill ${c||''}">${esc(t)}</span>`:'';
const sd=d=>{if(d===null||d===undefined)return '—';const x=new Date(d*864e5);return x.getUTCDate()+' '+MOIS[x.getUTCMonth()]+' '+x.getUTCFullYear()};
const dayBox=d=>{if(d===null||d===undefined)return '<div class="dbox"><b>–</b><span>&nbsp;</span></div>';const x=new Date(d*864e5);return `<div class="dbox"><b>${x.getUTCDate()}</b><span>${MOIS[x.getUTCMonth()]}</span></div>`};
const hm=m=>{m=Math.round(num(m));if(!m)return '—';const h=Math.floor(m/60),r=m%60;return h?(h+' h'+(r?' '+String(r).padStart(2,'0'):'')):(r+' min')};
const searchBox=k=>`<input id="q" data-q="${k}" class="srch" type="search" placeholder="Rechercher…" value="${esc(FLT[k].q)}" autocomplete="off">`;
const chipsRow=(k,list)=>`<div class="chips">${list.map(([v,l])=>`<button class="chip" data-chip="${k}:${v}" aria-pressed="${FLT[k].s===v}">${l}</button>`).join('')}</div>`;
const fab=(a,l)=>`<button class="fab" data-add="${a}" aria-label="${l}">+</button>`;
const emptyMsg=t=>`<div class="card small" style="text-align:center;padding:22px">${t}</div>`;
function etudeOK(e,f){
  const open=e.statut&&!['Archivée','Refusé / sans suite'].includes(e.statut);
  if(f.s==='cours'&&!open)return false;if(f.s==='arch'&&e.statut!=='Archivée')return false;
  if(f.s==='ref'&&e.statut!=='Refusé / sans suite')return false;if(f.s==='alert'&&!e.alerts.length)return false;
  const q=f.q.trim().toLowerCase();return !q||[e.client,e.num,e.resume,e.statut,e.mandat].join(' ').toLowerCase().includes(q);
}
// Initiales d'un intervenant : les noms sont saisis « Prénom.N » → « P.N » (sinon initiales des mots, ex. « Jean Luc » → « J.L »).
function iniP(nom){const t=String(nom||'').trim();if(!t)return '?';const i=t.indexOf('.');
  if(i>0&&i<t.length-1)return (t[0]+'.'+t[i+1]).toUpperCase();const w=t.split(/[\s-]+/).filter(Boolean);return (w.length>1?w[0][0]+'.'+w[1][0]:w[0][0]).toUpperCase()}
function cardEtude(e){
  const m=num(e.montant),pct=m>0?Math.min(100,Math.round(e.K/m*100)):0,n=e.alerts.length,cls=stCls(e.statut);
  const ech=e.echeance?dnum(e.echeance):null,late=ech!==null&&ech<TODAY;
  const pers=[...new Set(e.lines.map(t=>t.prenom).filter(Boolean))];
  const ini=p=>esc(iniP(p));
  const jf=num(e.J),jr=num(e.R),jeh=(jf>0||jr>0)?`<span title="JEH réalisées sur JEH facturées">${ic('clock',13)}${nf1.format(Math.round(jr*10)/10)} JEH réalisées sur ${nf1.format(Math.round(jf*10)/10)}</span>`:'';
  return `<button class="card ecard ec2" data-open="${e.id}" data-st="${cls}">
  <div class="eh"><div class="et"><b>${esc(e.client)||'Sans client'}</b><span>N° ${esc(e.num)||'à saisir'}${e.resume?' · '+esc(e.resume):''}</span></div>${pill(e.statut||'Sans statut',cls)}</div>
  ${m>0?`<div class="eprog"><div class="eph"><span><b>${eur0(e.K)}</b> encaissés sur ${eur0(m)} TTC</span><b>${pct} %</b></div><div class="svt"><i style="width:${pct}%"></i></div></div>`:'<div class="small" style="margin-top:10px">Montant non renseigné</div>'}
  <div class="etags">${e.facture?`<span class="etag">${esc(e.facture)}</span>`:''}${ech!==null?`<span class="etag${late?' late':''}">${late?'En retard · ':'Échéance '}${fdate(ech)}</span>`:''}${e.N==='À payer'?'<span class="etag bv">BV à payer</span>':''}${e.collab==='Récurrente'?`<span class="etag">Récurrente${e.cadence?' · '+esc(e.cadence.toLowerCase()):''}</span>`:''}</div>
  <div class="emeta"><span class="ef3">${pers.length?`<span class="avs">${pers.slice(0,4).map(p=>`<i title="${esc(p)}">${ini(p)}</i>`).join('')}${pers.length>4?`<i>+${pers.length-4}</i>`:''}</span>`:''}${jeh}<span>${sd(e.d)}${e.mandat?' · '+esc(e.mandat):''}</span></span></div>
  ${n?`<div class="eal">${ic('warn',13)} ${esc(e.alerts[0])}${n>1?` <b>+${n-1}</b>`:''}</div>`:''}
  </button>`;
}
function listEtudes(D){
  const L=D.etudes.filter(e=>etudeOK(e,FLT.etudes)).sort((a,b)=>(b.d||0)-(a.d||0));
  const tot=L.reduce((a,e)=>a+num(e.montant),0),enc=L.reduce((a,e)=>a+num(e.K),0);
  return `<div class="sum"><b>${L.length}</b> étude${L.length>1?'s':''}${tot?' · '+eur0(enc)+' encaissés sur '+eur0(tot)+' TTC':''}</div>`+(L.map(cardEtude).join('')||emptyMsg('Aucune étude ici.'));
}
let OPEN=null;
function openRep(id){OPEN=id;tab='etudes';lsSet('suivi.tab',tab);try{history.pushState({rep:id},'')}catch(x){}render();window.scrollTo(0,0)}
function closeRep(){if(history.state&&history.state.rep)history.back();else{OPEN=null;render()}}
window.addEventListener('popstate',()=>{if(OPEN){OPEN=null;render();window.scrollTo(0,0)}});
function vReport(e,D){
  const m=num(e.montant),ht=m/(1+D.tva),n=e.alerts.length;
  const ft=(l,v,cls)=>`<div class="ft ${cls||''}"><small>${l}</small><b>${v}</b></div>`;
  const ne=e.echeance?dnum(e.echeance):null;
  const per={};e.lines.forEach(t=>{const p=t.prenom||'?';const x=per[p]||(per[p]={I:0,J:0,topay:false,n:0});x.I+=num(t.I);x.J+=num(t.J);x.n++;if(!['Payé','A venir','Non effectué'].includes(t.stat))x.topay=true});
  const jr=e.R||0,jf=num(e.J),jmx=Math.max(jr,jf);
  const key=nm=>'f_'+nm.toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const lv=Object.keys(per).map(p=>{const d=S.formation[key(p)];const v=d&&d.niveaux&&isNum(d.niveaux[e.num])?num(d.niveaux[e.num]):null;return [p,v]}).filter(x=>x[1]!==null);
  return `<button class="back" data-closerep="1">‹ Études</button>
  <div class="card hero"><div class="eh"><div class="et"><b>${esc(e.client)||'Sans client'}</b><span>${esc(e.num)||'N° à saisir'}${e.mandat?' · '+esc(e.mandat):''}</span></div><button class="pen" data-edit="etudes:${e.id}" aria-label="Modifier l’étude"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button></div>
   ${e.resume?`<div class="er">${esc(e.resume)}</div>`:''}
   <div class="pills">${pill(e.statut||'Sans statut',stCls(e.statut))}${e.facture?pill(e.facture,'fin'):''}${e.collab==='Récurrente'?pill('Récurrente'+(e.cadence?' · '+e.cadence.toLowerCase():''),'fin'):''}</div>
   <div class="small" style="margin-top:6px">Créée le ${sd(e.d)}</div></div>
  ${n?`<div class="card alc"><h3>${ic('bell')}À traiter<span class="cnt">${n}</span></h3><ul class="al wr">${e.alerts.map(a=>`<li>${ic('warn',13)} ${esc(a)}</li>`).join('')}</ul></div>`:''}
  <div class="card"><h3>${ic('euro')}Finances</h3><div class="ftg">${ft('Montant TTC',m?eur0(m):'—')}${ft('Encaissé TTC',eur0(e.K),'acc')}${ft('Reste à encaisser',e.L===null?'—':eur0(e.L))}${ft('Prochaine échéance',ne!==null?fdate(ne):'—',ne!==null&&ne<TODAY?'late':'')}</div>
   <div class="ef3" style="margin-top:10px"><span>${m?eur0(ht)+' HT':''}</span><span>JEH client ${isNum(e.jeh)?eur0(e.jeh):'—'}</span>${e.P!==null?`<span>Dépenses ${Math.round(e.P*100)} % du HT</span>`:''}</div></div>
  <div class="card"><h3>${ic('sign')}Factures<span class="cnt soft">${e.inv.length}</span></h3>${e.inv.map(f=>factCard(f,false)).join('')||'<div class="small" style="margin:6px 0">Aucune facture.</div>'}<button class="b ghost addl" data-add="factures" data-et="${esc(e.num)}" ${e.num?'':'disabled'}>+ Ajouter une facture</button></div>
  <div class="card"><h3>${ic('clock')}JEH</h3>
   <div class="hb hf"><div class="hbl"><span>Facturées</span><b>${nf3.format(Math.round(jf*1000)/1000)}</b></div><div class="hbt"><i style="width:${jmx?Math.round(jf/jmx*100):0}%"></i></div></div>
   <div class="hb"><div class="hbl"><span>Rémunérées</span><b>${nf3.format(Math.round(jr*1000)/1000)}</b></div><div class="hbt alt"><i style="width:${jmx?Math.round(jr/jmx*100):0}%"></i></div></div>
   ${Object.keys(per).map(p=>`<div class="stat"><span>${esc(p)} · ${nf3.format(Math.round(per[p].I*1000)/1000)} JEH</span><span>${eur(per[p].J)} ${pill(per[p].topay?'À payer':'Payé',per[p].topay?'on':'arch')}</span></div>`).join('')}
   ${e.lines.length?`<details class="how"><summary>Voir les ${e.lines.length} lignes de temps</summary>${e.lines.slice().sort((a,b)=>(b.d||0)-(a.d||0)).map(t=>`<button class="card lcard" data-edit="temps:${t.id}">${dayBox(t.d)}<div class="lm"><b>${esc(t.prenom)||'Prénom à saisir'}</b><span class="small">${hm(t.min)}${t.note?' · '+esc(t.note):''}</span></div><div class="rt"><span class="amt">${t.J===null?'—':eur(t.J)}</span>${pill(t.stat,bvCls(t.stat))}</div></button>`).join('')}</details>`:''}
   <button class="b ghost addl" data-add="temps" data-et="${esc(e.num)}" ${e.num?'':'disabled'}>+ Ajouter du temps</button></div>
  ${lv.length?`<div class="card"><h3>${ic('users')}Formation sur cette étude</h3><div class="pills">${lv.map(([p,v])=>`<span class="lvp lv${v}">${esc(p)} · ${v}</span>`).join('')}</div></div>`:''}`;
}
let ESEG=lsGet('suivi.eseg')==='clients'?'clients':'etudes',OPENC=null;
function vEtudes(D){
  if(OPEN){const e=D.etudes.find(x=>x.id===OPEN);if(e)return vReport(e,D);OPEN=null}
  if(OPENC!==null){const cl=D.clients.find(x=>ncl(x.nom)===OPENC);if(cl)return vClient(cl,D);OPENC=null}
  const seg=`<div class="seg finseg" role="group" aria-label="Études ou clients"><button data-eseg="etudes" aria-pressed="${ESEG==='etudes'}">Études</button><button data-eseg="clients" aria-pressed="${ESEG==='clients'}">Clients · ${D.clients.length}</button></div>`;
  if(ESEG==='clients')return `<h2>Clients</h2>${seg}${D.clients.map(cardClient).join('')||emptyMsg('Aucun client pour le moment.')}${fab('clients','Ajouter un client')}`;
  const n=D.etudes.filter(e=>e.alerts.length).length;
  return `<h2>Suivi des études</h2>${seg}${searchBox('etudes')}${chipsRow('etudes',[['all','Toutes'],['cours','En cours'],['arch','Archivées'],['ref','Refusées'],['alert','Alertes'+(n?' · '+n:'')]])}<div id="lst">${listEtudes(D)}</div>${fab('etudes','Ajouter une étude')}`;
}
const CL_ST={'Nouveau':'s2','Fidèle':'s5','Ancien client':'arch','Sans étude':'dev'};
function cardClient(cl){
  const ini=esc(cl.nom.split(/[\s-]+/).map(x=>x[0]||'').join('').slice(0,2).toUpperCase());
  return `<button class="card ecard cc" data-openc="${esc(ncl(cl.nom))}"><div class="eh"><div class="cch"><span class="cav">${ini}</span><div class="et"><b>${esc(cl.nom)}</b><span>${cl.nb} étude${cl.nb>1?'s':''}${cl.derniere?' · dernière le '+fdate(cl.derniere):''}</span></div></div>${pill(cl.statut,CL_ST[cl.statut])}</div>
  <div class="etags">${cl.collab==='Récurrente'?`<span class="etag">Récurrente${cl.cadence?' · '+esc(cl.cadence.toLowerCase()):''}</span>`:''}${cl.contact?`<span class="etag">${esc(cl.contact)}</span>`:''}${cl.id?'':'<span class="etag">Fiche à compléter</span>'}</div>
  <div class="ftg cft">${[['CA signé TTC',eur0(cl.ca)],['Encaissé TTC',eur0(cl.enc)],['Reste dû',eur0(cl.reste)]].map(([l,v],i)=>`<div class="ft${i===2&&cl.reste>0?' acc':''}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
  ${cl.alertes?`<div class="eal">${ic('warn',13)} ${cl.alertes} alerte${cl.alertes>1?'s':''} sur ses études</div>`:''}</button>`;
}
function vClient(cl,D){
  const lig=(k,v)=>v?`<div class="stat"><span>${k}</span><span>${esc(v)}</span></div>`:'';
  return `<button class="back" data-closec="1">‹ Clients</button>
  <div class="card hero"><div class="eh"><div class="et"><b>${esc(cl.nom)}</b><span>${cl.nb} étude${cl.nb>1?'s':''}</span></div><button class="pen" data-editc="${esc(ncl(cl.nom))}" aria-label="Modifier la fiche client"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button></div>
   <div class="pills">${pill(cl.statut,CL_ST[cl.statut])}${cl.collab?pill(cl.collab+(cl.cadence?' · '+cl.cadence.toLowerCase():''),'fin'):''}</div></div>
  <div class="card"><h3>${ic('users')}Coordonnées</h3>${lig('Contact',cl.contact)+lig('E-mail',cl.email)+lig('Téléphone',cl.tel)+lig('Adresse de facturation',cl.adresse)+lig('SIRET',cl.siret)||'<div class="small">Aucune coordonnée : touchez le crayon pour compléter la fiche.</div>'}${cl.notes?`<div class="er" style="margin-top:8px">${esc(cl.notes)}</div>`:''}</div>
  <div class="card"><h3>${ic('euro')}Chiffres</h3><div class="ftg"><div class="ft"><small>CA signé TTC</small><b>${eur0(cl.ca)}</b></div><div class="ft acc"><small>Encaissé TTC</small><b>${eur0(cl.enc)}</b></div><div class="ft"><small>Reste dû</small><b>${eur0(cl.reste)}</b></div><div class="ft"><small>Études</small><b>${cl.nb}</b></div></div></div>
  <h3 style="margin:16px 2px 8px">Études</h3>${cl.etudes.slice().sort((a,b)=>(b.d||0)-(a.d||0)).map(cardEtude).join('')||emptyMsg('Aucune étude.')}
  <div class="plus"><button class="b" data-add="etudes" data-cl="${esc(cl.nom)}">+ Nouvelle étude pour ce client</button></div>`;
}
function ouvrirFicheClient(cle){
  let id=Object.keys(S.clients).find(i=>ncl(S.clients[i].nom)===cle);
  if(!id){const D=compute(),cl=D.clients.find(x=>ncl(x.nom)===cle);if(!cl)return;id=newId('c');S.clients[id]={ord:Date.now(),nom:cl.nom};saveRow('clients',id)}
  openEdit('clients',id,false);
}
// ---------- Facture prête à l'emploi (format des factures HAC du Drive) ----------
function refFacture(f,e){
  if(f.ref)return f.ref;
  // Référence au format HAC : FS-RAV-202607-02 = type - nom court de l'étude - année et mois - rang de la facture dans l'étude
  const p={Acompte:'FA',Intermédiaire:'FI',Solde:'FS'}[f.type]||'F',cli=String((e&&(e.code||e.num))||'X').normalize('NFD').replace(/[^A-Za-z0-9+]/g,'').toUpperCase().slice(0,10)||'X';
  const d=String(f.date||dstr(TODAY)).slice(0,7).replace('-','');
  const rang=Object.values(S.factures).filter(x=>x.etude===f.etude&&String(x.date||'')<=String(f.date||'9')).length;
  return p+'-'+cli+'-'+d+'-'+String(rang||1).padStart(2,'0');
}
// Détail d'une facture : prix d'une JEH (par défaut celui de l'étude) + lignes { lib, ht, frais, titre }.
// Ligne de prestation : on saisit le montant TTC ; HT = TTC ÷ (1 + TVA) ; nombre de JEH = HT ÷ prix d'une JEH HT.
// Ligne de frais : montant TTC, sans JEH. Titre de section : sans montant.
function totauxFacture(f,D){
  const e=D.etudes.find(x=>x.num===f.etude),tva=D.c.tva,prix=isNum(f.prixJeh)&&num(f.prixJeh)>0?num(f.prixJeh):num(e&&e.jeh);
  const L=(Array.isArray(f.lignes)?f.lignes:[]).map(l=>{const m=l.titre?0:isNum(l.ttc)?num(l.ttc)/(1+tva):num(l.ht);return Object.assign({},l,{montant:m,jeh:l.titre||l.frais||!prix?0:m/prix})});
  const jehTot=L.reduce((a,l)=>a+l.jeh,0),htBrut=L.reduce((a,l)=>a+l.montant,0);
  const prec=f.type==='Solde'&&f.deduire!==false?D.fact.filter(x=>x.etude===f.etude&&x.id!==f.id&&(x.de||0)<=(f.de||0)).reduce((a,x)=>a+num(x.montant),0)/(1+tva):0;
  const ht=htBrut-prec;return {lignes:L,jehTot,htBrut,prec,ht,tv:ht*tva,ttc:ht*(1+tva),prix};
}
function editeurLignes(r,D){
  const T=totauxFacture(r,D),j3=n=>nf3.format(Math.round(n*1000)/1000);
  const rows=T.lignes.map((l,i)=>l.titre
    ?`<div class="lgn titre"><input data-ligne="${i}" data-lf="lib" value="${esc(l.lib||'')}" placeholder="Titre de section (ex. Échantillon 1)"><button type="button" class="lb" data-lact="dup:${i}" aria-label="Dupliquer la section">⧉</button><button type="button" class="lb" data-lact="del:${i}" aria-label="Supprimer">✕</button></div>`
    :`<div class="lgn${l.frais?' frais':''}"><input class="ll" data-ligne="${i}" data-lf="lib" value="${esc(l.lib||'')}" placeholder="${l.frais?'Frais (ex. laboratoire)':'Phase (ex. Analyse)'}">
      <div class="lnum"><label>Montant TTC<input type="number" step="any" inputmode="decimal" data-ligne="${i}" data-lf="ttc" value="${esc(l.ttc??'')}"></label>
      <span class="lj"><span class="small">${nf2.format(l.montant)} € HT</span><br>${l.frais?'Frais (hors JEH)':`= <b>${j3(l.jeh)}</b> JEH`}</span><button type="button" class="lb" data-lact="dup:${i}" aria-label="Dupliquer">⧉</button><button type="button" class="lb" data-lact="del:${i}" aria-label="Supprimer">✕</button></div></div>`).join('');
  return `<div class="fld"><label>Détail de la prestation</label>
  <div class="lnum" style="margin-bottom:8px"><label>Prix d’une JEH HT (€)<input type="number" step="any" inputmode="decimal" data-fprix="${r.id}" value="${esc(isNum(r.prixJeh)?r.prixJeh:'')}" placeholder="${T.prix||'à saisir'}"></label></div>
  <div class="lgns">${rows||'<div class="small">Ajoutez les phases de l’étude avec leur montant TTC : le HT et le nombre de JEH sont calculés. Ajoutez aussi les frais et, si besoin, des titres de section.</div>'}</div>
  <div class="ladd"><button type="button" class="b ghost" data-lact="add:jeh">+ Prestation</button><button type="button" class="b ghost" data-lact="add:frais">+ Frais</button><button type="button" class="b ghost" data-lact="add:titre">+ Titre</button></div>
  <div class="ltot" id="ltot">${totauxHtml(T,r)}</div></div>`;
}
function totauxHtml(T,r){const e2=n=>nf2.format(n)+' €';return T.lignes.length?`<span>${nf3.format(Math.round(T.jehTot*1000)/1000)} JEH${T.prix?' à '+e2(T.prix):''}</span><span>Total HT ${e2(T.htBrut)}</span>${T.prec>0?`<span>− factures précédentes ${e2(T.prec)}</span>`:''}<b>TTC ${e2(T.ttc)}</b>${!T.prix&&T.lignes.some(l=>!l.titre&&!l.frais)?'<span class="small warnx">Saisissez le prix d’une JEH pour calculer le nombre de JEH.</span>':''}<span class="small">Le montant TTC de la facture suit ce détail.</span>`:''}
function genererFacture(id){
  const D=compute(),f=D.fact.find(x=>x.id===id);if(!f)return;
  const e=D.etudes.find(x=>x.num===f.etude),c=D.c,F=c.fact||{},tva=c.tva,e2=n=>nf2.format(n)+' €';
  const manque=['nom','adresse','siret','iban'].filter(k=>!F[k]);
  if(manque.length&&!confirm('Coordonnées de facturation incomplètes (Réglages → Facturation). Générer quand même ?'))return;
  const ref=refFacture(f,e);if(!S.factures[id].ref){S.factures[id].ref=ref;saveRow('factures',id)}
  const prix=num(e&&e.jeh),L=[];const TL=totauxFacture(f,D);
  if(TL.lignes.length){TL.lignes.forEach(l=>L.push(l.titre?['§'+(l.lib||''),'','',null]:l.frais?[l.lib||'Frais','0','0',l.montant]:[l.lib||'',nf3.format(Math.round(l.jeh*1000)/1000),e2(TL.prix),l.montant]))}
  else{
  if(isNum(f.jehFact)&&num(f.jehFact)>0)L.push([f.prestation||(e&&e.resume)||'Prestation',nf3.format(num(f.jehFact)),e2(prix),num(f.jehFact)*prix]);
  if(isNum(f.fraisFact)&&num(f.fraisFact)>0)L.push(['Frais (laboratoire…)','','',num(f.fraisFact)]);
  if(!L.length)L.push([f.prestation||(e&&e.resume)||'Prestation','','',num(f.montant)/(1+tva)]);}
  let ht=L.reduce((a,l)=>a+num(l[3]),0);
  const jehTot=TL.lignes.length?TL.jehTot:num(f.jehFact);
  if(f.type==='Solde'&&f.deduire!==false&&(TL.lignes.length||isNum(f.jehFact))){const prec=D.fact.filter(x=>x.etude===f.etude&&x.id!==id&&(x.de||0)<=(f.de||0)).reduce((a,x)=>a+num(x.montant),0)/(1+tva);if(prec>0){L.push(['Déduction des factures précédentes (HT)','','',-prec]);ht-=prec}}
  const tv=ht*tva,ttc=ht+tv,ecart=Math.abs(ttc-num(f.montant))>0.01;
  const ech=f.echeance?fdate(dnum(f.echeance)):(F.delai&&f.de!==null?fdate(f.de+num(F.delai)):'');
  const h=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(ref)}</title><style>body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:32px}h1{font-size:22px;margin:0 0 4px;color:#D5197F}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left}td.n,th.n{text-align:right}.tot td{border:0}.big{font-size:16px;font-weight:700}.g{display:flex;justify-content:space-between;gap:24px}.muted{color:#666;font-size:11px}.warn{background:#fff3cd;padding:8px;border-radius:6px;margin-bottom:12px}@media print{.warn,.np{display:none}}</style></head><body>
  ${ecart?`<div class="warn">Attention : le total calculé (${e2(ttc)} TTC) diffère du montant saisi dans l’app (${e2(num(f.montant))}). Vérifiez les JEH et frais de la facture.</div>`:''}
  <div class="g"><div><b>${esc(F.nom||'Association')}</b><br>${esc(F.mention||'')}<br>${esc(F.adresse||'')}<br>${esc(F.site||'')} ${esc(F.email||'')}<br><span class="muted">SIRET : ${esc(F.siret||'—')} · APE : ${esc(F.ape||'—')} · TVA intracom. : ${esc(F.tvaIntra||'—')}</span></div>
  <div style="text-align:right"><h1>Facture ${esc((f.type||'').toLowerCase()==='acompte'?'d’acompte':(f.type||'').toLowerCase()==='solde'?'de solde':'intermédiaire')}</h1>Réf. : <b>${esc(ref)}</b><br>Émise le ${f.de!==null?fdate(f.de):fdate(TODAY)}${ech?'<br>Échéance : '+ech:''}<br>Étude n° ${esc(f.etude||'')}</div></div>
  <p style="margin-top:22px">À l’attention de :<br><b>${esc((e&&e.client)||'')}</b><br>${esc((e&&e.adresse)||'')}</p>
  <table><thead><tr><th>Désignation</th><th class="n">Nombre de JEH</th><th class="n">Prix unitaire HT</th><th class="n">Montant HT</th></tr></thead><tbody>${L.map(l=>l[3]===null?`<tr><td colspan="4"><b>${esc(l[0].slice(1))}</b></td></tr>`:`<tr><td>${esc(l[0])}</td><td class="n">${l[1]}</td><td class="n">${l[2]}</td><td class="n">${e2(l[3])}</td></tr>`).join('')}</tbody>
  <tbody class="tot">${jehTot>0?`<tr><td colspan="3" class="n">Nombre total de JEH</td><td class="n">${nf3.format(Math.round(jehTot*1000)/1000)}</td></tr>`:''}<tr><td colspan="3" class="n">Total HT</td><td class="n">${e2(ht)}</td></tr><tr><td colspan="3" class="n">TVA (${nf2.format(tva*100).replace(/,00$/,'')} %) — TVA sur les encaissements</td><td class="n">${e2(tv)}</td></tr><tr><td colspan="3" class="n big">Total TTC à payer</td><td class="n big">${e2(ttc)}</td></tr></tbody></table>
  <p><b>Modalités de paiement</b>${F.contact?' : '+esc(F.contact):''}<br>Virement — IBAN : ${esc(F.iban||'—')} · BIC : ${esc(F.bic||'—')}${F.banque?' · '+esc(F.banque):''}${F.ordre?'<br>Chèques à l’ordre de '+esc(F.ordre):''}</p>
  <p class="muted">Aucun escompte n’est accordé pour paiement anticipé. En cas de retard de paiement, conformément à la loi 2008-776 du 4 août 2008, il sera appliqué des pénalités au taux de 3 fois le taux d’intérêt légal en vigueur et, en application des articles L441-3 et L441-6 du code de commerce, une indemnité forfaitaire de recouvrement de 40 euros. Cette pénalité court à compter de la date d’échéance jusqu’au jour du paiement complet des sommes dues.</p>
  <p class="np"><button onclick="print()">Imprimer / enregistrer en PDF</button></p></body></html>`;
  const w=window.open('','_blank');if(!w){alert('Autorisez les fenêtres pour cette appli afin de générer la facture.');return}
  w.document.open();w.document.write(h);w.document.close();
}
function factCard(f,showEt){const st=f.paid?'Payée':f.late?'En retard':'Émise';return `<button class="card lcard" data-edit="factures:${f.id}">${dayBox(f.de)}<div class="lm"><b>${esc(f.type)}${f.ref?' · '+esc(f.ref):''}</b>${showEt?`<span class="small">${f.etude?'Étude '+esc(f.etude)+((S.etudes&&Object.values(S.etudes).find(e=>e.num===f.etude)||{}).client?' · '+esc(Object.values(S.etudes).find(e=>e.num===f.etude).client):''):'Étude à choisir'}</span>`:''}<span class="small">${f.paid?(f.datePaiement&&dnum(f.datePaiement)!==null?'Payée le '+fdate(dnum(f.datePaiement)):'Payée · date de paiement à renseigner'):f.ech!==null?'Échéance '+fdate(f.ech):'Sans échéance'}</span></div><div class="rt"><span class="amt">${eur(f.montant)}</span>${pill(st,f.paid?'arch':f.late?'on':'s2')}</div></button>`}
function listFact(D){
  const f=FLT.factures,q=f.q.trim().toLowerCase();
  const L=D.fact.filter(x=>(f.s==='all'||(f.s==='due'&&!x.paid)||(f.s==='late'&&x.late)||(f.s==='paid'&&x.paid))&&(!q||[x.etude,x.type,x.mandat].join(' ').toLowerCase().includes(q))).sort((a,b)=>(b.de||0)-(a.de||0));
  const enc=L.filter(x=>x.paid).reduce((a,x)=>a+num(x.montant),0),due=L.filter(x=>!x.paid).reduce((a,x)=>a+num(x.montant),0);
  return `<div class="sum"><b>${L.length}</b> facture${L.length>1?'s':''} · ${eur0(enc)} TTC encaissés${due?' · <b>'+eur0(due)+'</b> TTC à encaisser':''}</div>`+(L.map(x=>factCard(x,true)).join('')||emptyMsg('Aucune facture.'));
}
let FSEG=['paie','jeh'].includes(lsGet('suivi.fseg'))?lsGet('suivi.fseg'):'factures';
function vFinances(D){
  const M=['Tous les mandats'].concat(D.c.mandats.map(m=>m.nom));if(!M.includes(mandatSel))mandatSel='Tous les mandats';
  HSEL=`<select id="msel" aria-label="Mandat">${M.map(m=>`<option${m===mandatSel?' selected':''}>${esc(m)}</option>`).join('')}</select>`;
  const all=mandatSel==='Tous les mandats',F=D.fact.filter(f=>all||f.mandat===mandatSel),tva1=1+D.tva;
  const fact=F.reduce((a,f)=>a+num(f.montant),0)/tva1,enc=F.filter(f=>f.paid).reduce((a,f)=>a+num(f.montant),0)/tva1,du=fact-enc;
  const late=F.filter(f=>f.late).reduce((a,f)=>a+num(f.montant),0)/tva1,R=remun(D);
  const t=(l,v,cls)=>`<div class="kpi"><div class="lab"><span>${l}</span></div><div class="val${cls?' '+cls:''}">${v}</div></div>`;
  // Même présentation que les chiffres clés du tableau de bord
  const kpi=(l,v,note,k)=>`<div class="kpi"><div class="lab">${ic(k,15)}<span>${l}</span></div><div class="val">${v}</div>${note?`<div class="note">${note}</div>`:''}</div>`;
  const pe=fact>0?Math.min(100,Math.round(enc/fact*100)):0;
  return `<h2>Finances${all?'':' · '+esc(mandatSel)}</h2><div class="card kpis">
    ${kpi('FACTURÉ HT',eur0(fact),F.length+' facture'+(F.length>1?'s':''),'sign')}
    ${kpi('ENCAISSÉ HT',eur0(enc),pe+' % du facturé','trend')}
    ${kpi('À ENCAISSER HT',eur0(du),'dont retard '+nf0.format(Math.round(late))+' €','hour')}
    <div class="sve"><div class="svh"><span><b>${eur0(enc)}</b> encaissés sur <b>${eur0(fact)}</b> facturés</span><b class="pct">${pe} %</b></div><div class="svt"><i style="width:${pe}%"></i></div></div>
    <div class="finnet"><span>Net à verser aux étudiants (prochains BV)</span><b>${eur(R.T.net)}</b></div></div>
  <div class="seg finseg" role="group" aria-label="Finances"><button data-fseg="factures" aria-pressed="${FSEG==='factures'}">Factures</button><button data-fseg="jeh" aria-pressed="${FSEG==='jeh'}">JEH</button><button data-fseg="paie" aria-pressed="${FSEG==='paie'}">Paie (BV)</button></div>
  ${(FSEG==='paie'?vRemun(D):FSEG==='jeh'?vTemps(D):vFactures(D)).replace(/^<h2>[^<]*<\/h2>/,'')}`;
}
function vFactures(D){const n=D.fact.filter(x=>x.late).length;return `<h2>Factures</h2>${searchBox('factures')}${chipsRow('factures',[['all','Toutes'],['due','À encaisser'],['late','En retard'+(n?' · '+n:'')],['paid','Payées']])}<div id="lst">${listFact(D)}</div>${fab('factures','Ajouter une facture')}`}
function selEtude(c,r,f,D){return sel(c,r,f,D.etudes.map(e=>e.num).filter(Boolean))}
function jehCard(t,D){
  const e=D.etudes.find(x=>x.num===t.etude),st=t.statut?t.stat:'Sans statut',paye=t.stat==='Payé';
  const lib={'Pas payé':'À payer','Payé':'Payé','A venir':'À venir','Non effectué':'Non effectué','Sans statut':'Statut à choisir'}[st]||st;
  return `<button class="card lcard jc" data-edit="temps:${t.id}">${dayBox(t.d)}
  <div class="lm"><b>${esc(t.prenom)||'Prénom à saisir'}</b><span class="small">${t.etude?'Étude '+esc(t.etude)+(e&&e.client?' · '+esc(e.client):''):'Étude à choisir'}</span>
  <span class="small">${hm(t.min)}${num(t.nb)>1?' à '+num(t.nb)+' personnes':''}${t.note?' · '+esc(t.note):''}</span></div>
  <div class="rt"><span class="jj">${t.I===null?'—':nf3.format(Math.round(t.I*1000)/1000)+' JEH'}</span><span class="small">${t.J===null?'—':eur(t.J)}</span><span class="jst ${paye?'ok':!t.statut?'warn':st==='Pas payé'?'due':''}">${lib}</span></div></button>`;
}
function listTemps(D){
  const f=FLT.temps,q=f.q.trim().toLowerCase();
  const topay=t=>!['Payé','A venir','Non effectué'].includes(t.stat);
  const L=D.temps.filter(t=>(f.s==='all'||(f.s==='pay'&&topay(t))||(f.s==='paid'&&t.stat==='Payé'))&&(!q||[t.prenom,t.etude,t.note,t.mandat].join(' ').toLowerCase().includes(q))).sort((a,b)=>(b.d||0)-(a.d||0));
  const jeh=L.reduce((a,t)=>a+num(t.I),0),brut=L.filter(topay).reduce((a,t)=>a+num(t.J),0);
  return `<div class="sum"><b>${L.length}</b> ligne${L.length>1?'s':''} · <b>${nf3.format(Math.round(jeh*1000)/1000)}</b> JEH${brut?' · '+eur0(brut)+' brut à payer':''}</div>`+(L.map(t=>jehCard(t,D)).join('')||emptyMsg('Aucune ligne de temps.'));
}
function vTemps(D){return `<h2>JEH</h2>${searchBox('temps')}${chipsRow('temps',[['all','Tout'],['pay','À payer'],['paid','Payé']])}<div id="lst">${listTemps(D)}</div>${fab('temps','Ajouter une ligne de temps')}`}
function vRemun(D){
  const R=remun(D),T=R.T;
  const cards=R.rows.filter(r=>r.jeh>0||r.dejaPaye>0).map(r=>{
    const L=D.temps.filter(t=>t.prenom===r.nom&&!['Payé','A venir','Non effectué'].includes(t.stat)&&t.I!==null);
    const ets=[...new Set(L.map(t=>t.etude).filter(Boolean))],cot=r.brut-r.net,mini=r.jeh>0&&r.jeh<1,nbBV=new Set(D.temps.filter(t=>t.prenom===r.nom&&t.stat==='Payé').map(t=>t.bvDate||'h')).size;
    const ini=esc(iniP(r.nom));
    return `<div class="card pc2${r.jeh>0?'':' paid'}"><div class="eh"><div class="cch"><span class="cav">${ini}</span><div class="et"><b>${esc(r.nom)}</b><span>${r.jeh>0?nf3.format(Math.round(r.jeh*1e3)/1e3)+' JEH à payer'+(ets.length?' · étude'+(ets.length>1?'s':'')+' '+ets.map(esc).join(', '):''):'À jour'}</span></div></div>
    <div class="pnet"><b>${eur(r.net)}</b><small>net à virer</small></div></div>
    ${r.jeh>0?`<div class="pdec"><div><small>Brut</small><b>${eur(r.brut)}</b></div><div><small>Cotisations</small><b>− ${eur(cot)}</b></div><div><small>Coût Junior</small><b>${eur(r.cout)}</b></div></div>`:''}
    ${mini?`<div class="eal">${ic('warn',13)} Moins de 1 JEH sur ce BV : cotisations et charges calculées sur 1 JEH</div>`:''}
    <div class="emeta"><span>Déjà payé : ${eur(r.dejaPaye)} · ${nf3.format(Math.round(r.jehPay*1e3)/1e3)} JEH${nbBV&&r.dejaPaye>0?' · '+nbBV+' BV':''}</span></div></div>`}).join('');
  return `<h2>Rémunérations</h2><div class="card pcard tot"><div class="small">Net à virer en tout</div><div class="net big">${eur(T.net)}</div><div class="ef3" style="margin-top:8px"><span>Brut ${eur(T.brut)}</span><span>Cotisations ${eur(T.brut-T.net)}</span><span>Coût Junior ${eur(T.cout)}</span></div></div>
  ${cards||emptyMsg('Personne à payer pour le moment.')}
  <details class="how"><summary>Comment c’est calculé ?</summary><div class="small">Page automatique : rien à saisir. Pour chaque personne, elle regroupe les JEH du journal qui ne sont ni « Payé », ni « A venir », ni « Non effectué », puis calcule brut, net (après cotisations salariales) et coût Junior. Par BV, en dessous de 1 JEH, cotisations et charges sont calculées sur 1 JEH (le BV reste valide). Passez les lignes d’un BV à « Payé » : celles passées le même jour forment un BV, et la personne repart à zéro.</div></details>`;
}
let FSORT=null;
function vFormation(D){
  const names=persons(D);Object.keys(S.formation).forEach(id=>{const n=S.formation[id].nom;if(n&&!names.includes(n))names.push(n)});
  const open=D.etudes.filter(e=>e.num&&e.statut!=='Archivée'&&e.statut!=='Refusé / sans suite'),closed=D.etudes.filter(e=>e.num&&(e.statut==='Archivée'||e.statut==='Refusé / sans suite'));
  const cols=open.concat(closed);
  const LV=['0 · Non formé','1 · Notions','2 · Autonome avec appui','3 · Autonome','4 · Référent (peut former)'];
  const key=n=>'f_'+n.toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const lvOf=(n,en)=>{const d=S.formation[key(n)];return d&&d.niveaux&&isNum(d.niveaux[en])?num(d.niveaux[en]):-1};
  if(FSORT&&cols.some(e=>e.num===FSORT))names.sort((a,b)=>lvOf(b,FSORT)-lvOf(a,FSORT));
  const head=cols.map(e=>`<th class="fs${FSORT===e.num?' on':''}" data-fsort="${esc(e.num)}" style="${closed.includes(e)?'opacity:.6':''}">${esc(e.num)}${FSORT===e.num?' ▼':''}</th>`).join('');
  const body=names.map(n=>{const doc=S.formation[key(n)]||{niveaux:{}};const vals=cols.map(e=>doc.niveaux&&isNum(doc.niveaux[e.num])?num(doc.niveaux[e.num]):null).filter(v=>v!==null);
    const avg=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    return `<tr><td style="white-space:nowrap;padding:6px 10px"><b>${esc(n)}</b></td>${cols.map(e=>{const v=doc.niveaux&&isNum(doc.niveaux[e.num])?num(doc.niveaux[e.num]):'';return `<td><select data-lvl="${esc(n)}" data-etude="${esc(e.num)}" class="${v===''?'':'lv'+v}"><option value=""></option>${[0,1,2,3,4].map(k=>`<option value="${k}"${v===k?' selected':''}>${k}</option>`).join('')}</select></td>`}).join('')}</tr>`}).join('');
  return `<h2>Niveau de formation par intervenant et par étude</h2><div class="small">Une ligne par intervenant (les prénoms viennent du Temps de travail), une colonne par étude : les études en cours d’abord, les archivées ensuite. Choisissez le niveau de 0 à 4 dans la case, la couleur suit.</div>
  <div class="tw" style="margin-top:10px"><table class="mx"><thead><tr><th>Intervenant</th>${head}</tr></thead><tbody>${body||'<tr><td class="small" style="padding:14px">Ajoutez d’abord du temps de travail pour faire apparaître les intervenants.</td></tr>'}</tbody></table></div>`;
}

/* ---------- fiche de saisie (par le bas) ---------- */
let ED=null;
const fld=(l,h)=>`<div class="fld"><label>${l}</label>${h}</div>`;
const edRow=D=>ED&&(ED.col==='clients'?(S.clients[ED.id]?[Object.assign({id:ED.id},S.clients[ED.id])]:[]):ED.col==='etudes'?D.etudes:ED.col==='factures'?D.fact:D.temps).find(x=>x.id===ED.id);
function edSummary(r,D){
  const st=(l,v)=>`<div class="stat"><span>${l}</span><span>${v}</span></div>`;
  if(ED.col==='etudes')return st('Statut financier (auto)',esc(r.facture)||'—')+st('Prochaine échéance',r.echeance?fdate(dnum(r.echeance)):'—')+st('Mandat',esc(r.mandat)||'—')+st('JEH facturées',r.J===null?'—':nf3.format(Math.round(r.J*1000)/1000))+st('Encaissé TTC',eur(r.K))+st('Reste à encaisser TTC',r.L===null?'—':eur(r.L))+st('BV',esc(r.N)||'—')+st('Dépenses embauches / HT',r.P===null?'—':Math.round(r.P*100)+' %')+(r.alerts.length?`<ul class="al wr">${r.alerts.map(a=>`<li>${ic('warn',13)} ${esc(a)}</li>`).join('')}</ul>`:'<div class="small" style="margin-top:6px">Aucune alerte.</div>');
  if(ED.col==='clients'){const cl=D.clients.find(x=>ncl(x.nom)===ncl(r.nom));return cl?st('Études',cl.nb)+st('CA signé TTC',eur0(cl.ca))+st('Reste dû',eur0(cl.reste)):''}
  if(ED.col==='factures')return st('Mandat',esc(r.mandat)||'—');
  return st('Mandat',esc(r.mandat)||'—')+st('JEH rémunérée',r.I===null?'—':nf3.format(Math.round(r.I*10000)/10000))+st('Rémunération brute',r.J===null?'—':eur(r.J));
}
function edBody(r,D){
  const c=ED.col,cf=D.c;
  if(c==='clients')return fld('Nom du client',inT(c,r,'nom'))+fld('Contact (nom, fonction)',inT(c,r,'contact'))+`<div class="f2">${fld('E-mail',inT(c,r,'email'))}${fld('Téléphone',inT(c,r,'tel'))}</div>`+fld('Adresse de facturation',inT(c,r,'adresse'))+fld('SIRET',inT(c,r,'siret'))+`<div class="f2">${fld('Collaboration',sel(c,r,'collab',['Ponctuelle','Récurrente']))}${fld('Facturation périodique',sel(c,r,'cadence',['Mensuelle','Trimestrielle','Semestrielle','Annuelle']))}</div>`+fld('Notes',inT(c,r,'notes'))+`<div class="small" style="margin-top:6px">Collaboration, facturation périodique et adresse s’appliquent aux études de ce client qui ne les précisent pas.</div>`;
  if(c==='etudes')return fld('Client',`<input list="cll" ${attr(c,r.id,'client')} value="${esc(r.client)}" autocomplete="off"><datalist id="cll">${D.clients.map(x=>`<option value="${esc(x.nom)}">`).join('')}</datalist>`)+fld('N° d’étude',inT(c,r,'num'))+fld('Résumé',inT(c,r,'resume'))+fld('Statut de l’étude',sel(c,r,'statut',cf.statuts))+`<div class="f2">${fld('JEH client HT',inN(c,r,'jeh'))}${fld('Montant TTC',inN(c,r,'montant'))}</div>`+fld('Dont frais HT (labo…, hors JEH)',inN(c,r,'frais'))+fld('Nom court de l’étude (pour les références, ex. RAV)',inT(c,r,'code',r.num||''))+fld('Adresse de facturation du client',inT(c,r,'adresse'))+`<div class="f2">${fld('Collaboration',sel(c,r,'collab',['Ponctuelle','Récurrente']))}${fld('Facturation périodique',sel(c,r,'cadence',['Mensuelle','Trimestrielle','Semestrielle','Annuelle']))}</div>`+fld('Date de création',inD(c,r,'date'));
  if(c==='factures')return fld('Étude',selEtude(c,r,'etude',D))+`<div class="f2">${fld('Type',sel(c,r,'type',F_TYPES,false))}${fld('Montant TTC',inN(c,r,'montant'))}</div><div class="f2">${fld('Date d’émission',inD(c,r,'date'))}${fld('Échéance',inD(c,r,'echeance'))}</div><div class="f2">${fld('État',sel(c,r,'etat',F_ETATS,false))}${fld('Payée le',inD(c,r,'datePaiement'))}</div>`+editeurLignes(r,D)+(r.type==='Solde'?`<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" data-deduire="${r.id}" ${r.deduire===false?'':'checked'}> Déduire les factures précédentes de l’étude</label>`:'')+(r.id?`<button class="b" type="button" data-pdf="${r.id}" style="margin-top:10px">Générer la facture (PDF)</button>`:'');
  return fld('Prénom',`<input list="pl" ${attr(c,r.id,'prenom')} value="${esc(r.prenom)}" autocomplete="off"><datalist id="pl">${persons(D).map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`)+fld('Étude',selEtude(c,r,'etude',D))+`<div class="f2">${fld('Date',inD(c,r,'date'))}${fld('Statut',sel(c,{id:r.id,statut:r.stat},'statut',BV_STAT,false))}</div><div class="f2">${fld('Minutes travaillées',inN(c,r,'min'))}${fld('Nb de personnes',inN(c,r,'nb'))}</div>${fld('JEH intervenant HT',inN(c,r,'jeh'))}${fld('Note',inT(c,r,'note'))}`;
}
const ED_TITLE={clients:['Nouveau client','Fiche client'],etudes:['Nouvelle étude','Modifier l’étude'],factures:['Nouvelle facture','Modifier la facture'],temps:['Nouvelle ligne de temps','Modifier la ligne de temps']};
function openEdit(col,id,isNew){
  ED={col,id,isNew:!!isNew};const D=compute(),r=edRow(D);if(!r){ED=null;return}
  const el=$('#edit');
  el.innerHTML=`<div class="sbg" data-ed="close"></div><div class="sc"><div class="grip"></div><div class="shead"><h2>${ED_TITLE[col][isNew?0:1]}</h2><button class="mx" type="button" data-ed="close" aria-label="Fermer">✕</button></div>${edBody(r,D)}<div class="msg" id="edsum">${edSummary(r,D)}</div><button class="mb solid" type="button" data-ed="close">Terminé</button><button class="mb ghost" type="button" data-eddel="1" style="color:var(--bad)">Supprimer</button></div>`;
  el.hidden=false;
}
function refreshEdit(){if(!ED)return;const D=compute(),r=edRow(D),s=$('#edsum');if(r&&s)s.innerHTML=edSummary(r,D)}
function closeEdit(){
  if(PSEC){PSEC=null;const el=$('#edit');el.hidden=true;el.innerHTML='';render();return}
  if(!ED)return;const {col,id,isNew}=ED,r=S[col]&&S[col][id];
  if(isNew&&r){const blank=col==='etudes'?!r.client&&!r.num&&!r.resume&&!isNum(r.montant):col==='factures'?!isNum(r.montant):!r.prenom&&!isNum(r.min);if(blank)del(col,id)}
  const wasNewEt=isNew&&col==='etudes'&&S.etudes[id];ED=null;const el=$('#edit');el.hidden=true;el.innerHTML='';if(wasNewEt){openRep(id);return}render();
}
function ct(label,path,val,ph){return `<div class="pr"><label>${label}</label><div class="pin"><input type="text" data-cfg="${path}" data-txt="1" value="${esc(val||'')}" placeholder="${esc(ph||'')}"></div></div>`}
function cf(label,path,val,pct,unit){return `<div class="pr"><label>${label}</label><div class="pin"><input type="number" step="any" inputmode="decimal" data-cfg="${path}" ${pct?'data-pct="1"':''} value="${pct?Math.round(val*1e6)/1e4:esc(val)}"><span>${pct?'%':(unit||'')}</span></div></div>`}
function listEd(k,arr,ph){return `<div class="led">${arr.map((v,i)=>`<div class="li"><span class="hdl" data-k="${k}" aria-label="Déplacer"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></span><input data-li="${k}" data-i="${i}" value="${esc(v)}"><button class="x" data-lidel="${k}:${i}" aria-label="Supprimer">✕</button></div>`).join('')}</div><button class="b ghost addl" data-liadd="${k}">+ ${ph}</button>`}
const PIC={
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2 .8 3.5 2.6 3.5 5.7"/>',
 code:'<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
 dash:'<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
 alert:'<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 1c0 1.7-2.5 2.2-2.5 3.8"/><path d="M12 17.5h.01"/>',
 fact:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
 sync:'<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
 imp:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
 exp:'<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 17v3h16v-3"/>',
 rest:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
 thm:'<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
 mand:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
 stat:'<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
 fact:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
 bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
 cnje:'<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
 cot:'<circle cx="12" cy="12" r="9"/><path d="M15 9.2a3.6 3.6 0 1 0 0 5.6M8 11h5.5M8 13h5.5"/>',
 dev:'<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>'};
const pic=k=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PIC[k]}</svg>`;
function paramSecs(D){
  const c=D.c;const sumP=o=>Object.values(o).reduce((a,v)=>a+num(v),0);
  const tot=(l,v)=>`<div class="pr tot"><label>${l}</label><b>${nf2.format(v*100)} %</b></div>`;
  const cur=c.mandats.find(m=>{const a=dnum(m.debut),b=dnum(m.fin);return a!==null&&b!==null&&TODAY>=a&&TODAY<=b});
  const mand=c.mandats.map((m,i)=>[m,i]).sort((x,y)=>(dnum(x[0].debut)??1e9)-(dnum(y[0].debut)??1e9)).map(([m,i])=>`<div class="mand"><div class="li"><input data-mand="${i}" data-k="nom" value="${esc(m.nom)}" placeholder="Nom du mandat"><button class="x" data-delmand="${i}" aria-label="Supprimer le mandat">✕</button></div><div class="mrw">${fld('Début',`<input type="date" data-mand="${i}" data-k="debut" value="${esc(m.debut)}">`)}<div class="mfin">${!m.debut?'Date de début à saisir':m.ouvert?'En cours, sans fin':'Jusqu’au '+fdate(dnum(m.fin))}</div></div></div>`).join('');
  const nd=Object.keys(S.devs||{}).length;
  return [
   {k:'mand',t:'Mandats',s:c.mandats.length+' mandat'+(c.mandats.length>1?'s':'')+(cur?' · actuel : '+cur.nom:''),b:()=>`${mand||'<div class="small">Aucun mandat.</div>'}<button class="b ghost addl" data-addmand="1">+ Ajouter un mandat</button>`},
   {k:'stat',t:'Statuts des études',s:c.statuts.length+' statuts',b:()=>listEd('statuts',c.statuts,'Ajouter un statut')},
   {k:'bell',t:'Relances et TVA',s:'relances à '+c.relance1+' et '+c.relance2+' j · TVA '+nf2.format(c.tva*100).replace(/,00$/,'')+' %',b:()=>cf('1re relance par mail','relance1',c.relance1,false,'jours')+cf('2e relance','relance2',c.relance2,false,'jours')+cf('TVA','tva',c.tva,true)},
   {k:'cnje',t:'Règles CNJE',s:c.cnje.date?'JEH '+c.cnje.min+'–'+c.cnje.max+' € · depuis le '+fdate(dnum(c.cnje.date)):'Aucune règle appliquée',b:()=>fld('Règles en vigueur depuis le',`<input type="date" data-cfg="cnje.date" value="${esc(c.cnje.date)}">`)+cf('JEH client minimum HT','cnje.min',c.cnje.min,false,'€')+cf('JEH client maximum HT','cnje.max',c.cnje.max,false,'€')+cf('JEH intervenant maximum HT','cnje.maxInt',c.cnje.maxInt,false,'€')},
   {k:'cot',t:'Cotisations',s:'salariales '+nf2.format(sumP(c.cot)*100)+' % · patronales '+nf2.format(sumP(c.patr)*100)+' %',b:()=>cf('SMIC horaire brut','smic',c.smic,false,'€')+`<div class="sh">Cotisations salariales</div>`+Object.keys(COT_LAB).map(k=>cf(COT_LAB[k],'cot.'+k,c.cot[k],true)).join('')+tot('Total',sumP(c.cot))+`<div class="sh">Charges patronales</div>`+Object.keys(PATR_LAB).map(k=>cf(PATR_LAB[k],'patr.'+k,c.patr[k],true)).join('')+cf('Chômage part Junior','chomage',c.chomage,true)+tot('Total',sumP(c.patr))},
   {k:'alert',t:'Alertes',s:c.alertesOn===false?'Désactivées':(ALERTS.length-ALERTS.filter(x=>(c.alertesOff||{})[x[0]]).length)+' activées sur '+ALERTS.length,b:()=>`<label class="tg big"><span><b>Activer les alertes</b></span><input type="checkbox" data-alall="1" ${c.alertesOn===false?'':'checked'}><i></i></label><div class="${c.alertesOn===false?'dim':''}">${['Toutes les études','CNJE'].map(g=>`<div class="sh">${g}</div>`+ALERTS.filter(x=>(g==='CNJE')===x[0].startsWith('cnje')).map(x=>`<label class="tg"><span><b>${esc(x[2])}</b><small>${esc(x[3])}</small></span><input type="checkbox" data-alk="${x[0]}" ${(c.alertesOff||{})[x[0]]?'':'checked'} ${c.alertesOn===false?'disabled':''}><i></i></label>`).join('')).join('')}</div>`},
   {k:'fact',t:'Facturation',s:(c.fact&&c.fact.nom)?esc(c.fact.nom)+' · coordonnées des factures':'Coordonnées à renseigner pour générer les factures',b:()=>{const F=c.fact||{};return ct('Nom de l’association','fact.nom',F.nom,'Horizons Alsace Chimie')+ct('Mention','fact.mention',F.mention,'Association loi 1908, affiliée à la CNJE')+ct('Adresse','fact.adresse',F.adresse)+ct('Site web','fact.site',F.site)+ct('E-mail','fact.email',F.email)+ct('SIRET','fact.siret',F.siret)+ct('Code APE','fact.ape',F.ape)+ct('N° TVA intracommunautaire','fact.tvaIntra',F.tvaIntra)+ct('IBAN','fact.iban',F.iban)+ct('BIC','fact.bic',F.bic)+ct('Domiciliation','fact.banque',F.banque)+ct('Chèques à l’ordre de','fact.ordre',F.ordre)+ct('Contact paiements (nom, fonction)','fact.contact',F.contact)+ct('Délai de paiement (jours)','fact.delai',F.delai,'30')}},
   {k:'help',t:'Aide',s:'Comment ça marche, BV',b:()=>`<ul class="hlp"><li>Le <b>mandat</b> se déduit de la date (rubrique Mandats).</li><li>L’<b>encaissé</b> d’une étude = somme de ses paiements dans Factures.</li><li><b>JEH rémunérée</b> = minutes ÷ 480 ÷ nombre de personnes.</li><li>Une ligne de temps « Payé », « A venir » ou « Non effectué » n’est jamais à payer.</li><li>Tout est enregistré automatiquement, sur tous vos appareils.</li></ul><div class="sh">BV (bulletins de versement)</div><ul class="hlp"><li><b>À payer</b> : au moins une ligne à verser.</li><li><b>À venir</b> : prévu, pas encore dû.</li><li><b>Payé</b> : toutes les lignes sont payées.</li><li><b>Non effectué</b> : le travail n’a pas eu lieu.</li></ul>`},
   {k:'dev',t:'Appareils connectés',s:lsGet('suivi.url')?(nd+' appareil'+(nd>1?'s':'')):'Synchronisation non activée',b:()=>devCard().replace(/^<div class="card" style="margin-top:12px"><h3>Appareils connectés<\/h3>/,'<div>')}
  ];
}
function vMoi(D){
  canWrite=false;
  const moi=lsGet('suivi.membre')||'',R=remun(D),r=R.rows.find(x=>ncl(x.nom)===ncl(moi))||{jeh:0,brut:0,net:0,dejaPaye:0,jehPay:0};
  const L=D.temps.slice().sort((a,b)=>(b.d||0)-(a.d||0)),fait=L.filter(t=>t.statut==='Payé'||t.statut==='Pas payé'),jt=fait.reduce((a,t)=>a+num(t.I),0);
  const nbBV=new Set(L.filter(t=>t.stat==='Payé').map(t=>t.bvDate||'h')).size,f3=n=>nf3.format(Math.round(n*1000)/1000);
  const niv=[];Object.values(S.formation).forEach(f=>Object.keys(f.niveaux||{}).forEach(n=>{if(isNum(f.niveaux[n]))niv.push([n,num(f.niveaux[n])])}));
  const ligne=t=>jehCard(t,D).replace(/^<button([^>]*) data-edit="[^"]*"/,'<div$1').replace(/<\/button>$/,'</div>');
  return `<h2>Bonjour ${esc(moi.split('.')[0]||moi)}</h2>
  <div class="card"><div class="ftg"><div class="ft acc"><small>À recevoir (prochain BV)</small><b>${eur(r.net)}</b></div><div class="ft"><small>Brut</small><b>${eur(r.brut)}</b></div><div class="ft"><small>JEH à payer</small><b>${f3(r.jeh)}</b></div><div class="ft"><small>Déjà reçu (brut)</small><b>${eur(r.dejaPaye)}</b></div></div>
  ${r.jeh>0&&r.jeh<1?`<div class="eal" style="margin-top:8px">${ic('warn',13)} Moins de 1 JEH : cotisations calculées sur 1 JEH</div>`:''}<div class="small" style="margin-top:8px">${f3(jt)} JEH réalisées en tout · ${nbBV} BV payé${nbBV>1?'s':''}</div></div>
  <h3 style="margin:16px 2px 8px">Mes lignes de JEH</h3>${L.map(ligne).join('')||emptyMsg('Aucune ligne de JEH à votre nom pour le moment.')}
  ${niv.length?`<h3 style="margin:16px 2px 8px">Ma formation</h3><div class="card">${niv.map(([n,v])=>`<div class="stat"><span>Étude ${esc(n)}</span><span>Niveau ${v} · ${['Non formé','Notions','Autonome avec appui','Autonome','Référent'][v]||''}</span></div>`).join('')}</div>`:''}
  <div class="small" style="margin-top:12px">Vous voyez uniquement les données liées à votre nom. Pour une correction, contactez la trésorerie.</div>`;
}
function vParams(D){
  const u=lsGet('suivi.url'),last=fmtLast(),nb=getBk().length;
  const row=(k,t,sub,attr)=>`<button class="srow" ${attr}><span class="sic">${pic(k)}</span><span class="stx"><b>${t}</b><small>${esc(sub)}</small></span><span class="chev">›</span></button>`;
  const top=`<div class="card slist">${row('sync','Synchronisation Drive',u?(last?'Dernière sauvegarde : '+last:'Activée'):'Non activée','data-mn="home"')}${u?row('code','Code d’accès personnel',lsGet('suivi.token')?(lsGet('suivi.membre')?'Connecté : '+lsGet('suivi.membre'):'Enregistré sur cet appareil'):'À saisir','data-mn="code"'):''}${u&&lsGet('suivi.token')?row('users','Membres et codes d’accès',lsGet('suivi.admin')==='1'?'Créer, réinitialiser ou désactiver les codes':'Changer mon code','data-mn="membres"'):''}${row('imp','Importer un fichier','Excel, CSV ou sauvegarde .json','data-mn="import"')}${row('exp','Exporter mes données','Fichier .json','data-mn="export"')}${row('rest','Restaurer une sauvegarde',nb+' sauvegarde'+(nb>1?'s':'')+' sur cet appareil','data-mn="restore"')}<div class="srow thrw"><span class="sic">${pic('thm')}</span><span class="stx"><b>Affichage</b></span></div><div class="seg" role="group" aria-label="Affichage">${[['auto','Système'],['light','Clair'],['dark','Sombre']].map(([v,l])=>`<button data-mn="theme" data-v="${v}" aria-pressed="${THEME()===v}">${l}</button>`).join('')}</div></div><div class="msg" id="mm" hidden></div>`;
  if(SALARIE)return `<h2>Paramètres</h2><div class="card slist">${row('code','Code d’accès personnel','Connecté : '+(lsGet('suivi.membre')||''),'data-mn="code"')}${row('users','Changer mon code','Un nouveau code est créé et enregistré sur ce téléphone','data-mn="moncode"')}</div><div class="small" style="text-align:center;margin-top:14px">Version ${VERSION}</div>`;
  return `<h2>Paramètres</h2>${top}<div class="sh" style="margin:16px 2px 6px">Réglages des calculs</div><div class="card slist">${paramSecs(D).map(x=>`<button class="srow" data-param="${x.k}"><span class="sic">${pic(x.k)}</span><span class="stx"><b>${x.t}</b><small>${esc(x.s)}</small></span><span class="chev">›</span></button>`).join('')}</div><div class="small" style="text-align:center;margin-top:14px">Version ${VERSION}</div>`;
}
let PSEC=null,DRAG=null;
document.addEventListener('pointerdown',e=>{const h=e.target.closest('.hdl');if(!h)return;e.preventDefault();const row=h.closest('.li'),rows=[...row.parentElement.children],i=rows.indexOf(row);DRAG={k:h.dataset.k,from:i,to:i,row,rows,y0:e.clientY};row.classList.add('drg');try{h.setPointerCapture(e.pointerId)}catch(x){}});
document.addEventListener('pointermove',e=>{if(!DRAG)return;const dy=e.clientY-DRAG.y0,H=DRAG.row.offsetHeight+6,n=DRAG.rows.length,f=DRAG.from;DRAG.row.style.transform=`translateY(${dy}px)`;const to=Math.max(0,Math.min(n-1,f+Math.round(dy/H)));DRAG.to=to;DRAG.rows.forEach((r,i)=>{if(r===DRAG.row)return;const sh=(f<to&&i>f&&i<=to)?-H:(f>to&&i<f&&i>=to)?H:0;r.style.transform=sh?`translateY(${sh}px)`:''})});
const endDrag=()=>{if(!DRAG)return;const {k,from,to}=DRAG;DRAG=null;if(from!==to){const c=ensureCfg();if(k==='dash'){const L=dashLayout();const [x]=L.order.splice(from,1);L.order.splice(to,0,x);dashSave(L);render()}else{const [x]=c[k].splice(from,1);c[k].splice(to,0,x);saveCfg();render()}}if(PSEC)drawParam()};
document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
function openParam(k){PSEC=k;ED=null;drawParam()}
function drawParam(){
  const x=PSEC==='dash'?dashSec():paramSecs(compute()).find(z=>z.k===PSEC);if(!x)return;const el=$('#edit'),sc=el.querySelector('.sc'),y=sc?sc.scrollTop:0;
  el.innerHTML=`<div class="sbg" data-ed="close"></div><div class="sc prm"><div class="grip"></div><div class="shead"><h2>${x.t}</h2><button class="mx" type="button" data-ed="close" aria-label="Fermer">✕</button></div>${x.b()}<button class="mb solid" type="button" data-ed="close" style="margin-top:16px">Terminé</button></div>`;
  el.hidden=false;const n=el.querySelector('.sc');if(n)n.scrollTop=y;
}
/* ---------- événements ---------- */
function setPath(o,p,v){const k=p.split('.');let t=o;for(let i=0;i<k.length-1;i++){t[k[i]]=t[k[i]]||{};t=t[k[i]]}t[k[k.length-1]]=v}
function ensureCfg(){if(!S.cfg)S.cfg=JSON.parse(JSON.stringify(DEFAULT_CFG));S.cfg.cot=Object.assign({},DEFAULT_CFG.cot,S.cfg.cot);S.cfg.patr=Object.assign({},DEFAULT_CFG.patr,S.cfg.patr);S.cfg.cnje=Object.assign({},DEFAULT_CFG.cnje,S.cfg.cnje);if(!S.cfg.mandats)S.cfg.mandats=[];return S.cfg}
document.addEventListener('input',e=>{if(e.target.matches('#view input:not([type=date]),#view textarea'))dirty=true});
document.addEventListener('change',e=>{
  const t=e.target;dirty=false;
  if(t.id==='msel'){mandatSel=t.value;lsSet('suivi.mandat',mandatSel);render();return}
  if(t.dataset.c){
    const col=t.dataset.c,id=t.dataset.id,f=t.dataset.f;let v=t.value;if(t.type==='number')v=v===''?null:Number(v);
    if(col==='clients'&&f==='nom'&&S.clients[id]){const old=S.clients[id].nom;if(old&&ncl(old)!==ncl(v)&&String(v).trim())Object.keys(S.etudes).forEach(i=>{if(ncl(S.etudes[i].client)===ncl(old)){S.etudes[i].client=v;saveRow('etudes',i)}});if(OPENC===ncl(old))OPENC=ncl(v)}
    if(S[col][id]){S[col][id][f]=v;if(col==='temps'&&f==='statut'){if(v==='Payé'&&!S[col][id].bvDate)S[col][id].bvDate=dstr(TODAY);else if(v!=='Payé')delete S[col][id].bvDate}if(col==='factures'&&f==='etat'&&v==='Payée'&&!S[col][id].datePaiement)S[col][id].datePaiement=dstr(TODAY);saveRow(col,id);if(col==='factures'&&f==='etat'&&ED)openEdit(ED.col,ED.id,ED.isNew)}
    render();refreshEdit();
  }else if(t.dataset.lvl!==undefined){
    const n=t.dataset.lvl,k='f_'+n.toLowerCase().replace(/[^a-z0-9]+/g,'_');
    const doc=S.formation[k]||(S.formation[k]={nom:n,niveaux:{}});doc.nom=n;doc.niveaux=doc.niveaux||{};
    if(t.value==='')delete doc.niveaux[t.dataset.etude];else doc.niveaux[t.dataset.etude]=Number(t.value);
    save('formation/'+k,doc);render();
  }else if(t.dataset.dshow){
    const L=dashLayout();if(t.checked)delete L.hide[t.dataset.dshow];else L.hide[t.dataset.dshow]=true;dashSave(L);render();
  }else if(t.dataset.alall||t.dataset.alk){
    const c=ensureCfg();if(t.dataset.alall)c.alertesOn=t.checked;else{c.alertesOff=c.alertesOff||{};if(t.checked)delete c.alertesOff[t.dataset.alk];else c.alertesOff[t.dataset.alk]=true}saveCfg();render();if(PSEC)drawParam();
  }else if(t.dataset.cfg){
    const c=ensureCfg();let v=t.type==='date'||t.dataset.txt?t.value:(t.value===''?null:Number(t.value));
    if(t.dataset.pct&&v!==null)v=v/100;
    setPath(c,t.dataset.cfg,v===null?0:v);saveCfg();render();if(PSEC==='cot'){const T=document.querySelectorAll('#edit .pr.tot b'),sp=o=>Object.values(o).reduce((a,x)=>a+num(x),0);if(T[0])T[0].textContent=nf2.format(sp(c.cot)*100)+' %';if(T[1])T[1].textContent=nf2.format(sp(c.patr)*100)+' %'}
  }else if(t.dataset.list){
    const c=ensureCfg();c[t.dataset.list]=t.value.split('\n').map(s=>s.trim()).filter(Boolean);saveCfg();render();
  }else if(t.dataset.li){
    const c=ensureCfg(),k=t.dataset.li,v=t.value.trim();if(v)c[k][+t.dataset.i]=v;else c[k].splice(+t.dataset.i,1);saveCfg();render();if(PSEC&&!v)drawParam();
  }else if(t.dataset.mand!==undefined){
    const c=ensureCfg();c.mandats[+t.dataset.mand][t.dataset.k]=t.value;saveCfg();render();
  }
});
document.addEventListener('click',e=>{const x=e.target.closest('[data-ed]');if(x&&x.dataset.ed==='close'){closeEdit();return}});
// Lignes de facture : saisie en direct, montant TTC recalculé
function majMontantFacture(id){const D=compute(),f=D.fact.find(x=>x.id===id);if(!f||!Array.isArray(S.factures[id].lignes)||!S.factures[id].lignes.length)return;
  const T=totauxFacture(f,D);S.factures[id].montant=Math.round(T.ttc*100)/100;saveRow('factures',id);
  const box=$('#ltot');if(box)box.innerHTML=totauxHtml(T,f);const m=document.querySelector('#edit [data-f="montant"]');if(m)m.value=S.factures[id].montant;
  document.querySelectorAll('#edit .lgn').forEach((el,i)=>{const j=el.querySelector('.lj b'),h=el.querySelector('.lj .small');if(T.lignes[i]){if(j)j.textContent=nf3.format(Math.round(T.lignes[i].jeh*1000)/1000);if(h)h.textContent=nf2.format(T.lignes[i].montant)+' € HT'}})}
document.addEventListener('input',e=>{const t=e.target;if(t.dataset&&t.dataset.ligne!==undefined&&ED&&ED.col==='factures'){
  const L=S.factures[ED.id].lignes,i=+t.dataset.ligne,k=t.dataset.lf;if(!L||!L[i])return;L[i][k]=t.type==='number'?(t.value===''?null:Number(t.value)):t.value;majMontantFacture(ED.id);return}});
document.addEventListener('input',e=>{const t=e.target;if(t.dataset&&t.dataset.fprix&&S.factures[t.dataset.fprix]){S.factures[t.dataset.fprix].prixJeh=t.value===''?null:Number(t.value);majMontantFacture(t.dataset.fprix);const T=totauxFacture(compute().fact.find(x=>x.id===t.dataset.fprix),compute());document.querySelectorAll('#edit .lgn').forEach((el,i)=>{const j=el.querySelector('.lj b');if(j&&T.lignes[i])j.textContent=nf3.format(Math.round(T.lignes[i].jeh*1000)/1000)})}});
document.addEventListener('change',e=>{const t=e.target;if(t.dataset&&t.dataset.deduire&&S.factures[t.dataset.deduire]){S.factures[t.dataset.deduire].deduire=t.checked;saveRow('factures',t.dataset.deduire);majMontantFacture(t.dataset.deduire);render()}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-lact]');if(!b||!ED||ED.col!=='factures')return;e.preventDefault();
  const f=S.factures[ED.id];if(!Array.isArray(f.lignes))f.lignes=[];const [a,x]=b.dataset.lact.split(':'),L=f.lignes;
  if(a==='add')L.push(x==='titre'?{titre:true,lib:''}:x==='frais'?{lib:'Frais de laboratoire',ttc:null,frais:true}:{lib:'',ttc:null});
  if(a==='dup'){const i=+x;if(L[i].titre){let j=i+1;while(j<L.length&&!L[j].titre)j++;const bloc=JSON.parse(JSON.stringify(L.slice(i,j)));
      const m=/^(.*?)(\d+)\s*$/.exec(bloc[0].lib||'');if(m)bloc[0].lib=m[1]+(+m[2]+1);L.splice(j,0,...bloc)} // section entière, numéro incrémenté (Échantillon 1 → 2)
    else L.splice(i+1,0,JSON.parse(JSON.stringify(L[i])))}
  if(a==='del')L.splice(+x,1);
  saveRow('factures',ED.id);majMontantFacture(ED.id);openEdit(ED.col,ED.id,ED.isNew);render();
  if(a==='add'){const ins=document.querySelectorAll('#edit [data-lf="lib"]');const z=ins[ins.length-1];if(z)z.focus()}});
document.addEventListener('input',e=>{const t=e.target;if(t.id==='q'){FLT[t.dataset.q].q=t.value;const l=$('#lst');if(l)l.innerHTML=({etudes:listEtudes,factures:listFact,temps:listTemps})[t.dataset.q](compute())}});
document.addEventListener('click',e=>{const g=e.target.closest('[data-pdf]');if(g){e.preventDefault();genererFacture(g.dataset.pdf)}});
document.addEventListener('click',e=>{const h=e.target.closest('[data-fsort]');if(h){FSORT=FSORT===h.dataset.fsort?null:h.dataset.fsort;render()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(ED||PSEC))closeEdit()});
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.eye){const i=$('#cp'),show=i.type==='password';i.type=show?'text':'password';b.setAttribute('aria-pressed',show);b.classList.toggle('on',show);b.setAttribute('aria-label',show?'Masquer le mot de passe':'Afficher le mot de passe');return}
  if(b.dataset.reconnect){sSet('suivi.pw','');location.reload();return}
  if(b.dataset.syncon){doSync();return}
  if(b.dataset.syncoff){lsSet('suivi.url','');location.reload();return}
  if(b.dataset.param){openParam(b.dataset.param);return}
  if(b.dataset.dashed){openParam('dash');return}
  if(b.dataset.goalerts){FLT.etudes.s='alert';tab='etudes';lsSet('suivi.tab',tab);render();window.scrollTo(0,0);return}
  if(b.dataset.open){openRep(b.dataset.open);return}
  if(b.dataset.openc!==undefined){OPENC=b.dataset.openc;render();window.scrollTo(0,0);return}
  if(b.dataset.closec){OPENC=null;render();return}
  if(b.dataset.editc!==undefined){ouvrirFicheClient(b.dataset.editc);return}
  if(b.dataset.eseg){ESEG=b.dataset.eseg;OPENC=null;lsSet('suivi.eseg',ESEG);render();return}
  if(b.dataset.closerep){closeRep();return}
  if(b.dataset.edit){const [c,i]=b.dataset.edit.split(':');openEdit(c,i,false);return}
  if(b.dataset.chip){const [k,v]=b.dataset.chip.split(':');FLT[k].s=v;render();return}
  if(b.dataset.eddel){if(b.dataset.arm){const {col,id}=ED;ED.isNew=false;del(col,id);closeEdit()}else{b.dataset.arm='1';b.textContent='Sûr ? Appuyez encore pour supprimer';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='Supprimer'}},3000)}return}
  if(b.dataset.tab){OPEN=null;OPENC=null;tab=b.dataset.tab;lsSet('suivi.tab',tab);render();window.scrollTo(0,0);return}
  if(b.dataset.fseg){FSEG=b.dataset.fseg;lsSet('suivi.fseg',FSEG);render();return}
  if(b.dataset.add){
    const a=b.dataset.add;
    let nid;
    if(a==='clients')nid=addRow('clients',{nom:'',contact:'',email:'',tel:'',adresse:'',notes:''});
    if(a==='etudes')nid=addRow('etudes',{date:dstr(TODAY),client:b.dataset.cl||'',num:'',resume:'',statut:'Faisabilité',facture:'',jeh:null,montant:null,echeance:''});
    const et=b.dataset.et||'';
    if(a==='factures')nid=addRow('factures',{date:dstr(TODAY),etude:et,type:'Acompte',montant:null,echeance:'',etat:'Émise',datePaiement:''});
    if(a==='temps')nid=addRow('temps',{date:dstr(TODAY),prenom:'',etude:et,note:'',min:null,nb:1,jeh:null,statut:'Pas payé'});
    if(nid)openEdit(a,nid,true);
    return}
  if(b.dataset.liadd){const c=ensureCfg();c[b.dataset.liadd].push('Nouveau statut');saveCfg();render();if(PSEC)drawParam();const l=document.querySelectorAll(`[data-li="${b.dataset.liadd}"]`);const x=l[l.length-1];if(x){x.focus();x.select()}return}
  if(b.dataset.lidel){const [k,i]=b.dataset.lidel.split(':');if(b.dataset.arm){const c=ensureCfg();c[k].splice(+i,1);saveCfg();render();if(PSEC)drawParam()}else{b.dataset.arm='1';b.textContent='Sûr ?';b.className='b warn';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.className='x'}},3000)}return}
  if(b.dataset.addmand){const c=ensureCfg();c.mandats.push({nom:'Mandat '+(new Date().getFullYear()),debut:dstr(TODAY)});saveCfg();render();if(PSEC)drawParam();return}
  if(b.dataset.delmand!==undefined){if(b.dataset.arm){const c=ensureCfg();c.mandats.splice(+b.dataset.delmand,1);saveCfg();render();if(PSEC)drawParam()}else{b.dataset.arm='1';b.textContent='Sûr ?';b.className='b warn';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.className='x'}},3000)}return}
  if(b.dataset.del){
    if(b.dataset.arm){const [col,id]=b.dataset.del.split(':');del(col,id);render()}
    else{b.dataset.arm='1';b.textContent='Sûr ?';b.className='b warn';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.className='x'}},3000)}
  }
});

/* ---------- démarrage ---------- */
async function api(body){
  const c=CONN();
  const r=await fetch(c.url,{method:'POST',body:JSON.stringify(Object.assign({token:c.token},body)),redirect:'follow'});
  const j=await r.json();
  if(j&&j.error)throw new Error(j.error);
  return j;
}
function makeDb(){
  const c=CONN();const local=!c.url;
  const subs=[];let cache=null,pending=0,loading=false;
  try{cache=JSON.parse(lsGet('suivi.cache')||'null')}catch(e){cache=null}
  if(local&&!cache)cache={};
  const colSnap=col=>({docs:Object.keys(cache[col]||{}).map(id=>({id,exists:true,data:()=>cache[col][id]}))});
  const emit=()=>subs.forEach(s=>{try{s.fire()}catch(e){}});
  const keep=()=>{try{lsSet('suivi.cache',JSON.stringify(cache))}catch(e){}};
  async function load(first){
    if(local)return;
    if(loading||pending>0||outbox.length)return;loading=true;
    try{cache=await api({action:'loadAll'});keep();stamp();if(dbErr){dbErr='';renderStatus()}emit()}
    catch(e){
      if(String(e.message)==='auth'){dbErr='Code d’accès manquant ou refusé : saisissez votre code personnel (Paramètres → Code d’accès).';renderStatus();demanderCode();subs.forEach(s=>s.err&&s.err({code:'invalid_argument'}))}
      else if(cache){dbErr='Hors connexion : dernière version enregistrée affichée, les modifications ne sont pas possibles pour le moment.';renderStatus()}
      else if(first)subs.forEach(s=>s.err&&s.err({code:'unavailable'}));
    }
    loading=false;
  }
  if(!local)setInterval(()=>{if(!document.hidden){outbox.length?flush():load(false)}},8000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){outbox.length?flush():load(false)}});
  window.addEventListener('online',()=>{outbox.length?flush():load(false)});
  setTimeout(()=>load(true),0);
  let outbox=[];try{outbox=JSON.parse(lsGet('suivi.outbox')||'[]')}catch(e){outbox=[]}
  const saveOut=()=>lsSet('suivi.outbox',JSON.stringify(outbox));
  let flushing=false;
  async function flush(){
    if(flushing)return;flushing=true;pending++;
    let conflit=0;
    try{while(outbox.length){
        try{await api(outbox[0])}
        catch(e){const m=String(e.message);
          // Conflit : quelqu'un a modifié la fiche entre-temps. On n'écrase rien : la modification est retirée et la version à jour rechargée.
          if(m==='lecture'){outbox.shift();saveOut();continue} // salarié : lecture seule, rien n'est envoyé
          if(m==='conflit'||m==='json'||m==='collection'||m==='id'||m==='taille'){conflit++;outbox.shift();saveOut();continue}
          throw e}
        outbox.shift();saveOut()}
      stamp();if(dbErr&&/Enregistrement|Hors connexion|Code d’accès/.test(dbErr)){dbErr='';renderStatus()}}
    catch(e){if(String(e.message)==='auth'){dbErr='Code d’accès manquant ou refusé : saisissez votre code personnel (Paramètres → Code d’accès). Vos modifications restent gardées sur cet appareil.';renderStatus();demanderCode()}
      else{dbErr='Hors connexion : vos modifications sont gardées sur cet appareil et partiront vers Drive dès le retour du réseau.';renderStatus()}}
    pending--;flushing=false;
    if(conflit){conflitMsg=conflit+' modification'+(conflit>1?'s n’ont':' n’a')+' pas été enregistrée'+(conflit>1?'s':'')+' : quelqu’un a modifié la même fiche entre-temps. La version à jour est affichée.';renderStatus();clearTimeout(window.__cft);window.__cft=setTimeout(()=>{conflitMsg='';renderStatus()},30000);if(!outbox.length)load(false)}
  }
  const write=(body)=>{keep();if(local){stamp();return Promise.resolve()}outbox.push(body);saveOut();flush();return Promise.resolve()};
  if(outbox.length)setTimeout(flush,0);
  return {
    sync:async()=>{if(local)return;await flush();await load(false)},
    collection(col){return {onSnapshot(next,err){const s={err,fire:()=>cache&&next(colSnap(col))};subs.push(s);if(cache)setTimeout(s.fire,0);return()=>{const i=subs.indexOf(s);if(i>=0)subs.splice(i,1)}}}},
    doc(path){const [c,i]=path.split('/');return {
      // Version attendue = version connue de la fiche ; elle est avancée de 1 tout de suite (le serveur fait +1), pour que
      // plusieurs modifications de la même fiche hors ligne s'enchaînent sans conflit.
      set:d=>{cache=cache||{};const avant=cache[c]&&cache[c][i],v=avant&&typeof avant._v==='number'?avant._v:0;const o=JSON.parse(JSON.stringify(d));delete o._v;delete o._par;delete o._le;
        (cache[c]=cache[c]||{})[i]=Object.assign({},o,{_v:v+1});return write({action:'save',col:c,id:i,json:JSON.stringify(o),expected:v,op:newId('o')})},
      delete:()=>{const avant=cache&&cache[c]&&cache[c][i],v=avant&&typeof avant._v==='number'?avant._v:0;if(cache&&cache[c])delete cache[c][i];return write({action:'delete',col:c,id:i,expected:v,op:newId('o')})},
      onSnapshot(next,err){const s={err,fire:()=>cache&&next({exists:!!(cache[c]&&cache[c][i]),data:()=>cache[c]&&cache[c][i]})};subs.push(s);if(cache)setTimeout(s.fire,0);return()=>{const k=subs.indexOf(s);if(k>=0)subs.splice(k,1)}}}}
  };
}


/* ---------- appareils connectés ---------- */
const devId=()=>{let d=lsGet('suivi.dev');if(!d){d=newId('d');lsSet('suivi.dev',d)}return d};
const guessDev=()=>{const u=navigator.userAgent||'';const m=u.match(/Android[^;]*;\s*([^)]+?)\s*(?:Build|\))/);let n=m?m[1]:/Android/.test(u)?'Android':/iPhone|iPad/.test(u)?'iPhone / iPad':'Ordinateur';return (/Mobile/.test(u)?'Téléphone':/Android/.test(u)?'Tablette':'')+(m?' ('+n+')':'')||n};
const devName=()=>lsGet('suivi.devname')||guessDev()||'Appareil';
let lastBeat=0;
function heartbeat(force){
  if(!db||!lsGet('suivi.url')||SALARIE)return;
  if(!force&&Date.now()-lastBeat<4*60000)return;lastBeat=Date.now();
  const o={nom:devName(),last:new Date().toISOString(),v:VERSION};
  S.devs=S.devs||{};S.devs[devId()]=o;db.doc('appareils/'+devId()).set(o).catch(()=>{});
}
const ago=t=>{const m=Math.round((Date.now()-new Date(t))/60000);return m<2?'à l’instant':m<60?'il y a '+m+' min':m<1440?'il y a '+Math.round(m/60)+' h':'il y a '+Math.round(m/1440)+' j'};
function devCard(){
  const u=lsGet('suivi.url');
  if(!u)return `<div class="card" style="margin-top:12px"><h3>Appareils connectés</h3><div class="small">Activez la synchronisation (Menu → Synchroniser avec mon Drive) pour voir ici vos autres appareils.</div></div>`;
  const me=devId(),devs=Object.entries(S.devs||{}).sort((a,b)=>(b[1].last||'').localeCompare(a[1].last||''));
  const rows=devs.map(([id,d])=>{const on=Date.now()-new Date(d.last)<12*60000;return `<div class="dev"><span class="dot${on?' on':''}"></span><div class="nm"><b>${esc(d.nom||'Appareil')}</b>${id===me?' <span class="small">(cet appareil)</span>':''}<div class="small">${on?'Actif':'Vu'} ${esc(ago(d.last))}</div></div>${id===me?'':`<button class="x" data-deldev="${esc(id)}" aria-label="Retirer cet appareil" title="Retirer de la liste">✕</button>`}</div>`}).join('');
  return `<div class="card" style="margin-top:12px"><h3>Appareils connectés</h3><div class="small" style="margin-bottom:6px">Les appareils qui ont ouvert l’appli avec cette synchronisation. « Actif » = vu depuis moins de 12 minutes.</div>${rows||'<div class="small">Aucun appareil pour le moment.</div>'}<label class="small" for="devn" style="display:block;margin-top:10px">Nom de cet appareil</label><input id="devn" value="${esc(devName())}" style="width:100%;margin-top:4px"></div>`;
}

/* ---------- thème ---------- */
const THEME=()=>lsGet('suivi.theme')||'auto';
function applyTheme(){const t=THEME(),r=document.documentElement;if(t==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t);
  const dark=t==='dark'||(t==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches);
  document.querySelectorAll('meta[name=theme-color]').forEach(m=>{m.removeAttribute('media');m.content=dark?'#111113':'#F6F6F7'})}
applyTheme();
try{matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyTheme)}catch(e){}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)applyTheme()});
/* ---------- menu : synchro, import, export, sauvegardes ---------- */
const VERSION=19;
const stamp=()=>{try{lsSet('suivi.last',new Date().toISOString());if(window.sheetRefresh)window.sheetRefresh()}catch(e){}};
const fmtLast=()=>{const t=lsGet('suivi.last');if(!t)return '';const d=new Date(t);if(isNaN(d))return '';return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})};
const snapData=()=>JSON.parse(JSON.stringify({etudes:S.etudes,factures:S.factures,temps:S.temps,formation:S.formation,clients:S.clients,config:S.cfg||null}));
const countData=d=>`${Object.keys(d.etudes||{}).length} études · ${Object.keys(d.factures||{}).length} factures · ${Object.keys(d.temps||{}).length} lignes de temps`;
const hasData=d=>['etudes','factures','temps','formation','clients'].some(c=>Object.keys(d[c]||{}).length);
function getBk(){try{return JSON.parse(lsGet('suivi.bk')||'[]')}catch(e){return []}}
function snap(force){
  const d=snapData();if(!hasData(d))return;
  const bk=getBk(),js=JSON.stringify(d);
  if(bk.length&&JSON.stringify(bk[0].d)===js)return;
  if(!force&&bk.length&&Date.now()-new Date(bk[0].t)<12*3600*1000)return;
  bk.unshift({t:new Date().toISOString(),d});
  while(bk.length>6)bk.pop();
  try{lsSet('suivi.bk',JSON.stringify(bk))}catch(e){bk.pop();try{lsSet('suivi.bk',JSON.stringify(bk.slice(0,3)))}catch(x){}}
}
function replaceAll(d){
  ['etudes','factures','temps','formation','clients'].forEach(col=>{
    Object.keys(S[col]).forEach(id=>{if(!(d[col]&&d[col][id]))del(col,id)});
    Object.keys(d[col]||{}).forEach(id=>{S[col][id]=JSON.parse(JSON.stringify(d[col][id]));saveRow(col,id)});
  });
  if(d.config){S.cfg=JSON.parse(JSON.stringify(d.config));saveCfg()}
  render();setTimeout(()=>snap(true),400);
}
const nrm=t=>String(t==null?'':t).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const colIdx=r=>{let n=0;for(const ch of r.replace(/[0-9]/g,''))n=n*26+ch.charCodeAt(0)-64;return n-1};
async function unzip(buf){
  const u=new Uint8Array(buf),dv=new DataView(buf);let e=u.length-22;
  while(e>=0&&dv.getUint32(e,true)!==0x06054b50)e--;
  if(e<0)throw new Error('zip');
  const n=dv.getUint16(e+10,true);let p=dv.getUint32(e+16,true);const out={};
  for(let i=0;i<n;i++){
    const m=dv.getUint16(p+10,true),cs=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),xl=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),lo=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u.subarray(p+46,p+46+nl));
    const ls=lo+30+dv.getUint16(lo+26,true)+dv.getUint16(lo+28,true),raw=u.subarray(ls,ls+cs);
    if(/\.(xml|rels)$/.test(name)){
      let bytes=raw;
      if(m===8){const ds=new DecompressionStream('deflate-raw');const w=ds.writable.getWriter();w.write(raw);w.close();bytes=new Uint8Array(await new Response(ds.readable).arrayBuffer())}
      out[name]=new TextDecoder().decode(bytes);
    }
    p+=46+nl+xl+cl;
  }
  return out;
}
async function readXlsx(buf){
  const f=await unzip(buf),X=t=>new DOMParser().parseFromString(t,'application/xml');
  const wb=X(f['xl/workbook.xml']),rels=X(f['xl/_rels/workbook.xml.rels']);
  const relT={};[...rels.getElementsByTagName('Relationship')].forEach(r=>{let t=r.getAttribute('Target');t=t.startsWith('/')?t.slice(1):'xl/'+t;relT[r.getAttribute('Id')]=t});
  const sst=[];if(f['xl/sharedStrings.xml'])[...X(f['xl/sharedStrings.xml']).getElementsByTagName('si')].forEach(si=>sst.push([...si.getElementsByTagName('t')].map(t=>t.textContent).join('')));
  const dateXf=[];
  if(f['xl/styles.xml']){
    const st=X(f['xl/styles.xml']),cust={};[...st.getElementsByTagName('numFmt')].forEach(n=>cust[n.getAttribute('numFmtId')]=n.getAttribute('formatCode'));
    const xfs=st.getElementsByTagName('cellXfs')[0];
    if(xfs)[...xfs.getElementsByTagName('xf')].forEach(x=>{const id=x.getAttribute('numFmtId');dateXf.push((+id>=14&&+id<=22)||(cust[id]&&/[dmy]/i.test(cust[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g,''))&&!/0\.0|#/.test(cust[id])))});
  }
  const out={};
  for(const sh of wb.getElementsByTagName('sheet')){
    const rid=sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sh.getAttribute('r:id');
    const xml=f[relT[rid]];if(!xml)continue;
    const rows=[];
    [...X(xml).getElementsByTagName('row')].forEach(r=>{
      const arr=[];
      [...r.getElementsByTagName('c')].forEach(c=>{
        const t=c.getAttribute('t'),v=c.getElementsByTagName('v')[0],i=c.getElementsByTagName('is')[0];let val='';
        if(t==='s'&&v)val=sst[+v.textContent]||'';
        else if(t==='inlineStr'&&i)val=[...i.getElementsByTagName('t')].map(x=>x.textContent).join('');
        else if(v){if(t==='str'||t==='e')val=v.textContent;else if(t==='b')val=v.textContent==='1';else{const num=Number(v.textContent);val=dateXf[+c.getAttribute('s')]&&num>0?new Date(Date.UTC(1899,11,30)+Math.round(num*86400000)).toISOString().slice(0,10):num}}
        const ref=c.getAttribute('r');arr[ref?colIdx(ref):arr.length]=val;
      });
      rows[+r.getAttribute('r')-1]=arr;
    });
    out[sh.getAttribute('name')]=Array.from(rows,r=>r||[]);
  }
  return out;
}
function readCsv(t){
  t=t.replace(/^﻿/,'');const first=t.split(/\r?\n/)[0]||'',sep=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<t.length;i++){const ch=t[i];
    if(q){if(ch==='"'){if(t[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
    else if(ch==='"')q=true;else if(ch===sep){row.push(cur);cur=''}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur=''}
    else cur+=ch}
  if(cur!==''||row.length){row.push(cur);rows.push(row)}
  return {Feuille:rows};
}
const toISO=v=>{if(v===''||v==null)return '';v=String(v).trim();let m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(m)return (m[3].length===2?'20'+m[3]:m[3])+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');return v};
const toNum=v=>{if(v===''||v==null)return null;if(typeof v==='number')return v;const n=Number(String(v).replace(/[\s €]/g,'').replace(',','.'));return isNaN(n)?null:n};
const SPEC={
 etudes:{p:'e',key:['client','num'],f:{date:['date','dateouverture'],client:['client'],num:['netude','numetude','num','numero','etude'],resume:['resume','objet','description'],statut:['statut','statutetude'],facture:['facture','statutfacture','statutdelafacture'],jeh:['jeh','nbjeh'],montant:['montant','montantht'],echeance:['echeance']},d:['date','echeance'],n:['jeh','montant']},
 factures:{p:'f',key:['etude','montant'],f:{date:['date'],etude:['netude','numetude','etude','num'],montant:['montant','montantht','montantttc'],note:['note','commentaire','statut']},d:['date'],n:['montant']},
 temps:{p:'t',key:['prenom','etude'],f:{date:['date'],prenom:['prenom','nom','etudiant','intervenant'],etude:['netude','numetude','etude','num'],note:['note','commentaire','tache'],min:['minutes','min','duree'],nb:['nombre','nb','nbdepersonnes','nbpersonnes'],jeh:['jeh','jehdeletude','jehetude'],statut:['statut','statutdupaiement','paiement']},d:['date'],n:['min','nb','jeh']},
 mandats:{key:['nom'],f:{nom:['nom','mandat'],debut:['debut','datededebut','datedebut'],fin:['fin','datedefin','datefin']},d:['debut','fin'],n:[]}
};
function mapSheet(kind,rows){
  const sp=SPEC[kind];let hi=rows.findIndex(r=>r&&r.filter(x=>x!==''&&x!=null).length>=2);if(hi<0)return [];
  const H=rows[hi].map(nrm),idx={};
  for(const k in sp.f){const j=H.findIndex(h=>h&&sp.f[k].includes(h));if(j>=0)idx[k]=j}
  const out=[];
  rows.slice(hi+1).forEach(r=>{
    if(!r||!r.some(x=>x!==''&&x!=null))return;
    const o={};
    for(const k in sp.f){let v=idx[k]!==undefined?r[idx[k]]:'';if(v==null)v='';
      if(sp.d.includes(k))v=toISO(v);else if(sp.n.includes(k))v=toNum(v);else v=String(v).trim();o[k]=v}
    if(sp.key.every(k=>o[k]===''||o[k]==null))return;
    out.push(o);
  });
  return out;
}
const guessKind=rows=>{const h=new Set((rows.find(r=>r&&r.filter(Boolean).length>=2)||[]).map(nrm));return h.has('client')?'etudes':h.has('prenom')||h.has('minutes')?'temps':h.has('debut')?'mandats':h.has('montant')&&(h.has('etude')||h.has('netude'))?'factures':null};
async function parseFile(file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.json')){
    const j=JSON.parse(await file.text());const d=j.data||j;
    if(!d||typeof d!=='object'||!('etudes' in d||'temps' in d||'config' in d))throw new Error('Ce fichier .json n’est pas une sauvegarde de cette appli.');
    return {kind:'json',d};
  }
  let sheets;
  if(name.endsWith('.csv')||name.endsWith('.txt'))sheets=readCsv(await file.text());
  else if(name.endsWith('.xlsx'))sheets=await readXlsx(await file.arrayBuffer());
  else throw new Error('Format non reconnu : utilisez un fichier .xlsx, .csv ou .json.');
  const res={etudes:[],factures:[],temps:[],mandats:[]};
  for(const sn of Object.keys(sheets)){
    const n=nrm(sn);let kind=n.startsWith('etude')?'etudes':n.startsWith('facture')?'factures':n.startsWith('temps')?'temps':n.startsWith('mandat')?'mandats':guessKind(sheets[sn]);
    if(kind)res[kind]=res[kind].concat(mapSheet(kind,sheets[sn]));
  }
  if(!res.etudes.length&&!res.factures.length&&!res.temps.length&&!res.mandats.length)throw new Error('Aucune donnée reconnue : utilisez le fichier modèle (feuilles Études, Factures, Temps, Mandats).');
  return {kind:'rows',rows:res};
}
function applyRows(R,replace){
  snap(true);
  [['etudes','e'],['factures','f'],['temps','t']].forEach(([col,p])=>{
    if(!R[col].length)return;
    if(replace)Object.keys(S[col]).forEach(id=>del(col,id));
    let base=replace?0:Math.max(0,...Object.values(S[col]).map(o=>o.ord||0));
    R[col].forEach((o,i)=>{const id=newId(p)+i;S[col][id]=Object.assign({ord:base+i+1},o);saveRow(col,id)});
  });
  if(R.mandats.length){const c=ensureCfg();if(replace)c.mandats=[];R.mandats.forEach(m=>{if(!c.mandats.some(x=>x.nom===m.nom))c.mandats.push({nom:m.nom,debut:m.debut,fin:m.fin})});saveCfg()}
  render();setTimeout(()=>snap(true),400);
}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
let sheetView=null,imp=null,MEMB=null,CODE=null;
function sheetHTML(){
  const u=lsGet('suivi.url'),last=fmtLast(),bk=getBk();
  const back='<button class="mb ghost" data-mn="home">‹ Retour</button>';
  if(sheetView==='addr')return `<h2>Adresse du script Google</h2><div class="small" style="margin-bottom:10px">À saisir une seule fois : adresse de l’application Web de votre script (elle finit par /exec). Vos données actuelles seront envoyées dans votre Drive si celui-ci est vide.</div><input id="syu" type="url" value="${esc(u||'')}" style="width:100%;margin-bottom:8px" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocomplete="off"><input id="syt" type="password" value="${esc(lsGet('suivi.token')||'')}" style="width:100%;margin-bottom:8px" placeholder="Code d’accès personnel" autocapitalize="off" autocomplete="off"><div class="msg" id="sym" hidden></div><button class="mb solid" data-mn="syncon">Enregistrer et synchroniser</button>${u?'<button class="mb" data-mn="syncoff">Désactiver sur cet appareil</button>':''}${back}`;
  if(sheetView==='code')return `<h2>Code d’accès personnel</h2><div class="small" style="margin-bottom:10px">Chaque membre a son propre code, donné par la trésorerie. Il est demandé une seule fois sur cet appareil.${lsGet('suivi.membre')?' Connecté en tant que <b>'+esc(lsGet('suivi.membre'))+'</b>.':''}</div><input id="syt2" type="password" style="width:100%;margin-bottom:8px" placeholder="Code d’accès" autocapitalize="off" autocomplete="off"><div class="msg" id="mm" hidden></div><button class="mb solid" data-mn="savecode">Valider</button>${lsGet('suivi.token')?'<button class="mb ghost" data-mn="forget">Oublier le code sur cet appareil</button>':''}${back}`;
  if(sheetView==='membres'){
    const adm=lsGet('suivi.admin')==='1',moi=lsGet('suivi.membre')||'';
    const liste=MEMB===null?'<div class="small">Chargement…</div>':MEMB.map(m=>`<div class="mbr${m.actif?'':' off'}"><div class="mbrn"><b>${esc(m.nom)}</b>${m.nom===moi?' <span class="small">(vous)</span>':''}<small>${m.actif?'':'Désactivé · '}${m.role==='salarie'?'Salarié : voit seulement ses données':'Membre : tous les droits'}</small>${m.actif&&m.role==='salarie'&&m.code?`<span class="mcode">${esc(m.code)}</span>`:''}</div>
      <div class="mbra">${m.actif?`${m.nom!==moi?`<select data-role="${esc(m.nom)}" aria-label="Rôle"><option value="membre"${m.role!=='salarie'?' selected':''}>Membre</option><option value="salarie"${m.role==='salarie'?' selected':''}>Salarié</option></select>`:''}${m.role==='salarie'&&m.code?`<button class="b ghost" data-mn="copiermcode" data-code="${esc(m.code)}">Copier</button>`:''}<button class="b ghost" data-mn="reinit" data-nom="${esc(m.nom)}">Nouveau code</button>${m.nom!==moi?`<button class="b ghost" data-mn="desact" data-nom="${esc(m.nom)}">Désactiver</button>`:''}`:`<button class="b ghost" data-mn="react" data-nom="${esc(m.nom)}">Réactiver</button>`}</div></div>`).join('');
    return `<div class="shead"><h2>Membres et codes d’accès</h2><button class="mx" data-mn="close" aria-label="Fermer">✕</button></div>
    ${moi?`<div class="small" style="margin-bottom:10px">Connecté : <b>${esc(moi)}</b>${adm?' · administrateur':''}</div>`:''}
    <button class="mb" data-mn="moncode"><span class="t">Changer mon code</span><span class="s">Un nouveau code est créé et enregistré sur ce téléphone</span></button>
    ${adm?`<div class="sh" style="margin:14px 2px 6px">Membres et salariés</div><div class="small" style="margin-bottom:6px">Toute personne présente dans les JEH ou la formation apparaît ici automatiquement comme Salarié, avec un code simple à lui transmettre. Passez-la en Membre pour lui donner tous les droits.</div>${liste}<button class="mb solid" data-mn="nouveau" style="margin-top:10px">+ Nouveau membre</button>`:'<div class="small" style="margin-top:12px">Seule la trésorerie (administrateur) peut créer ou désactiver les codes des membres.</div>'}
    <div class="msg" id="mm" hidden></div>${back}`;
  }
  if(sheetView==='nouveau')return `<h2>Nouveau membre</h2><div class="small" style="margin-bottom:10px">Son nom tel qu’il est saisi dans l’appli (ex. Alex.M). Un code d’accès lui sera créé.</div><input id="mnom" style="width:100%;margin-bottom:8px" placeholder="Prénom.N" autocomplete="off"><select id="mrole" style="width:100%;margin-bottom:10px"><option value="salarie">Salarié : voit seulement ses données</option><option value="membre">Membre : tous les droits</option></select><div class="msg" id="mm" hidden></div><button class="mb solid" data-mn="creer">Créer son code</button><button class="mb ghost" data-mn="membres">‹ Retour</button>`;
  if(sheetView==='codeaffiche')return `<h2>Code d’accès ${CODE.soi?'de votre téléphone':'de '+esc(CODE.nom)}</h2><div class="small" style="margin-bottom:10px">${CODE.soi?'Votre nouveau code est déjà enregistré sur ce téléphone. Notez-le pour vos autres appareils'+(CODE.role==='salarie'?'.':' : il ne sera plus affiché.'):'À transmettre en privé à '+esc(CODE.nom)+'. '+(CODE.role==='salarie'?'Il reste visible dans la liste des membres.':'Il ne sera plus affiché ; en cas de perte, créez-lui un nouveau code.')}</div><div class="codebox" id="codev">${esc(CODE.code)}</div><button class="mb solid" data-mn="copier">Copier le code</button>${navigator.share?'<button class="mb" data-mn="partager">Partager…</button>':''}<div class="msg" id="mm" hidden></div><button class="mb ghost" data-mn="membres">‹ Membres</button>`;
  if(sheetView==='import')return `<h2>Importer un fichier</h2><div class="small" style="margin-bottom:10px">Fichier modèle Excel (.xlsx), tableau .csv, ou sauvegarde .json exportée depuis l’appli.</div><input type="file" id="imf" accept=".xlsx,.csv,.txt,.json,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="width:100%"><div class="msg" id="imm" hidden></div><div id="imb"></div><button class="mb ghost" data-mn="close">Fermer</button>`;
  if(sheetView==='restore')return `<h2>Restaurer une sauvegarde</h2><div class="small" style="margin-bottom:10px">Les 6 dernières sauvegardes automatiques de cet appareil. Restaurer remplace toutes les données actuelles (une sauvegarde de l’état actuel est faite avant).</div>${bk.length?bk.map((b,i)=>`<button class="mb" data-mn="rest" data-i="${i}"><span class="t">${esc(new Date(b.t).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})+' à '+new Date(b.t).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</span><span class="s">${esc(countData(b.d))}</span></button>`).join(''):'<div class="small">Aucune sauvegarde pour le moment : elles se créent toutes seules.</div>'}<button class="mb ghost" data-mn="close">Fermer</button>`;
  return `<div class="shead"><h2>Synchronisation</h2><button class="mx" data-mn="close" aria-label="Fermer">✕</button></div>
  <div class="mrow"><button class="mb" data-mn="sync"><span class="t">Synchroniser avec mon Drive</span><span class="s">${u?(last?'Dernière sauvegarde : '+esc(last):'Pas encore synchronisé'):'Non configuré : appuyez sur le crayon'}</span></button><button class="mb sq" data-mn="addr" aria-label="Modifier l’adresse du script"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5l4 4L8 20l-5 1 1-5z"/><path d="M13 21h8"/></svg></button></div>
  <div class="msg" id="mm" hidden></div>
`;
}
function drawSheet(){const el=$('#sheet');if(!el)return;if(!sheetView){el.hidden=true;el.innerHTML='';return}el.hidden=false;el.innerHTML=`<div class="sbg" data-mn="close"></div><div class="sc" role="dialog" aria-modal="true">${sheetHTML()}</div>`}
window.sheetRefresh=()=>{if(sheetView==='home')drawSheet()};
function openSheet(v){sheetView=v;imp=null;drawSheet()}
const mmsg=(t,bad)=>{const m=$('#mm');if(m){m.textContent=t;m.className='msg'+(bad?' err':'');m.hidden=false}};
document.addEventListener('click',e=>{const b=e.target.closest('[data-deldev]');if(!b)return;if(!b.dataset.arm){b.dataset.arm='1';b.textContent='Sûr ?';b.className='b warn';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.className='x'}},3000);return}const id=b.dataset.deldev;if(S.devs)delete S.devs[id];if(db)db.doc('appareils/'+id).delete().catch(()=>{});render()});
document.addEventListener('change',async e=>{const t=e.target;if(!t.dataset||!t.dataset.role)return;const nom=t.dataset.role,role=t.value;
  if(!confirm((role==='membre'?'Donner tous les droits à ':'Limiter à ses propres données : ')+nom+' ? Un nouveau code lui sera créé.')){t.value=role==='membre'?'salarie':'membre';return}
  try{const r=await api({action:'changerRole',nom,role});CODE={nom,code:r.code,soi:false,role};openSheet('codeaffiche')}catch(x){mmsg('Changement impossible pour le moment.',1)}});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-mn]');if(!b)return;
  const a=b.dataset.mn;
  if(a==='close'){sheetView=null;drawSheet();return}
  if(['home','addr','import','restore','code','nouveau'].includes(a)){openSheet(a);return}
  if(a==='membres'){MEMB=null;openSheet('membres');if(lsGet('suivi.admin')==='1'){try{const r=await api({action:'membres'});MEMB=r.membres||[]}catch(x){MEMB=[];mmsg(String(x.message)==='admin'?'Réservé aux administrateurs.':'Liste indisponible (réseau ?).',1)}drawSheet()}return}
  if(['creer','reinit','desact','react','moncode'].includes(a)){
    const nom=a==='creer'?(($('#mnom')||{}).value||'').trim():b.dataset.nom;
    if(a==='creer'&&!nom)return mmsg('Saisissez le nom du membre.',1);
    if(a==='desact'&&!confirm('Désactiver le code de '+nom+' ? Il ne pourra plus ouvrir les données.'))return;
    if(a==='reinit'&&!confirm('Créer un nouveau code pour '+nom+' ? L’ancien ne marchera plus.'))return;
    if(a==='moncode'&&!confirm('Créer un nouveau code pour vous ? L’ancien ne marchera plus sur vos autres appareils.'))return;
    mmsg('Un instant…');
    try{const act={creer:'creerCode',reinit:'reinitialiserCode',desact:'desactiver',react:'reactiver',moncode:'changerMonCode'}[a];
      const r=await api({action:act,nom,role:a==='creer'?(($('#mrole')||{}).value||'salarie'):undefined});
      if(a==='desact'){MEMB=(await api({action:'membres'})).membres;drawSheet();return}
      const soi=a==='moncode'||(nom&&nom===lsGet('suivi.membre'));
      if(soi)lsSet('suivi.token',r.code);
      CODE={nom:r.nom||r.membre||nom,code:r.code,soi,role:r.role};openSheet('codeaffiche');
    }catch(x){const m=String(x.message);mmsg(m==='existe'?'Ce membre a déjà un code actif : utilisez « Nouveau code ».':m==='admin'?'Réservé aux administrateurs.':m==='soimeme'?'Vous ne pouvez pas vous désactiver vous-même.':'Action impossible pour le moment (réseau ?).',1)}
    return}
  if(a==='copiermcode'){try{await navigator.clipboard.writeText(b.dataset.code);mmsg('Code copié.')}catch(x){mmsg('Code : '+b.dataset.code)}return}
  if(a==='copier'){try{await navigator.clipboard.writeText(CODE.code);mmsg('Code copié.')}catch(x){const r=document.createRange();r.selectNodeContents($('#codev'));const sl=getSelection();sl.removeAllRanges();sl.addRange(r);mmsg('Sélectionnez puis copiez le code.')}return}
  if(a==='partager'){try{await navigator.share({title:'Code d’accès HAC',text:'Ton code d’accès à l’appli HAC : '+CODE.code})}catch(x){}return}
  if(a==='savecode'){const tok=(($('#syt2')||{}).value||'').trim();if(!tok)return mmsg('Saisissez votre code.',1);
    if(!lsGet('suivi.url')){lsSet('suivi.token',tok);sheetView=null;drawSheet();render();return}
    mmsg('Vérification…');try{const r=await fetch(lsGet('suivi.url'),{method:'POST',body:JSON.stringify({token:tok,action:'ping'}),redirect:'follow'}).then(r=>r.json());
      if(r&&r.error==='auth')return mmsg('Code refusé : vérifiez-le auprès de la trésorerie.',1);if(r&&r.error)return mmsg('Erreur du script : '+r.error,1);
      lsSet('suivi.token',tok);if(r.membre)lsSet('suivi.membre',r.membre);lsSet('suivi.admin',r.admin?'1':'');lsSet('suivi.role',r.role||'membre');if(r.role==='salarie')lsSet('suivi.tab','moi');location.reload()}catch(x){mmsg('Vérification impossible : vérifiez le réseau.',1)}return}
  if(a==='forget'){if(!confirm('Oublier le code d’accès sur cet appareil ?'))return;lsSet('suivi.token','');lsSet('suivi.membre','');lsSet('suivi.role','');location.reload();return}
  if(a==='sync'){
    if(!lsGet('suivi.url')){openSheet('addr');return}
    mmsg('Synchronisation…');
    try{await db.sync();stamp();drawSheet();mmsg('Synchronisé.')}catch(x){mmsg('Synchronisation impossible pour le moment.',1)}
    return}
  if(a==='logout'){lsSet('suivi.token','');location.reload();return}
  if(a==='theme'){lsSet('suivi.theme',b.dataset.v);applyTheme();render();return}
  if(a==='syncon'){doSync();return}
  if(a==='syncoff'){lsSet('suivi.url','');location.reload();return}
  if(a==='export'){
    const d=new Date().toISOString().slice(0,10);
    download('suivi-etudes-'+d+'.json',JSON.stringify({format:'suivi-etudes',version:1,date:new Date().toISOString(),data:snapData()},null,1),'application/json');
    mmsg('Fichier exporté : cherchez-le dans vos Téléchargements.');return}
  if(a==='rest'){
    if(!b.dataset.arm){b.dataset.arm='1';const t=b.querySelector('.t');b.dataset.old=t.textContent;t.textContent='Appuyez encore pour restaurer';setTimeout(()=>{if(b.isConnected&&b.dataset.arm){delete b.dataset.arm;t.textContent=b.dataset.old}},3500);return}
    const bk=getBk()[+b.dataset.i];if(!bk)return;
    snap(true);replaceAll(bk.d);sheetView=null;drawSheet();return}
  if(a==='impadd'||a==='imprep'){
    if(a==='imprep'&&!b.dataset.arm){b.dataset.arm='1';b.textContent='Appuyez encore : tout sera remplacé';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='Remplacer mes données par celles du fichier'}},3500);return}
    if(imp.kind==='json'){snap(true);replaceAll(imp.d)}else applyRows(imp.rows,a==='imprep');
    sheetView=null;drawSheet();return}
});
document.addEventListener('change',async e=>{
  if(e.target.id==='devn'){lsSet('suivi.devname',e.target.value.trim());heartbeat(true);return}
  if(e.target.id!=='imf')return;
  const f=e.target.files[0],m=$('#imm'),box=$('#imb');if(!f)return;
  const say=(t,bad)=>{m.textContent=t;m.className='msg'+(bad?' err':'');m.hidden=false};
  say('Lecture du fichier…');box.innerHTML='';
  try{
    imp=await parseFile(f);
    if(imp.kind==='json'){
      say('Sauvegarde reconnue : '+countData(imp.d)+'.');
      box.innerHTML='<button class="mb solid" data-mn="imprep">Remplacer mes données par celles du fichier</button>';
    }else{
      const R=imp.rows;
      say('Fichier reconnu : '+R.etudes.length+' études · '+R.factures.length+' factures · '+R.temps.length+' lignes de temps · '+R.mandats.length+' mandats.');
      box.innerHTML='<button class="mb solid" data-mn="impadd">Ajouter à mes données</button><button class="mb" data-mn="imprep">Remplacer mes données par celles du fichier</button>';
    }
  }catch(x){imp=null;say(x.message||'Lecture impossible.',1)}
});

function afterSnap(){if(dirty){pendingRender=true;return}render()}
document.addEventListener('focusout',()=>{if(pendingRender&&!dirty){pendingRender=false;setTimeout(render,0)}});
render();
(async function(){
  if(!UNLOCKED())return;
  db=makeDb();
  if(userCap){try{const w=userCap.can&&userCap.can('data.write');if(w===false)canWrite=false}catch(e){}}
  if(!db){return}
  const timer=setTimeout(()=>{timeoutNote=true;renderStatus()},10000);
  const clear=()=>{if(Object.values(loaded).every(Boolean)){clearTimeout(timer);timeoutNote=false;renderStatus()}};
  const fail=e=>{dbErr=(e&&e.code==='revoked')?'L’accès aux données a été retiré.':'Lecture des données impossible pour le moment.';renderStatus()};
  ['etudes','factures','temps','formation','clients'].forEach(col=>{
    db.collection(col).onSnapshot(snap=>{const o={};snap.docs.forEach(d=>{o[d.id]=Object.assign({},d.data())});S[col]=o;loaded[col]=true;clear();afterSnap()},fail);
  });
  db.collection('appareils').onSnapshot(snap=>{const o={};snap.docs.forEach(d=>{o[d.id]=Object.assign({},d.data())});S.devs=o;if(tab==='params')afterSnap()},()=>{});
  setInterval(()=>{if(!document.hidden)heartbeat(false)},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)heartbeat(false)});setTimeout(()=>heartbeat(true),2500);
  db.doc('config/main').onSnapshot(s=>{S.cfg=s.exists?Object.assign({},s.data()):null;loaded.cfg=true;clear();afterSnap();if(Object.values(loaded).every(Boolean)&&!window.__snapped){window.__snapped=1;setTimeout(()=>snap(false),1500)}},fail);
})();
})();
