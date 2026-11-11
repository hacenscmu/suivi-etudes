// Test navigateur de la sécurité (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node tests/e2e-securite.js [préfixe-captures]
// Le serveur est le vrai serveur/Code.gs exécuté dans Node avec de faux services Google ; les appels réseau sont interceptés.
const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),crypto=require('crypto');
let pass=0,fail=0;const ok=(n,c)=>{c?pass++:fail++;console.log((c?'✔ ':'✘ ')+n)};const CAP=process.argv[2];
const rows=[['collection','id','json'],['etudes','e1',JSON.stringify({client:'B+T',num:'1',statut:'En réalisation',montant:1428,jeh:400,date:'2026-09-01'})],['config','main',JSON.stringify({tva:0.2})],
 ['temps','t9',JSON.stringify({prenom:'Zoé.B',etude:'1',min:240,nb:1,jeh:300,statut:'Pas payé',date:'2026-10-01'})],['temps','t8',JSON.stringify({prenom:'Alex.M',etude:'1',min:480,nb:1,jeh:300,statut:'Payé',date:'2026-09-01'})],
 ['factures','f1',JSON.stringify({etude:'1',type:'Solde',etat:'Émise',montant:1428})]];
const props={SSID:'copie'};
const SH={getLastRow:()=>rows.length,getRange:(r,c,n,w)=>({getValues:()=>rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w)),setValue:v=>{rows[r-1][2]=v}}),appendRow:a=>rows.push(a.slice()),deleteRow:r=>rows.splice(r-1,1)};
const G={ContentService:{MimeType:{JSON:1},createTextOutput:s=>({setMimeType:()=>s})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s,'utf8').digest()].map(b=>b>127?b-256:b),getUuid:()=>crypto.randomUUID()},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v}})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='Données'?SH:null})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},console:{log(){}}};
const S=new Function(...Object.keys(G),fs.readFileSync(path.join(__dirname,'..','serveur','Code.gs'),'utf8')+';return {doPost,codeMembres};')(...Object.values(G));
const appel=b=>JSON.parse(S.doPost({postData:{contents:JSON.stringify(b)}}));
const CODE=S.codeMembres();
const etude=()=>JSON.parse(rows.find(r=>r[1]==='e1')[2]);
const URL_='https://script.google.com/macros/s/TEST/exec';
(async()=>{
  ok('code des membres : 8 caractères, stable',/^[A-Z2-9]{8}$/.test(CODE)&&S.codeMembres()===CODE);
  ok('code stocké en empreinte et en clair dans les propriétés seulement (pas dans le Sheet)',!JSON.stringify(rows).includes(CODE));
  ok('sans code : refusé',appel({action:'loadAll'}).error==='auth'&&appel({action:'loadAll',token:'ZZZZZZZZ'}).error==='auth');
  const b=await chromium.launch();const ctx=await b.newContext();ctx.on('page',pg=>pg.on('dialog',d=>d.accept(d.type()==='prompt'?'doublon':undefined)));
  const errs=[];ctx.on('page',pg=>pg.on('pageerror',e=>errs.push(e.message)));
  let horsLigne=false;
  await ctx.route('https://script.google.com/**',async r=>{if(horsLigne)return r.abort();r.fulfill({status:200,contentType:'application/json',body:S.doPost({postData:{contents:r.request().postData()}})})});
  const p=await ctx.newPage();await p.goto('http://localhost:8766/index.html');await p.waitForTimeout(800);
  await p.click('#nav [data-tab="params"]');await p.click('[data-mn="home"]');await p.click('[data-mn="addr"]');
  await p.fill('#syu',URL_);await p.fill('#syt','ABCDEFGH');await p.click('[data-mn="syncon"]');await p.waitForTimeout(400);
  ok('premier branchement : mauvais code refusé avec message',(await p.textContent('#sym')).includes('Code d’accès refusé'));
  await p.fill('#syt',CODE.toLowerCase());await p.click('[data-mn="syncon"]');await p.waitForTimeout(1500);
  ok('premier branchement avec le code des membres (minuscules acceptées)',(await p.evaluate(()=>localStorage.getItem('suivi.role')))==='membre');
  await p.click('#nav [data-tab="etudes"]');await p.waitForTimeout(500);await p.click('[data-open]');await p.waitForTimeout(300);await p.click('[data-edit^="etudes:"]');await p.waitForTimeout(300);
  await p.selectOption('#edit [data-f="statut"]','Archivée');await p.waitForTimeout(1500);
  ok('modification enregistrée : version 1, auteur « Membres »',etude().statut==='Archivée'&&etude()._v===1&&etude()._par==='Membres');
  ok('autre appareil : écriture sur la bonne version',appel({token:CODE,action:'save',col:'etudes',id:'e1',json:JSON.stringify({...etude(),montant:2000}),expected:1,op:'op-autre-1'}).version===2);
  await p.selectOption('#edit [data-f="statut"]','En réalisation');await p.waitForTimeout(2000);
  ok('conflit : l’ancienne version n’écrase pas',etude().montant===2000&&etude().statut==='Archivée');
  ok('conflit : message clair',(await p.textContent('#status')).includes('quelqu’un a modifié la même fiche'));
  await p.click('#edit .mb.solid');await p.waitForTimeout(9000);
  ok('après conflit : version à jour affichée',(await p.evaluate(()=>JSON.parse(localStorage.getItem('suivi.cache')).etudes.e1.montant))===2000);
  horsLigne=true;await p.click('[data-edit^="etudes:"]');await p.waitForTimeout(300);
  await p.fill('#edit [data-f="resume"]','Première');await p.locator('#edit [data-f="resume"]').dispatchEvent('change');await p.waitForTimeout(300);
  await p.fill('#edit [data-f="resume"]','Seconde');await p.locator('#edit [data-f="resume"]').dispatchEvent('change');await p.waitForTimeout(300);
  ok('hors ligne : modifications gardées',etude().resume===undefined&&(await p.evaluate(()=>JSON.parse(localStorage.getItem('suivi.outbox')).length))===2);
  horsLigne=false;await p.evaluate(()=>window.dispatchEvent(new Event('online')));await p.waitForTimeout(2500);
  ok('retour du réseau : les 2 modifications passent (version 4)',etude().resume==='Seconde'&&etude()._v===4);
  await p.click('#edit .mb.solid').catch(()=>{});
  // Membres et codes d'accès
  await p.reload();await p.waitForTimeout(1200);await p.click('#nav [data-tab="params"]');await p.waitForTimeout(300);
  await p.click('.srow[data-mn="membres"]');await p.waitForTimeout(1000);const sh=await p.textContent('#sheet');
  ok('écran : code des membres affiché',sh.includes(CODE));
  ok('noms des JEH ajoutés automatiquement comme salariés, avec leur code',sh.includes('Zoé.B')&&sh.includes('Alex.M'));
  if(CAP)await p.screenshot({path:CAP+'-membres.png'});
  const lst=appel({token:CODE,action:'membres'}),zoe=lst.salaries.find(m=>m.nom==='Zoé.B'),alex=lst.salaries.find(m=>m.nom==='Alex.M');
  ok('codes salariés : 8 caractères, différents',/^[A-Z2-9]{8}$/.test(zoe.code)&&zoe.code!==alex.code&&zoe.code!==CODE);
  ok('le code des membres ne change pas',appel({token:CODE,action:'membres'}).codeMembres===CODE);
  await p.click('[data-mn="nouveau"]');await p.fill('#mnom','Léa.K');await p.click('[data-mn="creer"]');await p.waitForTimeout(800);
  const codeLea=(await p.textContent('#codev')).trim();
  ok('ajout manuel d’un salarié : code de 8 caractères',/^[A-Z2-9]{8}$/.test(codeLea)&&appel({token:codeLea,action:'ping'}).role==='salarie');
  ok('un salarié ne peut ni gérer les codes ni écrire',appel({token:codeLea,action:'membres'}).error==='lecture'&&appel({token:codeLea,action:'save',col:'etudes',id:'x',json:'{}',expected:0,op:'op-x-1'}).error==='lecture');
  await p.click('#sheet [data-mn="membres"]');await p.waitForTimeout(800);
  await p.click('[data-mn="desact"][data-nom="Léa.K"]');await p.waitForTimeout(800);
  ok('désactiver un salarié : son code ne marche plus',appel({token:codeLea,action:'ping'}).error==='auth');
  const vue=appel({token:zoe.code,action:'loadAll'});
  ok('vue salarié : seulement ses JEH, ni factures ni clients, étude réduite',Object.keys(vue.temps).join()==='t9'&&!vue.factures&&!vue.clients&&vue.etudes.e1&&vue.etudes.e1.montant===undefined);
  await p.close();
  // Appli de Zoé (salariée)
  const p2=await ctx.newPage();await p2.goto('http://localhost:8766/index.html');await p2.evaluate(()=>localStorage.clear());await p2.reload();await p2.waitForTimeout(600);
  await p2.click('#nav [data-tab="params"]');await p2.click('[data-mn="home"]');await p2.click('[data-mn="addr"]');await p2.fill('#syu',URL_);await p2.fill('#syt',zoe.code);await p2.click('[data-mn="syncon"]');await p2.waitForTimeout(2000);
  const tz=await p2.innerText('body');
  ok('appli salariée : onglets Moi et Paramètres seulement',(await p2.locator('#nav button').count())===2&&tz.includes('Bonjour Zoé'));
  ok('appli salariée : ses données uniquement',tz.includes('À recevoir')&&!tz.includes('Alex.M')&&!tz.includes('1 428'));
  await p2.click('[data-mn="signaler"]');await p2.fill('#sg_et','1');await p2.fill('#sg_min','120');await p2.fill('#sg_note','analyse échantillon 3');await p2.click('[data-mn="envoyersig"]');await p2.waitForTimeout(1500);
  appel({token:zoe.code,action:'signaler',signalement:{date:'2026-10-02',min:60,par:'Alex.M'}});
  const sig=rows.filter(r=>r[0]==='signalements').map(r=>JSON.parse(r[2]));
  ok('signalements : nom imposé par le serveur',sig.length===2&&sig.every(g=>g.par==='Zoé.B'));
  await p2.close();
  // Un membre traite les signalements
  const p3=await ctx.newPage();await p3.goto('http://localhost:8766/index.html');await p3.evaluate(c=>{localStorage.clear();localStorage.setItem('suivi.url','https://script.google.com/macros/s/TEST/exec');localStorage.setItem('suivi.token',c);localStorage.setItem('suivi.role','membre');localStorage.setItem('suivi.admin','1');localStorage.setItem('suivi.tab','finances');localStorage.setItem('suivi.fseg','jeh')},CODE);
  await p3.reload();await p3.waitForTimeout(2000);
  ok('membre : « Signalements à traiter »',(await p3.innerText('#view')).includes('Signalements à traiter'));
  await p3.click('[data-sig^="ok:"]');await p3.waitForTimeout(2500);await p3.click('#edit .mb.solid');await p3.waitForTimeout(500);await p3.click('[data-sig^="non:"]');await p3.waitForTimeout(1500);
  ok('« Créer la ligne » et « Refuser » enregistrés',rows.filter(r=>r[0]==='temps').some(r=>JSON.parse(r[2]).min===120)&&rows.filter(r=>r[0]==='signalements').map(r=>JSON.parse(r[2]).statut).sort().join()==='ajoutee,refusee');
  await p3.close();
  const p4=await ctx.newPage();await p4.goto('http://localhost:8766/index.html');await p4.evaluate(c=>{localStorage.clear();localStorage.setItem('suivi.url','https://script.google.com/macros/s/TEST/exec');localStorage.setItem('suivi.token',c);localStorage.setItem('suivi.role','salarie');localStorage.setItem('suivi.membre','Zoé.B');localStorage.setItem('suivi.tab','moi')},zoe.code);
  await p4.reload();await p4.waitForTimeout(2000);const vz=await p4.innerText('#view');
  ok('salariée : voit Validé, Refusé et le motif',vz.includes('Validé')&&vz.includes('Refusé')&&vz.includes('Motif du refus : doublon'));
  // code salarié désactivé → l'appli redemande le code
  appel({token:CODE,action:'desactiver',nom:'Zoé.B'});await p4.reload();await p4.waitForTimeout(1500);
  ok('code désactivé : l’appli redemande le code',await p4.isVisible('#syt2'));
  await p4.close();
  // anciennes modifications en attente (format d'avant la sécurité : sans op ni expected) → converties et envoyées
  const p5=await ctx.newPage();await p5.goto('http://localhost:8766/index.html');await p5.evaluate(c=>{localStorage.clear();localStorage.setItem('suivi.url','https://script.google.com/macros/s/TEST/exec');localStorage.setItem('suivi.token',c);localStorage.setItem('suivi.role','membre');
    localStorage.setItem('suivi.outbox',JSON.stringify([{action:'save',col:'etudes',id:'e1',json:JSON.stringify({client:'B+T',num:'1',statut:'En réalisation',montant:1428,jeh:400,date:'2026-09-01',resume:'ancien'})},{action:'save',col:'etudes',id:'eNouv',json:JSON.stringify({client:'Nouveau',num:'9'})}]))},CODE);
  await p5.reload();await p5.waitForTimeout(3000);
  ok('anciennes modifications en attente : converties et enregistrées',etude().resume==='ancien'&&rows.some(r=>r[1]==='eNouv')&&(await p5.evaluate(()=>JSON.parse(localStorage.getItem('suivi.outbox')).length))===0);
  await p5.close();
  // changement de code sur un même appareil : rien de l'accès précédent n'est montré ni envoyé sous le nouvel accès
  const ZC=appel({token:CODE,action:'reactiver',nom:'Zoé.B'}).code;
  const p6=await ctx.newPage();await p6.goto('http://localhost:8766/index.html');await p6.evaluate(c=>{localStorage.clear();localStorage.setItem('suivi.url','https://script.google.com/macros/s/TEST/exec');localStorage.setItem('suivi.token',c);localStorage.setItem('suivi.role','membre');localStorage.setItem('suivi.membre','Membres')},CODE);
  await p6.reload();await p6.waitForTimeout(2000);
  ok('membre : cache marqué à son identité',(await p6.evaluate(()=>localStorage.getItem('suivi.cacheQui')))==='membre:Membres');
  horsLigne=true;await p6.evaluate(()=>localStorage.setItem('suivi.outbox',JSON.stringify([{action:'save',col:'etudes',id:'e1',json:'{}',expected:1,op:'oXXXX'}])));horsLigne=false;
  await p6.click('#nav [data-tab="params"]');await p6.click('[data-mn="code"]');await p6.fill('#syt2',ZC);await p6.click('[data-mn="savecode"]');await p6.waitForTimeout(2500);
  const v6=await p6.innerText('#view');
  ok('passage au code salarié : file de l’accès précédent effacée, données du membre plus visibles',(await p6.evaluate(()=>JSON.parse(localStorage.getItem('suivi.outbox')||'[]').length))===0&&!v6.includes('Alex')&&(await p6.evaluate(()=>localStorage.getItem('suivi.cacheQui')))==='salarie:Zoé.B');
  // démarrage hors ligne avec un cache d'une autre identité : rien n'est affiché
  await p6.evaluate(()=>{localStorage.setItem('suivi.cache',JSON.stringify({temps:{x:{prenom:'Alex.M',etude:'1',min:60,nb:1,statut:'Payé'}}}));localStorage.setItem('suivi.cacheQui','membre:Membres')});
  horsLigne=true;await p6.reload();await p6.waitForTimeout(1500);horsLigne=false;
  ok('hors ligne, cache d’une autre identité : non affiché',!(await p6.innerText('body')).includes('Alex'));
  await p6.close();
  ok('aucune erreur JavaScript',errs.length===0||console.log(errs));
  await b.close();console.log(pass+' réussis, '+fail+' échoués');process.exitCode=fail?1:0})();
