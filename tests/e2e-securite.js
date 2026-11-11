// Test navigateur de la sécurité v16 (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node tests/e2e-securite.js
// Le serveur est le vrai serveur/Code.gs exécuté dans Node avec de faux services Google ; les appels réseau sont interceptés.
const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),crypto=require('crypto');
let pass=0,fail=0;const ok=(n,c)=>{c?pass++:fail++;console.log((c?'✔ ':'✘ ')+n)};
const rows=[['collection','id','json'],['etudes','e1',JSON.stringify({client:'B+T',num:'1',statut:'En réalisation',montant:1428,jeh:400,date:'2026-09-01'})],['config','main',JSON.stringify({tva:0.2})]];
const props={SSID:'copie'};const logs=[];
const SH={getLastRow:()=>rows.length,getRange:(r,c,n,w)=>({getValues:()=>rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w)),setValue:v=>{rows[r-1][2]=v}}),appendRow:a=>rows.push(a.slice()),deleteRow:r=>rows.splice(r-1,1)};
const G={ContentService:{MimeType:{JSON:1},createTextOutput:s=>({setMimeType:()=>s})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s,'utf8').digest()].map(b=>b>127?b-256:b),getUuid:()=>crypto.randomUUID()},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v}})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='Données'?SH:null})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},console:{log:m=>logs.push(m)}};
const S=new Function(...Object.keys(G),fs.readFileSync(path.join(__dirname,'..','serveur','Code.gs'),'utf8')+';return {doPost,creerMonCode,listerCodes,jetons:()=>JSON.parse(props.TOKENS)};')(...Object.values(G));
const appel=b=>JSON.parse(S.doPost({postData:{contents:JSON.stringify(b)}}));function appel0(b){return appel(b)}
const JETON=S.creerMonCode();
const AUTRE=appel0({token:JETON,action:'creerCode',nom:'Alex.M',role:'membre'}).code;
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
  // gestion des codes depuis l'appli (Pauline est administratrice)
  await p.reload();await p.waitForTimeout(1200);await p.click('#nav [data-tab="params"]');await p.waitForTimeout(300);
  ok('Paramètres : ligne « Membres et codes d’accès »',(await p.textContent('#view')).includes('Membres et codes d’accès'));
  await p.click('.srow[data-mn="membres"]');await p.waitForTimeout(800);
  if(process.argv[2])await p.screenshot({path:process.argv[2]+'-membres.png'});
  ok('liste des membres (administratrice)',(await p.textContent('#sheet')).includes('Alex.M'));
  await p.click('[data-mn="nouveau"]');await p.fill('#mnom','Léa.K');await p.selectOption('#mrole','salarie');await p.click('[data-mn="creer"]');await p.waitForTimeout(800);
  const codeLea=(await p.textContent('#codev')).trim();
  ok('nouveau salarié : code simple de 8 caractères',/^[A-Z2-9]{8}$/.test(codeLea)&&appel({token:codeLea,action:'ping'}).role==='salarie');
  ok('un salarié ne peut ni gérer les codes ni écrire',appel({token:codeLea,action:'membres'}).error==='lecture'&&appel({token:codeLea,action:'save',col:'etudes',id:'x',json:'{}',expected:0,op:'op-x-1'}).error==='lecture');
  await p.click('#sheet [data-mn="membres"]');await p.waitForTimeout(800);
