(function(){
"use strict";
/* ---------- utilitaires ---------- */
const $=(s,e)=>(e||document).querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const nf2=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const nf3=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3});
const eur=n=>nf2.format(n||0)+' €';
const eur0=n=>nf0.format(Math.round(n||0))+' €';
const num=v=>(v===null||v===undefined||v===''||isNaN(Number(v)))?0:Number(v);
const isNum=v=>v!==null&&v!==undefined&&v!==''&&!isNaN(Number(v));
const dnum=s=>{if(!s)return null;const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);return m?Date.UTC(+m[1],+m[2]-1,+m[3])/864e5:null};
const dstr=n=>new Date(n*864e5).toISOString().slice(0,10);
const now=new Date();const TODAY=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/864e5;
const fdate=n=>{const d=new Date(n*864e5);return d.toLocaleDateString('fr-FR',{timeZone:'UTC'})};
const MOIS=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const CONN=()=>({url:lsGet('suivi.url')||'',tok:lsGet('suivi.tok')||''});

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
const S={etudes:{},factures:{},temps:{},formation:{},cfg:null};
let loaded={etudes:false,factures:false,temps:false,formation:false,cfg:false};
let db=null,userCap=null,canWrite=true,tab=lsGet('suivi.tab')||'dash',mandatSel=lsGet('suivi.mandat')||'Tous les mandats';
let dirty=false,pendingRender=false,timeoutNote=false,dbErr='';
const cfg=()=>{const c=S.cfg||{};const d=DEFAULT_CFG;return Object.assign({},d,c,{cot:Object.assign({},d.cot,c.cot),patr:Object.assign({},d.patr,c.patr),cnje:Object.assign({},d.cnje,c.cnje)})};
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
function addRow(col,defaults){const id=newId(col[0]);S[col][id]=Object.assign({ord:Date.now()},defaults);saveRow(col,id);render()}

/* ---------- calculs ---------- */
function mandatOf(dn,c){if(dn===null)return '';for(const m of c.mandats){const a=dnum(m.debut),b=dnum(m.fin);if(a!==null&&b!==null&&dn>=a&&dn<=b)return m.nom}return ''}
function compute(){
  const c=cfg(),tva=c.tva,etudes=sorted('etudes'),fact=sorted('factures'),temps=sorted('temps');
  const chom=num(c.chomage);
  const patrTot=Object.values(c.patr).reduce((a,v)=>a+num(v),0);
  const cotTot=Object.values(c.cot).reduce((a,v)=>a+num(v),0);
  const baseJEH=4*num(c.smic);
  const cnjeDate=dnum(c.cnje.date);
  fact.forEach(f=>{f.d=dnum(f.date);f.mandat=mandatOf(f.d,c)});
  temps.forEach(t=>{t.d=dnum(t.date);t.mandat=mandatOf(t.d,c);t.I=(isNum(t.min)&&num(t.nb)>0)?num(t.min)/480/num(t.nb):null;t.J=t.I===null?null:t.I*num(t.jeh);t.stat=t.statut||'Pas payé'});
  const byEtude={};temps.forEach(t=>{if(t.etude)(byEtude[t.etude]=byEtude[t.etude]||[]).push(t)});
  const personEtude={};temps.forEach(t=>{if(t.prenom&&t.etude&&t.I!==null){const k=t.etude+'\u0001'+t.prenom;personEtude[k]=(personEtude[k]||0)+t.I}});
  const nums={};etudes.forEach(e=>{if(e.num)nums[e.num]=(nums[e.num]||0)+1});
  etudes.forEach(e=>{
    e.d=dnum(e.date);e.mandat=mandatOf(e.d,c);
    const pays=fact.filter(f=>f.etude===e.num&&e.num);
    e.K=e.num?pays.reduce((a,f)=>a+num(f.montant),0):0;
    e.J=(num(e.jeh)&&num(e.montant))?num(e.montant)/(1+tva)/num(e.jeh):null;
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
    e.alerts=alertsOf(e,c,ls,nums,personEtude,fact);
  });
  return {c,etudes,fact,temps,tva,chom,patrTot,cotTot,baseJEH,personEtude};
}
function alertsOf(e,c,ls,nums,pe,fact){
  const A=[],st=e.statut,fa=e.facture,ech=dnum(e.echeance),tva=c.tva;
  const L=num(e.L),K=num(e.K),I=num(e.montant);
  if(INVOICED.includes(fa)&&ech!==null&&ech<TODAY){const r=TODAY-ech;A.push('Retard de '+r+' j'+(r>c.relance2?' : 2e relance':(r>=c.relance1?' : 1re relance par mail':'')))}
  if(st==='Archivée'&&L>0)A.push('Archivée mais reste à encaisser');
  if(st==='Archivée'&&fa!=='Solde encaissé')A.push('Archivée sans solde encaissé');
  if(st==='Archivée'&&e.N==='À payer')A.push('Archivée mais BV non payés');
  if(I>0&&K>I)A.push('Encaissé supérieur au montant');
  if(['Convention signée','Convention étudiant avant réalisation','En réalisation'].includes(st)&&!fa)A.push('Facturer l’acompte');
  if(INVOICED.includes(fa)&&ech===null&&st!=='Archivée'&&st!=='Refusé / sans suite')A.push('Renseigner l’échéance de paiement');
  if(st==='En réalisation'&&!ls.length)A.push('Renseigner le temps de travail (onglet Temps de travail)');
  if(ls.length&&!isNum(e.jeh))A.push('Prix de la JEH manquant : rémunérations calculées à 0 €');
  const sumJ=ls.reduce((a,t)=>a+num(t.J),0);
  if(I>0&&sumJ>I/(1+tva)+1e-9)A.push('Rémunérations supérieures au montant HT');
  if(fa==='Solde encaissé'&&st!=='Archivée'&&e.N==='À payer')A.push('Payer les BV');
  if(fa==='Solde encaissé'&&st!=='Archivée'&&st!=='Refusé / sans suite'&&I>0&&e.N!=='À payer'&&L<=0)A.push('Tout est soldé : archiver l’étude');
  if(st==='Refusé / sans suite'&&(fa||K>0))A.push('Étude refusée mais facturée');
  if(fa==='Solde encaissé'&&L>0)A.push('Solde encaissé mais reste à encaisser');
  if(e.num&&fa!=='Solde encaissé'&&fact.some(f=>f.etude===e.num&&f.note==='Solde encaissé'))A.push('Solde encaissé (Factures) mais statut Facture différent');
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
  return {paidI:sI(paid),paidJ:sJ(paid),unpI:sI(unp),unpJ:sJ(unp),cost:f(sI(unp),sJ(unp))+f(sI(paid),sJ(paid))};
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
  const encTTC=all?D.etudes.reduce((a,e)=>a+e.K,0):D.fact.filter(f=>f.mandat===sel).reduce((a,f)=>a+num(f.montant),0);
  const enc=encTTC/tva1;
  const persN=persons(D);
  const dep=persN.reduce((a,p)=>a+costOf(D,p,t=>all||t.mandat===sel).cost,0);
  const ca=sumBy(E,e=>e.montant,SIGNED)/tva1,reste=sumBy(E,e=>e.L,SIGNED)/tva1;
  const archive=sumBy(E,e=>e.montant,['Archivée'])/tva1;
  const retard=all?D.etudes.filter(e=>INVOICED.includes(e.facture)&&dnum(e.echeance)!==null&&dnum(e.echeance)<TODAY).reduce((a,e)=>a+num(e.L),0)/tva1:0;
  const jehF=sumBy(E,e=>e.J,SIGNED),jehR=D.temps.filter(t=>all||t.mandat===sel).reduce((a,t)=>a+num(t.I),0);
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
  if(all){const ds=D.fact.map(f=>f.d).filter(d=>d!==null);if(ds.length){const m=new Date(Math.min(...ds)*864e5);t0=Date.UTC(m.getUTCFullYear(),m.getUTCMonth(),1)/864e5}else t0=TODAY;t1=TODAY}
  else{const m=mand.find(m=>m.nom===sel);t0=m&&m.a!==null?m.a:TODAY;t1=m&&m.b!==null?m.b:TODAY}
  const pts=[];for(let k=0;k<50;k++)pts.push(t0+Math.round(k*(t1-t0)/49));
  const ser={enc:[],dep:[],tot:[],fid:[]};
  pts.forEach(T=>{
    const na=!all&&T>TODAY;
    if(na){ser.enc.push(null);ser.dep.push(null);ser.tot.push(null);ser.fid.push(null);return}
    ser.enc.push(D.fact.filter(f=>f.d!==null&&f.d<=T&&(all||f.mandat===sel)).reduce((a,f)=>a+num(f.montant),0)/tva1);
    ser.dep.push(D.temps.filter(t=>t.d!==null&&t.d<=T&&t.I!==null&&!['A venir','Non effectué'].includes(t.stat)&&(all||t.mandat===sel)).reduce((a,t)=>a+num(t.J)*(1+D.chom)+t.I*D.baseJEH*D.patrTot,0));
    if(all){ser.tot.push(cli.filter(x=>x.first<=T).length);ser.fid.push(cli.filter(x=>x.fid!==null&&x.fid<=T).length)}
    else{ser.tot.push(cmList.filter(x=>x.mandat===sel&&x.first<=T).length);ser.fid.push(cmList.filter(x=>x.mandat===sel&&x.prev>0&&x.first<=T).length)}
  });
  const withAlert=D.etudes.filter(e=>e.alerts.length);
  return {all,enc,dep,recette:enc-dep,ca,reste,archive,retard,jehF,jehR,nbSigned,groups,enCours,archivees:cnt('Archivée'),refusees:cnt('Refusé / sans suite'),nouveaux,fideles,pts,ser,withAlert,nbAlerts:withAlert.reduce((a,e)=>a+e.alerts.length,0)};
}

