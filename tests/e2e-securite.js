// Test navigateur de la sécurité v16 (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node tests/e2e-securite.js
// Le serveur est le vrai serveur/Code.gs exécuté dans Node avec de faux services Google ; les appels réseau sont interceptés.
const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),crypto=require('crypto');
let pass=0,fail=0;const ok=(n,c)=>{c?pass++:fail++;console.log((c?'✔ ':'✘ ')+n)};
const rows=[['collection','id','json'],['etudes','e1',JSON.stringify({client:'B+T',num:'1',statut:'En réalisation',montant:1428,jeh:400,date:'2026-09-01'})],['config','main',JSON.stringify({tva:0.2})]];
const props={SSID:'copie'};const logs=[];
const SH={getLastRow:()=>rows.length,getRange:(r,c,n,w)=>({getValues:()=>rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w)),setValue:v=>{rows[r-1][2]=v}}),appendRow:a=>rows.push(a.slice()),deleteRow:r=>rows.splice(r-1,1)};
const G={ContentService:{MimeType:{JSON:1},createTextOutput:s=>({setMimeType:()=>s})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s,'utf8').digest()].map(b=>b>127?b-256:b),getUuid:()=>crypto.randomUUID()},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v}})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='Données'?SH:null})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},console:{log:m=>logs.push(m)}};
const S=new Function(...Object.keys(G),fs.readFileSync(path.join(__dirname,'..','serveur','Code.gs'),'utf8')+';return {doPost,creerJeton,revoquerJeton};')(...Object.values(G));
const JETON=S.creerJeton('Pauline.D'),AUTRE=S.creerJeton('Alex.M');
const appel=b=>JSON.parse(S.doPost({postData:{contents:JSON.stringify(b)}}));
const etude=()=>JSON.parse(rows.find(r=>r[1]==='e1')[2]);
(async()=>{
  ok('jeton stocké seulement en empreinte',!props.TOKENS.includes(JETON));
  ok('sans code : refusé',appel({action:'loadAll'}).error==='auth'&&appel({action:'loadAll',token:'x'.repeat(40)}).error==='auth');
  const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
  let horsLigne=false;
  await ctx.route('https://script.google.com/**',async r=>{if(horsLigne)return r.abort();r.fulfill({status:200,contentType:'application/json',body:S.doPost({postData:{contents:r.request().postData()}})})});
  await p.goto('http://localhost:8766/index.html');await p.waitForTimeout(800);
  await p.click('#nav [data-tab="params"]');await p.click('[data-mn="home"]');await p.click('[data-mn="addr"]');
  await p.fill('#syu','https://script.google.com/macros/s/TEST/exec');await p.fill('#syt','mauvais-code-mauvais-code');await p.click('[data-mn="syncon"]');await p.waitForTimeout(400);
  ok('premier branchement : code refusé avec message',(await p.textContent('#sym')).includes('Code d’accès refusé'));
  await p.fill('#syt',JETON);await p.click('[data-mn="syncon"]');await p.waitForTimeout(1500);
  ok('premier branchement réussi : données du serveur affichées',(await p.evaluate(()=>localStorage.getItem('suivi.membre')))==='Pauline.D');
  await p.click('#nav [data-tab="etudes"]');await p.waitForTimeout(500);await p.click('[data-open]');await p.waitForTimeout(300);await p.click('[data-edit^="etudes:"]');await p.waitForTimeout(300);
  await p.selectOption('#edit [data-f="statut"]','Archivée');await p.waitForTimeout(1500);
  ok('modification enregistrée : version 1, auteur Pauline.D',etude().statut==='Archivée'&&etude()._v===1&&etude()._par==='Pauline.D');
  // un autre membre modifie la même fiche
  ok('autre membre : écriture acceptée sur la bonne version',appel({token:AUTRE,action:'save',col:'etudes',id:'e1',json:JSON.stringify({...etude(),montant:2000}),expected:1,op:'op-alex-1'}).version===2);
  await p.selectOption('#edit [data-f="statut"]','En réalisation');await p.waitForTimeout(2000);
  ok('conflit : l’ancienne version ne l’écrase pas',etude().montant===2000&&etude().statut==='Archivée');
  ok('conflit : message clair affiché',(await p.textContent('#status')).includes('quelqu’un a modifié la même fiche'));
  await p.click('#edit .mb.solid');await p.waitForTimeout(9000);
  ok('après conflit : l’appli affiche la version à jour (2 000 €)',(await p.evaluate(()=>JSON.parse(localStorage.getItem('suivi.cache')).etudes.e1.montant))===2000);
  // hors ligne : deux modifications de la même fiche, puis retour du réseau
  horsLigne=true;await p.click('[data-edit^="etudes:"]');await p.waitForTimeout(300);
  await p.fill('#edit [data-f="resume"]','Première');await p.locator('#edit [data-f="resume"]').dispatchEvent('change');await p.waitForTimeout(300);
  await p.fill('#edit [data-f="resume"]','Seconde');await p.locator('#edit [data-f="resume"]').dispatchEvent('change');await p.waitForTimeout(300);
  ok('hors ligne : rien n’est parti, modifications gardées',etude().resume===undefined&&(await p.evaluate(()=>JSON.parse(localStorage.getItem('suivi.outbox')).length))===2);
  horsLigne=false;await p.evaluate(()=>window.dispatchEvent(new Event('online')));await p.waitForTimeout(2500);
  ok('retour du réseau : les 2 modifications passent sans conflit (version 4)',etude().resume==='Seconde'&&etude()._v===4);
  // ligne abîmée côté serveur
  rows.push(['etudes','casse','{abîmée']);await p.reload();await p.waitForTimeout(1500);
  ok('une ligne abîmée ne bloque pas l’appli',(await p.evaluate(()=>!!JSON.parse(localStorage.getItem('suivi.cache')).etudes.e1)));
  // code révoqué
  S.revoquerJeton('Pauline.D');await p.reload();await p.waitForTimeout(1500);
  ok('code révoqué : l’appli demande le code',await p.isVisible('#syt2'));
  ok('aucune erreur JavaScript',errs.length===0||console.log(errs));
  await b.close();console.log(pass+' réussis, '+fail+' échoués');process.exitCode=fail?1:0})();