await p.click('[data-mn="desact"][data-nom="Alex.M"]');await p.waitForTimeout(800);
  ok('désactiver un membre : son code ne marche plus',appel({token:AUTRE,action:'ping'}).error==='auth'&&(await p.textContent('#sheet')).includes('Désactivé'));
  const ancien=await p.evaluate(()=>localStorage.getItem('suivi.token'));
  await p.click('[data-mn="moncode"]');await p.waitForTimeout(800);
  const nouveau=await p.evaluate(()=>localStorage.getItem('suivi.token'));
  ok('changer mon code : nouveau code enregistré sur le téléphone, ancien refusé',nouveau!==ancien&&appel({token:ancien,action:'ping'}).error==='auth'&&appel({token:nouveau,action:'ping'}).membre==='Pauline.D');
  await p.click('[data-mn="close"]').catch(()=>{});await p.reload();await p.waitForTimeout(1200);
  ok('après changement de code : l’appli continue de fonctionner',!(await p.isVisible('#syt2').catch(()=>false)));
  // nom présent dans les JEH sans code → salarié automatique, vue filtrée
  rows.push(['temps','t9',JSON.stringify({prenom:'Zoé.B',etude:'1',min:240,nb:1,jeh:300,statut:'Pas payé',date:'2026-10-01'})]);
  rows.push(['temps','t8',JSON.stringify({prenom:'Alex.M',etude:'1',min:480,nb:1,jeh:300,statut:'Payé',date:'2026-09-01'})]);
  rows.push(['factures','f1',JSON.stringify({etude:'1',type:'Solde',etat:'Émise',montant:1428})]);
  const tok2=await p.evaluate(()=>localStorage.getItem('suivi.token'));
  const liste=appel({token:tok2,action:'membres'}).membres;const zoe=liste.find(m=>m.nom==='Zoé.B');
  ok('nom vu dans les JEH → ajouté comme Salarié avec un code simple',zoe&&zoe.role==='salarie'&&/^[A-Z2-9]{8}$/.test(zoe.code));
  const vue=appel({token:zoe.code.toLowerCase(),action:'loadAll'});
  ok('vue salarié (code en minuscules accepté) : seulement ses JEH, aucune facture, étude réduite',Object.keys(vue.temps).join()==='t9'&&!vue.factures&&!vue.clients&&vue.etudes.e1&&vue.etudes.e1.montant===undefined&&vue.etudes.e1.num==='1');
  // code révoqué
  {const t=JSON.parse(props.TOKENS);t['Pauline.D'].active=false;props.TOKENS=JSON.stringify(t);}await p.reload();await p.waitForTimeout(1500);
  ok('code révoqué : l’appli demande le code',await p.isVisible('#syt2'));
  // l'appli en mode salarié
  const p2=await ctx.newPage();await p2.goto('http://localhost:8766/index.html');await p2.evaluate(()=>localStorage.clear());await p2.reload();await p2.waitForTimeout(600);
  await p2.click('#nav [data-tab="params"]');await p2.click('[data-mn="home"]');await p2.click('[data-mn="addr"]');await p2.fill('#syu','https://script.google.com/macros/s/TEST/exec');await p2.fill('#syt',zoe.code);await p2.click('[data-mn="syncon"]');await p2.waitForTimeout(2000);
  await p2.waitForTimeout(300);const tz=await p2.innerText('body');  if(process.argv[2])await p2.screenshot({path:process.argv[2]+'-moi.png'});
  ok('appli salarié : onglets Moi et Paramètres seulement',(await p2.locator('#nav button').count())===2&&tz.includes('Bonjour Zoé'));
  ok('appli salarié : ses JEH et ce qu’elle va recevoir, rien d’autre',tz.includes('À recevoir')&&tz.includes('Étude 1')&&!tz.includes('Alex.M')&&!tz.includes('1 428'));
  // signalement d'une ligne manquante par le salarié
  await p2.click('[data-mn="signaler"]');await p2.fill('#sg_et','1');await p2.fill('#sg_min','120');await p2.fill('#sg_note','analyse échantillon 3');await p2.click('[data-mn="envoyersig"]');await p2.waitForTimeout(1500);
  const sig=rows.filter(r=>r[0]==='signalements').map(r=>JSON.parse(r[2]));
  ok('signalement enregistré, avec le nom imposé par le serveur',sig.length===1&&sig[0].par==='Zoé.B'&&sig[0].min===120&&sig[0].statut==='nouveau');
  ok('signalement visible dans « Mes signalements » (en attente)',(await p2.innerText('#view')).includes('En attente'));
  ok('un salarié ne peut pas signaler au nom d’un autre',(()=>{appel({token:zoe.code,action:'signaler',signalement:{date:'2026-10-02',min:60,par:'Alex.M'}});return rows.filter(r=>r[0]==='signalements').every(r=>JSON.parse(r[2]).par==='Zoé.B')})());
  if(process.argv[2])await p2.screenshot({path:process.argv[2]+'-moi2.png'});
  await p2.close();
  // un membre traite le signalement
  {const t2=JSON.parse(props.TOKENS);t2['Pauline.D'].active=true;props.TOKENS=JSON.stringify(t2);}
  const codeM=S.creerMonCode();
  const p3=await ctx.newPage();await p3.goto('http://localhost:8766/index.html');await p3.evaluate(c=>{localStorage.clear();localStorage.setItem('suivi.url','https://script.google.com/macros/s/TEST/exec');localStorage.setItem('suivi.token',c);localStorage.setItem('suivi.role','membre');localStorage.setItem('suivi.tab','finances');localStorage.setItem('suivi.fseg','jeh')},codeM);
  await p3.reload();await p3.waitForTimeout(2000);
  ok('membre : « Signalements à traiter » dans Finances › JEH',(await p3.innerText('#view')).includes('Signalements à traiter'));
  if(process.argv[2])await p3.screenshot({path:process.argv[2]+'-sig.png'});
  await p3.click('[data-sig^="ok:"]');await p3.waitForTimeout(2500);
  const lignes=rows.filter(r=>r[0]==='temps').map(r=>JSON.parse(r[2])).filter(x=>x.prenom==='Zoé.B'&&x.min===120);
  ok('« Créer la ligne » : ligne JEH préremplie créée, signalement marqué ajouté',lignes.length===1&&lignes[0].note==='analyse échantillon 3'&&JSON.parse(rows.find(r=>r[0]==='signalements')[2]).statut==='ajoutee');
  await p3.close();
  ok('aucune erreur JavaScript',errs.length===0||console.log(errs));
  await b.close();console.log(pass+' réussis, '+fail+' échoués');process.exitCode=fail?1:0})();