/* ---------- graphiques SVG ---------- */
const PAL=['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];
function donut(parts,center,sub){
  const tot=parts.reduce((a,p)=>a+p.v,0),R=62,C=2*Math.PI*R;let off=0,segs='';
  if(tot>0)parts.forEach(p=>{if(p.v<=0)return;const len=C*p.v/tot;segs+=`<circle cx="90" cy="90" r="${R}" fill="none" stroke="${p.c}" stroke-width="30" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`;off+=len});
  else segs=`<circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--line)" stroke-width="30"/>`;
  return `<svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="${esc(sub)}">${segs}<text class="ctr" x="90" y="92" text-anchor="middle" dominant-baseline="middle" style="font-size:36px">${center}</text></svg>`;
}
function legendHtml(parts){return '<div class="legend">'+parts.map(p=>`<span><i style="background:${p.c}"></i>${esc(p.l)} · ${p.v}</span>`).join('')+'</div>'}
function smooth(a){const f=(x,i)=>x[i]===null?null:((x[i-1]==null?x[i]:x[i-1])+2*x[i]+(x[i+1]==null?x[i]:x[i+1]))/4;const o=a.map((_,i)=>f(a,i));return o}
function lineChart(pts,series,fmt,int){
  const W=560,H=230,pl=44,pr=10,pt=12,pb=26;
  const sm=series.map(s=>({c:s.c,l:s.l,a:smooth(smooth(s.v)),area:s.area}));
  let mx=0;sm.forEach(s=>s.a.forEach(v=>{if(v!==null&&v>mx)mx=v}));if(mx<=0)mx=1;
  const nice=int?Math.max(4,Math.ceil(mx/4)*4):(()=>{const p=Math.pow(10,Math.floor(Math.log10(mx)));const m=mx/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p})();
  const X=i=>pl+(W-pl-pr)*i/(pts.length-1),Y=v=>pt+(H-pt-pb)*(1-v/nice);
  let g='';for(let k=0;k<=4;k++){const v=nice*k/4,y=Y(v);g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl-6}" y="${y+3}" text-anchor="end">${fmt(v)}</text>`}
  let lastLab=-99;pts.forEach((T,i)=>{const d=new Date(T*864e5),prev=i?new Date(pts[i-1]*864e5):null;if((!prev||prev.getUTCMonth()!==d.getUTCMonth())&&i-lastLab>=7&&i<=pts.length-4){lastLab=i;g+=`<text x="${X(i)}" y="${H-8}" text-anchor="middle">${MOIS[d.getUTCMonth()]}${d.getUTCMonth()===0||i===0?' '+String(d.getUTCFullYear()).slice(2):''}</text>`}});
  sm.forEach(s=>{let d='',started=false,lastI=0;s.a.forEach((v,i)=>{if(v===null)return;d+=(started?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);started=true;lastI=i});
    if(!d)return;
    if(s.area)g+=`<path d="${d}L${X(lastI)} ${Y(0)}L${X(s.a.findIndex(v=>v!==null))} ${Y(0)}Z" fill="${s.c}" opacity=".22"/>`;
    g+=`<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`});
  return `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div><div class="legend">${sm.map(s=>`<span><i style="background:${s.c}"></i>${esc(s.l)}</span>`).join('')}</div>`;
}

/* ---------- champs de saisie ---------- */
const attr=(c,id,f)=>`data-c="${c}" data-id="${id}" data-f="${f}"`;
const inT=(c,r,f,ph)=>`<input ${attr(c,r.id,f)} value="${esc(r[f])}" placeholder="${esc(ph||'')}">`;
const inN=(c,r,f)=>`<input type="number" step="any" inputmode="decimal" ${attr(c,r.id,f)} value="${r[f]===null||r[f]===undefined?'':esc(r[f])}">`;
const inD=(c,r,f)=>`<input type="date" ${attr(c,r.id,f)} value="${esc(r[f])}">`;
const sel=(c,r,f,opts,blank)=>{const v=r[f]||'';const o=opts.slice();if(v&&!o.includes(v))o.push(v);return `<select ${attr(c,r.id,f)}>${blank!==false?'<option value=""></option>':''}${o.map(x=>`<option${x===v?' selected':''}>${esc(x)}</option>`).join('')}</select>`};
const delBtn=(c,id)=>`<button class="x" data-del="${c}:${id}" title="Supprimer la ligne" aria-label="Supprimer la ligne">✕</button>`;

/* ---------- vues ---------- */
const TABS=[['dash','Tableau de bord'],['etudes','Suivi des études'],['factures','Factures'],['temps','Temps de travail'],['remun','Rémunérations'],['formation','Qualité formation'],['params','Paramètres'],['legende','Légende']];
function renderNav(){$('#nav').innerHTML=TABS.map(([k,l])=>`<button data-tab="${k}" aria-current="${k===tab}">${l}</button>`).join('')}
function renderStatus(){
  let h='';
  if(timeoutNote)h+='<div class="msg">Les données sont encore en cours de chargement : si ce message reste, vérifiez la connexion.</div>';
  if(dbErr)h+='<div class="msg err">'+esc(dbErr)+'</div>';
  if(CONN().url)h+='<div class="small" style="margin:4px 0"><button class="b ghost" data-reconnect="1" style="padding:4px 10px;font-size:12.5px">Changer la connexion</button></div>';
  if(db&&!canWrite)h+='<div class="msg">Lecture seule : vous ne pouvez pas modifier ces données.</div>';
  $('#status').innerHTML=h;
}
function renderConnect(){
  $('#view').innerHTML=`<div class="card" style="max-width:520px"><h2>Connexion à vos données</h2><div class="small" style="margin-bottom:10px">À faire une seule fois sur cet appareil. L’adresse et le code secret viennent de votre script Google (voir les étapes).</div>
  <label class="small" for="cu">Adresse du script (URL de l’application Web)</label><input id="cu" style="width:100%;margin:4px 0 10px" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocomplete="off">
  <label class="small" for="ct">Code secret</label><input id="ct" type="password" style="width:100%;margin:4px 0 12px" autocomplete="off">
  <button class="b" data-connect="1">Se connecter</button></div>`;
}
function addBtn(label,act){return `<div class="plus"><button class="b" data-add="${act}">+ ${label}</button></div>`}
function render(){
  renderNav();renderStatus();$('#today').textContent='Mis à jour le '+fdate(TODAY);
  const v=$('#view');
  if(!db&&!CONN().url){renderConnect();if(window.hideSplash)window.hideSplash();return}
  const ready=Object.values(loaded).every(Boolean);
  if(!ready){v.innerHTML='<div class="card">Chargement des données…</div>';return}
  const active=document.activeElement,fk=active&&active.dataset&&active.dataset.c?active.dataset.c+'|'+active.dataset.id+'|'+active.dataset.f:null,scrollY=window.scrollY;
  const D=compute();
  const views={dash:vDash,etudes:vEtudes,factures:vFactures,temps:vTemps,remun:vRemun,formation:vFormation,params:vParams,legende:vLegende};
  const scrolls=[...document.querySelectorAll('.tw')].map(e=>e.scrollLeft);
  v.innerHTML=views[tab](D);
  if(window.hideSplash)window.hideSplash();
  document.querySelectorAll('.tw').forEach((e,i)=>{if(scrolls[i])e.scrollLeft=scrolls[i]});
  if(fk){const [c,id,f]=fk.split('|');const el=v.querySelector(`[data-c="${c}"][data-id="${id}"][data-f="${f}"]`);if(el){el.focus({preventScroll:true});try{if(el.setSelectionRange&&el.type!=='number'&&el.type!=='date')el.setSelectionRange(el.value.length,el.value.length)}catch(e){}}}
  window.scrollTo(0,scrollY);
}
function vDash(D){
  const c=D.c;const M=['Tous les mandats'].concat(c.mandats.map(m=>m.nom));if(!M.includes(mandatSel))mandatSel='Tous les mandats';
  const d=dash(D,mandatSel);
  const sel=`<div class="row" style="margin:4px 0 12px"><label for="msel" class="small">Mandat affiché</label><select id="msel">${M.map(m=>`<option${m===mandatSel?' selected':''}>${esc(m)}</option>`).join('')}</select></div>`;
  const n=d.withAlert.length;
  const banner=n===0?'<div class="banner ok">Tout est à jour : aucune alerte à traiter</div>':`<div class="banner">${n} étude(s) à traiter · ${d.nbAlerts} alerte(s)</div>`;
  const kpi=(l,v,note)=>`<div class="card kpi"><div class="lab">${l}</div><div class="val">${v}</div><div class="note">${note}</div></div>`;
  const vue=[{l:'En cours',v:d.enCours,c:PAL[0]},{l:'Archivées',v:d.archivees,c:PAL[2]},{l:'Refusées',v:d.refusees,c:PAL[3]}];
  const det=Object.keys(d.groups).map((k,i)=>({l:k,v:d.groups[k],c:PAL[i%6]}));
  const al=d.withAlert.slice(0,6);
  const R=remun(D);
  const alHtml=al.length?`<ul class="al">${al.map(e=>`<li><b>${esc(e.num||'(sans n°)')}</b> · ${esc(e.alerts.join(' · '))}</li>`).join('')}</ul>`:'<div class="small">Rien à signaler.</div>';
  const mf=v=>nf0.format(v);
  return sel+banner+`
  <div class="grid k3">
    ${kpi('RECETTE',eur0(d.recette),d.all?'encaissé − dépenses':esc(mandatSel))}
    ${kpi('CA SIGNÉ HT',eur0(d.ca),d.all?'dont archivé : '+nf0.format(Math.round(d.archive))+' €':esc(mandatSel))}
    ${kpi('RESTE À ENCAISSER HT',eur0(d.reste),d.all?'dont en retard : '+nf0.format(Math.round(d.retard))+' €':esc(mandatSel))}
  </div>
  <div class="grid">
    <div class="card"><h3>Où en sont les études ?</h3><div class="hint">Vue d’ensemble</div><div class="donutbox">${donut(vue,d.enCours,'Études en cours')}</div>${legendHtml(vue)}</div>
    <div class="card"><h3>Détail des études en cours</h3><div class="hint">Nombre d’études par statut</div><div class="donutbox">${donut(det,d.enCours,'Détail des études en cours')}</div>${legendHtml(det)}</div>
    <div class="card"><h3>Alertes à traiter</h3><div class="hint">${n>6?'6 premières sur '+n+' · ':''}Détail : onglet Suivi des études</div>${alHtml}</div>
  </div>
  <div class="grid">
    <div class="card"><h3>Temps de travail (JEH)</h3><div class="hint">d’après le suivi</div>
      <div class="stat big"><span>JEH facturées</span><span>${nf3.format(Math.round(d.jehF*1000)/1000)}</span></div>
      <div class="stat big"><span>JEH rémunérées</span><span>${nf3.format(Math.round(d.jehR*1000)/1000)}</span></div>
      <div class="stat"><span>Études signées</span><span>${d.nbSigned}</span></div></div>
    <div class="card"><h3>Chiffre d’affaires net et dépenses</h3><div class="hint">&nbsp;</div>
      <div class="stat big"><span>Encaissé HT</span><span>${eur0(d.enc)}</span></div>
      <div class="stat big"><span>Dépenses (coût total des embauches)</span><span>${eur0(d.dep)}</span></div>
      <div class="small" style="margin-top:6px">${d.enc===0?'Aucun CA encaissé':Math.round(d.dep/d.enc*100)+' % du CA encaissé en dépenses salariales'}</div></div>
    <div class="card"><h3>Clients</h3><div class="hint">Nouveaux et fidèles</div>
      <div class="stat big"><span>Nouveaux clients</span><span>${d.nouveaux}</span></div>
      <div class="stat big"><span>Clients fidèles</span><span>${d.fideles}</span></div></div>
    <div class="card"><h3>Rémunérations</h3><div class="hint">JEH non payées, regroupées par personne</div>
      <div class="stat"><span>Brut à payer</span><span>${eur(R.T.brut)}</span></div>
      <div class="stat"><span>Cotisations salariales (retenues)</span><span>${eur(R.T.brut-R.T.net)}</span></div>
      <div class="stat big"><span>Net à virer aux élèves</span><span>${eur(R.T.net)}</span></div>
      <div class="stat"><span>Charges patronales (estim.)</span><span>${eur(R.T.cout-R.T.brut)}</span></div>
      <div class="stat big"><span>Coût total pour la Junior</span><span>${eur(R.T.cout)}</span></div>
      <div class="small" style="margin-top:6px">Estimations : taux dans Paramètres, 1 JEH minimum.</div></div>
  </div>
  <div class="two">
    <div class="card"><h3>Encaissé et dépenses</h3><div class="hint">${d.all?'Cumul HT · tout l’historique':'Cumul HT · '+esc(mandatSel)}</div>${lineChart(d.pts,[{c:'var(--c1)',l:'Encaissé HT',v:d.ser.enc,area:true},{c:'var(--c3)',l:'Dépenses',v:d.ser.dep}],v=>mf(v)+' €')}</div>
    <div class="card"><h3>Clients totaux et fidèles</h3><div class="hint">Cumul · en rose = les clients fidèles</div>${lineChart(d.pts,[{c:'var(--c3)',l:'Clients totaux',v:d.ser.tot,area:true},{c:'var(--c1)',l:'Clients fidèles',v:d.ser.fid}],v=>String(Math.round(v)),true)}</div>
  </div>`;
}
function vEtudes(D){
  const c=D.c;
  const rows=D.etudes.map(e=>`<tr>
   <td>${inD('etudes',e,'date')}</td><td class="a">${esc(e.mandat)}</td><td>${inT('etudes',e,'client')}</td><td>${inT('etudes',e,'num')}</td><td style="min-width:150px">${inT('etudes',e,'resume')}</td>
   <td>${sel('etudes',e,'statut',c.statuts)}</td><td>${sel('etudes',e,'facture',c.factures)}</td><td>${inN('etudes',e,'jeh')}</td><td>${inN('etudes',e,'montant')}</td>
   <td class="a n">${e.J===null?'':nf3.format(Math.round(e.J*1000)/1000)}</td><td class="a n">${eur(e.K)}</td><td class="a n">${e.L===null?'':eur(e.L)}</td>
   <td>${inD('etudes',e,'echeance')}</td><td class="a">${esc(e.N)}</td><td class="a al">${esc(e.alerts.join(' · '))}</td>
   <td class="a n">${e.P===null?'':Math.round(e.P*100)+' %'}</td><td class="a">${e.cnje?'Oui':''}</td><td class="a n">${e.R===null?'':nf3.format(Math.round(e.R*1000)/1000)}</td><td class="a n">${e.S===null?'':eur(e.S)}</td><td>${delBtn('etudes',e.id)}</td></tr>`).join('');
  return `<h2>Suivi des études</h2><div class="small">Cases claires : à saisir. Cases teintées : calculées (mandat, JEH facturées, encaissé d’après l’onglet Factures, reste, BV d’après Temps de travail, alertes).</div>${addBtn('Ajouter une étude','etudes')}
  <div class="tw"><table><thead><tr><th>Date de création</th><th>Mandat</th><th>Client</th><th>N° d’étude</th><th>Résumé</th><th>Statut</th><th>Facture</th><th>JEH client HT</th><th>Montant TTC</th><th>Nb JEH facturées</th><th>Encaissé TTC</th><th>Reste à encaisser (TTC)</th><th>Échéance paiement</th><th>BV</th><th>Alertes</th><th>Dépenses embauches / HT</th><th>CNJE</th><th>JEH rémunérées</th><th>JEH interv. max HT</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="20" class="small" style="padding:14px">Aucune étude pour le moment.</td></tr>'}</tbody></table></div>`;
}
function vFactures(D){
  const rows=D.fact.map(f=>`<tr><td class="a">${esc(f.mandat)}</td><td>${inD('factures',f,'date')}</td><td>${selEtude('factures',f,'etude',D)}</td><td>${inN('factures',f,'montant')}</td><td>${sel('factures',f,'note',D.c.factures)}</td><td>${delBtn('factures',f.id)}</td></tr>`).join('');
  return `<h2>Factures : une ligne par paiement reçu</h2><div class="small">Date du paiement, étude, montant TTC reçu. La colonne « Encaissé TTC » du suivi est la somme des paiements de l’étude ; le mandat se déduit de la date (voir les mandats dans Paramètres).</div>${addBtn('Ajouter un paiement','factures')}
  <div class="tw"><table><thead><tr><th>Mandat</th><th>Date</th><th>Étude</th><th>Montant TTC encaissé</th><th>Note</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="small" style="padding:14px">Aucun paiement enregistré.</td></tr>'}</tbody></table></div>`;
}
function selEtude(c,r,f,D){return sel(c,r,f,D.etudes.map(e=>e.num).filter(Boolean))}
function vTemps(D){
  const names=persons(D);
  const rows=D.temps.map(t=>`<tr><td class="a">${esc(t.mandat)}</td><td>${inD('temps',t,'date')}</td><td><input list="pl" ${attr('temps',t.id,'prenom')} value="${esc(t.prenom)}"></td><td>${selEtude('temps',t,'etude',D)}</td><td>${inT('temps',t,'note')}</td><td>${inN('temps',t,'min')}</td><td>${inN('temps',t,'nb')}</td><td>${inN('temps',t,'jeh')}</td>
   <td class="a n">${t.I===null?'':nf3.format(Math.round(t.I*10000)/10000)}</td><td class="a n">${t.J===null?'':eur(t.J)}</td><td>${sel('temps',{id:t.id,statut:t.stat},'statut',BV_STAT,false)}</td><td>${delBtn('temps',t.id)}</td></tr>`).join('');
  return `<h2>Temps de travail : qui a travaillé combien, et combien lui verser</h2><div class="small">JEH rémunérée = minutes ÷ 480 ÷ nombre de personnes. Rémunération brute = JEH rémunérée × JEH intervenant HT. Les lignes « Payé », « A venir » ou « Non effectué » ne sont pas à payer.</div>${addBtn('Ajouter une ligne de temps','temps')}
  <datalist id="pl">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
  <div class="tw"><table><thead><tr><th>Mandat</th><th>Date</th><th>Prénom</th><th>Étude</th><th>Note</th><th>Min travaillées</th><th>Nb de personnes</th><th>JEH intervenant HT</th><th>JEH rémunérée</th><th>Rémunération brute</th><th>Statut</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="12" class="small" style="padding:14px">Aucune ligne de temps.</td></tr>'}</tbody></table></div>`;
}
function vRemun(D){
  const R=remun(D);
  const rows=R.rows.map(r=>`<tr><td>${esc(r.nom)}</td><td class="n">${nf3.format(r.jehPay)}</td><td class="n">${eur(r.dejaPaye)}</td><td class="n">${nf3.format(r.jeh)}</td><td class="n">${eur(r.brut)}</td><td class="n">${eur(r.net)}</td><td class="n">${eur(r.cout)}</td></tr>`).join('');
  const T=R.T;
  return `<h2>Rémunérations : ce qu’il reste à payer</h2><div class="small">Page automatique : rien à saisir. Pour chaque personne, elle regroupe les JEH du journal ni « Payé », ni « A venir », ni « Non effectué », puis calcule dessus brut, net (après cotisations salariales) et coût Junior. En dessous de 1 JEH au total, cotisations et charges sont calculées sur 1 JEH (minimum fixe). Passez les lignes d’un BV à « Payé » et la personne repart à zéro.</div>
  <div class="tw" style="margin-top:12px"><table><thead><tr><th>Nom</th><th>JEH payées</th><th>Déjà payé (brut)</th><th>JEH non payées</th><th>Brut à payer</th><th>Net à virer</th><th>Coût total Junior</th></tr></thead><tbody>
  <tr style="font-weight:700;background:var(--card2)"><td>Total</td><td class="n">${nf3.format(T.jehPay)}</td><td class="n">${eur(T.dejaPaye)}</td><td class="n">${nf3.format(Math.round(T.jeh*1e6)/1e6)}</td><td class="n">${eur(T.brut)}</td><td class="n">${eur(T.net)}</td><td class="n">${eur(T.cout)}</td></tr>${rows||'<tr><td colspan="7" class="small" style="padding:14px">Personne pour le moment.</td></tr>'}</tbody></table></div>`;
}
function vFormation(D){
  const names=persons(D);Object.keys(S.formation).forEach(id=>{const n=S.formation[id].nom;if(n&&!names.includes(n))names.push(n)});
  const open=D.etudes.filter(e=>e.num&&e.statut!=='Archivée'&&e.statut!=='Refusé / sans suite'),closed=D.etudes.filter(e=>e.num&&(e.statut==='Archivée'||e.statut==='Refusé / sans suite'));
  const cols=open.concat(closed);
  const LV=['0 · Non formé','1 · Notions','2 · Autonome avec appui','3 · Autonome','4 · Référent (peut former)'];
  const key=n=>'f_'+n.toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const head=cols.map(e=>`<th style="${closed.includes(e)?'opacity:.6':''}">${esc(e.num)}<div class="small" style="font-weight:400">${esc(e.statut||'')}</div></th>`).join('');
  const body=names.map(n=>{const doc=S.formation[key(n)]||{niveaux:{}};const vals=cols.map(e=>doc.niveaux&&isNum(doc.niveaux[e.num])?num(doc.niveaux[e.num]):null).filter(v=>v!==null);
    const avg=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    return `<tr><td style="white-space:nowrap;padding:6px 10px"><b>${esc(n)}</b></td><td class="n" style="min-width:56px">${avg===null?'':(Math.round(avg*10)/10)}</td>${cols.map(e=>{const v=doc.niveaux&&isNum(doc.niveaux[e.num])?num(doc.niveaux[e.num]):'';return `<td><select data-lvl="${esc(n)}" data-etude="${esc(e.num)}" class="${v===''?'':'lv'+v}"><option value=""></option>${[0,1,2,3,4].map(k=>`<option value="${k}"${v===k?' selected':''}>${k}</option>`).join('')}</select></td>`}).join('')}</tr>`}).join('');
  return `<h2>Niveau de formation par intervenant et par étude</h2><div class="small">Une ligne par intervenant (les prénoms viennent du Temps de travail), une colonne par étude : les études en cours d’abord, les archivées ensuite. Choisissez le niveau de 0 à 4 dans la case, la couleur suit.</div>
  <div class="legend" style="margin:10px 0">${LV.map((l,i)=>`<span><span class="sw lv${i}"></span>${esc(l)}</span>`).join('')}</div>
  <div class="tw"><table class="mx"><thead><tr><th>Intervenant</th><th>Niveau moyen</th>${head}</tr></thead><tbody>${body||'<tr><td class="small" style="padding:14px">Ajoutez d’abord du temps de travail pour faire apparaître les intervenants.</td></tr>'}</tbody></table></div>`;
}
function cf(label,path,val,pct){return `<label>${label}</label><input type="number" step="any" inputmode="decimal" data-cfg="${path}" ${pct?'data-pct="1"':''} value="${pct?Math.round(val*1e6)/1e4:esc(val)}">`}
function vParams(D){
  const c=D.c;const sumP=o=>Object.values(o).reduce((a,v)=>a+num(v),0);
  const mand=c.mandats.map((m,i)=>`<div class="row" style="margin-bottom:6px"><input data-mand="${i}" data-k="nom" value="${esc(m.nom)}" style="flex:1 1 140px" placeholder="Nom du mandat"><input type="date" data-mand="${i}" data-k="debut" value="${esc(m.debut)}"><input type="date" data-mand="${i}" data-k="fin" value="${esc(m.fin)}"><button class="x" data-delmand="${i}" aria-label="Supprimer le mandat">✕</button></div>`).join('');
  return `<h2>Paramètres</h2><div class="small">Modifiez les valeurs : tout se recalcule aussitôt. Les listes se saisissent à raison d’une valeur par ligne.</div>
  <div class="two" style="margin-top:12px">
   <div class="card"><h3>Statut des études</h3><textarea data-list="statuts" rows="10" style="width:100%">${esc(c.statuts.join('\n'))}</textarea><div class="small">Les calculs reconnaissent les noms par défaut (Faisabilité, Devis signé, Archivée…).</div></div>
   <div class="card"><h3>Statut de la facture</h3><textarea data-list="factures" rows="10" style="width:100%">${esc(c.factures.join('\n'))}</textarea></div>
   <div class="card"><h3>Mandats</h3>${mand||'<div class="small">Aucun mandat : ajoutez-en un pour rattacher les dates.</div>'}<div class="plus"><button class="b ghost" data-addmand="1">+ Ajouter un mandat</button></div></div>
   <div class="card"><h3>Délais d’alerte et TVA</h3><div class="cfg">${cf('1re relance par mail : à partir de (jours de retard)','relance1',c.relance1)}${cf('2e relance : à partir de (jours de retard)','relance2',c.relance2)}${cf('Taux de TVA (montants saisis en TTC), %','tva',c.tva,true)}</div></div>
   <div class="card"><h3>CNJE</h3><div class="cfg"><label>Date d’entrée en vigueur des règles (vide = aucune règle)</label><input type="date" data-cfg="cnje.date" value="${esc(c.cnje.date)}" style="text-align:left">${cf('JEH client minimum (€ HT)','cnje.min',c.cnje.min)}${cf('JEH client maximum (€ HT)','cnje.max',c.cnje.max)}${cf('JEH intervenant maximum (€ HT)','cnje.maxInt',c.cnje.maxInt)}</div><div class="small" style="margin-top:8px">Une étude suit les règles CNJE si elle a été créée à partir de cette date, ou si elle n’est pas archivée (en cours). Sans date, aucune règle n’est appliquée.</div></div>
   <div class="card"><h3>Calcul des cotisations</h3><div class="cfg">${cf('SMIC horaire brut (€) : la base d’une JEH = 4 × SMIC','smic',c.smic)}</div>
    <div class="small" style="margin:10px 0 4px"><b>Cotisations salariales (part étudiant), %</b></div><div class="cfg">${Object.keys(COT_LAB).map(k=>cf(COT_LAB[k],'cot.'+k,c.cot[k],true)).join('')}<label><b>Total</b></label><b style="text-align:right">${nf2.format(sumP(c.cot)*100)} %</b></div>
    <div class="small" style="margin:10px 0 4px"><b>Charges patronales, %</b></div><div class="cfg">${Object.keys(PATR_LAB).map(k=>cf(PATR_LAB[k],'patr.'+k,c.patr[k],true)).join('')}${cf('Assurance chômage part Junior (sur la rétribution brute)','chomage',c.chomage,true)}<label><b>Total charges patronales</b></label><b style="text-align:right">${nf2.format(sumP(c.patr)*100)} %</b></div></div>
  </div>`;
}
const CAT=[
['CNJE','CNJE : JEH client hors de 80–450 €','Étude en mode CNJE dont la JEH client HT sort de la fourchette des Paramètres.'],
['CNJE','CNJE : JEH intervenant supérieure à 300 €','Une ligne de temps dépasse le plafond de JEH intervenant HT.'],
['CNJE','CNJE : nb de JEH facturées non entier','Montant ÷ (1 + TVA) ÷ prix de la JEH n’est pas un entier.'],
['CNJE','CNJE : JEH rémunérées non entières (par intervenant)','Le total des JEH rémunérées d’un intervenant sur une étude n’est pas un entier ; le message donne les prénoms.'],
['CNJE','CNJE : JEH facturées ≠ JEH rémunérées','Études « Convention étudiant avant réalisation », « En réalisation » ou « Archivée » dont les JEH facturées et rémunérées diffèrent.'],
['Toutes','Retard de N j (+ 1re relance par mail / 2e relance)','Acompte, intermédiaire ou solde facturé et échéance dépassée.'],
['Toutes','Archivée mais reste à encaisser','Étude archivée alors que le client doit encore payer.'],
['Toutes','Archivée sans solde encaissé','Étude archivée alors que le solde n’est pas marqué encaissé.'],
['Toutes','Archivée mais BV non payés','Étude archivée alors qu’un intervenant est encore « À payer ».'],
['Toutes','Encaissé supérieur au montant','Erreur de saisie ou trop-perçu à rembourser.'],
['Toutes','Facturer l’acompte','Convention signée, convention étudiant avant réalisation ou étude en réalisation sans statut de facture.'],
['Toutes','Renseigner l’échéance de paiement','Facture émise sans date d’échéance.'],
['Toutes','Renseigner le temps de travail','Étude en réalisation sans aucune ligne de temps.'],
['Toutes','Prix de la JEH manquant','Des lignes de temps existent mais la JEH client HT est vide (écrire 0 si c’est voulu).'],
['Toutes','Rémunérations supérieures au montant HT','Les rémunérations dépassent le montant de l’étude.'],
['Toutes','Payer les BV','Solde encaissé, intervenants encore « À payer ».'],
['Toutes','Tout est soldé : archiver l’étude','Solde encaissé, BV payés, rien à encaisser.'],
['Toutes','Étude refusée mais facturée','Statut refusé avec une facture ou un encaissement.'],
['Toutes','Solde encaissé mais reste à encaisser','Montant ou encaissé à corriger.'],
['Toutes','Solde encaissé (Factures) mais statut Facture différent','Un paiement « Solde encaissé » existe dans Factures alors que le suivi n’est pas sur « Solde encaissé ».'],
['Toutes','Renseigner la date de création','L’étude n’est rattachée à aucun mandat.'],
['Toutes','N° d’étude en double','Deux lignes avec le même numéro.']];
function vLegende(D){
  return `<h2>Légende</h2><div class="two" style="margin-top:8px">
  <div class="card"><h3>Comment ça marche</h3><ul style="margin:6px 0 0;padding-left:18px">
   <li>Cases claires : à saisir. Cases teintées : calculées automatiquement.</li>
   <li>Le <b>mandat</b> se déduit de la date (Paramètres).</li>
   <li>L’<b>encaissé</b> d’une étude est la somme de ses paiements dans l’onglet Factures.</li>
   <li>La <b>JEH rémunérée</b> d’une ligne de temps = minutes ÷ 480 ÷ nombre de personnes.</li>
   <li>Une ligne de temps « Payé », « A venir » ou « Non effectué » n’est jamais à payer.</li>
   <li>Tout est enregistré automatiquement, sur tous vos appareils.</li></ul></div>
  <div class="card"><h3>BV (bulletins de versement)</h3><ul style="margin:6px 0 0;padding-left:18px"><li><b>À payer</b> : au moins une ligne à verser.</li><li><b>À venir</b> : prévu, pas encore dû.</li><li><b>Payé</b> : toutes les lignes sont payées.</li><li><b>Non effectué</b> : le travail n’a pas eu lieu.</li></ul></div></div>
  <h2 style="margin-top:18px">Catalogue des alertes</h2><div class="tw"><table><thead><tr><th>Type</th><th>Alerte</th><th>Quand elle s’affiche</th></tr></thead><tbody>${CAT.map(r=>`<tr><td style="padding:6px 8px">${r[0]}</td><td style="padding:6px 8px"><b>${esc(r[1])}</b></td><td style="padding:6px 8px">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`;
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
    if(S[col][id]){S[col][id][f]=v;saveRow(col,id)}
    render();
  }else if(t.dataset.lvl!==undefined){
    const n=t.dataset.lvl,k='f_'+n.toLowerCase().replace(/[^a-z0-9]+/g,'_');
    const doc=S.formation[k]||(S.formation[k]={nom:n,niveaux:{}});doc.nom=n;doc.niveaux=doc.niveaux||{};
    if(t.value==='')delete doc.niveaux[t.dataset.etude];else doc.niveaux[t.dataset.etude]=Number(t.value);
    save('formation/'+k,doc);render();
  }else if(t.dataset.cfg){
    const c=ensureCfg();let v=t.type==='date'?t.value:(t.value===''?null:Number(t.value));
    if(t.dataset.pct&&v!==null)v=v/100;
    setPath(c,t.dataset.cfg,v===null?0:v);saveCfg();render();
  }else if(t.dataset.list){
    const c=ensureCfg();c[t.dataset.list]=t.value.split('\n').map(s=>s.trim()).filter(Boolean);saveCfg();render();
  }else if(t.dataset.mand!==undefined){
    const c=ensureCfg();c.mandats[+t.dataset.mand][t.dataset.k]=t.value;saveCfg();render();
  }
});
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.connect){const u=($('#cu').value||'').trim(),t=($('#ct').value||'').trim();if(u&&t){lsSet('suivi.url',u);lsSet('suivi.tok',t);location.reload()}return}
  if(b.dataset.reconnect){if(b.dataset.arm){try{localStorage.removeItem('suivi.url');localStorage.removeItem('suivi.tok');localStorage.removeItem('suivi.cache')}catch(x){}location.reload()}else{b.dataset.arm='1';b.textContent='Sûr ?';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='Changer la connexion'}},3000)}return}
  if(b.dataset.tab){tab=b.dataset.tab;lsSet('suivi.tab',tab);render();window.scrollTo(0,0);return}
  if(b.dataset.add){
    const a=b.dataset.add;
    if(a==='etudes')addRow('etudes',{date:dstr(TODAY),client:'',num:'',resume:'',statut:'Faisabilité',facture:'',jeh:null,montant:null,echeance:''});
    if(a==='factures')addRow('factures',{date:dstr(TODAY),etude:'',montant:null,note:''});
    if(a==='temps')addRow('temps',{date:dstr(TODAY),prenom:'',etude:'',note:'',min:null,nb:1,jeh:null,statut:'Pas payé'});
    return}
  if(b.dataset.addmand){const c=ensureCfg();c.mandats.push({nom:'Nouveau mandat',debut:'',fin:''});saveCfg();render();return}
  if(b.dataset.delmand!==undefined){if(b.dataset.arm){const c=ensureCfg();c.mandats.splice(+b.dataset.delmand,1);saveCfg();render()}else{b.dataset.arm='1';b.textContent='Sûr ?';b.className='b warn';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.className='x'}},3000)}return}
  if(b.dataset.del){
    if(b.dataset.arm){const [col,id]=b.dataset.del.split(':');del(col,id);render()}
    else{b.dataset.arm='1';b.textContent='Sûr ?';b.className='b warn';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.className='x'}},3000)}
  }
});

/* ---------- démarrage ---------- */
async function api(body){
  const c=CONN();
  const r=await fetch(c.url,{method:'POST',body:JSON.stringify(Object.assign({token:c.tok},body)),redirect:'follow'});
  const j=await r.json();
  if(j&&j.error)throw new Error(j.error);
  return j;
}
function makeDb(){
  const c=CONN();if(!c.url||!c.tok)return null;
  const subs=[];let cache=null,pending=0,loading=false;
  try{cache=JSON.parse(lsGet('suivi.cache')||'null')}catch(e){cache=null}
  const colSnap=col=>({docs:Object.keys(cache[col]||{}).map(id=>({id,exists:true,data:()=>cache[col][id]}))});
  const emit=()=>subs.forEach(s=>{try{s.fire()}catch(e){}});
  const keep=()=>{try{lsSet('suivi.cache',JSON.stringify(cache))}catch(e){}};
  async function load(first){
    if(loading||pending>0||outbox.length)return;loading=true;
    try{cache=await api({action:'loadAll'});keep();if(dbErr){dbErr='';renderStatus()}emit()}
    catch(e){
      if(String(e.message)==='auth'){dbErr='Adresse ou code secret incorrect.';renderStatus();subs.forEach(s=>s.err&&s.err({code:'invalid_argument'}))}
      else if(cache){dbErr='Hors connexion : dernière version enregistrée affichée, les modifications ne sont pas possibles pour le moment.';renderStatus()}
      else if(first)subs.forEach(s=>s.err&&s.err({code:'unavailable'}));
    }
    loading=false;
  }
  setInterval(()=>{if(!document.hidden){outbox.length?flush():load(false)}},8000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){outbox.length?flush():load(false)}});
  window.addEventListener('online',()=>{outbox.length?flush():load(false)});
  setTimeout(()=>load(true),0);
  let outbox=[];try{outbox=JSON.parse(lsGet('suivi.outbox')||'[]')}catch(e){outbox=[]}
  const saveOut=()=>lsSet('suivi.outbox',JSON.stringify(outbox));
  let flushing=false;
  async function flush(){
    if(flushing)return;flushing=true;pending++;
    try{while(outbox.length){await api(outbox[0]);outbox.shift();saveOut()}
      if(dbErr&&/Enregistrement|Hors connexion/.test(dbErr)){dbErr='';renderStatus()}}
    catch(e){dbErr='Hors connexion : vos modifications sont gardées sur cet appareil et partiront vers Drive dès le retour du réseau.';renderStatus()}
    pending--;flushing=false;
  }
  const write=(body)=>{keep();outbox.push(body);saveOut();flush();return Promise.resolve()};
  if(outbox.length)setTimeout(flush,0);
  return {
    collection(col){return {onSnapshot(next,err){const s={err,fire:()=>cache&&next(colSnap(col))};subs.push(s);if(cache)setTimeout(s.fire,0);return()=>{const i=subs.indexOf(s);if(i>=0)subs.splice(i,1)}}}},
    doc(path){const [c,i]=path.split('/');return {
      set:d=>{cache=cache||{};(cache[c]=cache[c]||{})[i]=JSON.parse(JSON.stringify(d));return write({action:'save',col:c,id:i,json:JSON.stringify(d)})},
      delete:()=>{if(cache&&cache[c])delete cache[c][i];return write({action:'delete',col:c,id:i})},
      onSnapshot(next,err){const s={err,fire:()=>cache&&next({exists:!!(cache[c]&&cache[c][i]),data:()=>cache[c]&&cache[c][i]})};subs.push(s);if(cache)setTimeout(s.fire,0);return()=>{const k=subs.indexOf(s);if(k>=0)subs.splice(k,1)}}}}
  };
}

function afterSnap(){if(dirty){pendingRender=true;return}render()}
document.addEventListener('focusout',()=>{if(pendingRender&&!dirty){pendingRender=false;setTimeout(render,0)}});
render();
(async function(){
  db=makeDb();
  if(userCap){try{const w=userCap.can&&userCap.can('data.write');if(w===false)canWrite=false}catch(e){}}
  if(!db){return}
  const timer=setTimeout(()=>{timeoutNote=true;renderStatus()},10000);
  const clear=()=>{if(Object.values(loaded).every(Boolean)){clearTimeout(timer);timeoutNote=false;renderStatus()}};
  const fail=e=>{dbErr=(e&&e.code==='revoked')?'L’accès aux données a été retiré.':'Lecture des données impossible pour le moment.';renderStatus()};
  ['etudes','factures','temps','formation'].forEach(col=>{
    db.collection(col).onSnapshot(snap=>{const o={};snap.docs.forEach(d=>{o[d.id]=Object.assign({},d.data())});S[col]=o;loaded[col]=true;clear();afterSnap()},fail);
  });
  db.doc('config/main').onSnapshot(s=>{S.cfg=s.exists?Object.assign({},s.data()):null;loaded.cfg=true;clear();afterSnap()},fail);
})();
})();
