// Test de bout en bout dans un vrai navigateur (Playwright requis, hors CI) :
// (cd refonte && python3 -m http.server 8766) puis node refonte/app/e2e-navigateur.js
// Le serveur Apps Script est le vrai Code.gs exécuté par le simulateur ; les appels réseau sont interceptés.
const {chromium}=require('playwright');const path=require('path');
const {creerServeurAppsScriptSimule}=require(path.join(__dirname,'..','backend','apps-script','simulateur.js'));
const TOKEN='jeton-e2e-0123456789abcdef';
const srv=creerServeurAppsScriptSimule({token:TOKEN,donnees:{
 clients:{client_0001:{id:'client_0001',raisonSociale:'Soléa',relationType:'ponctuelle',_v:1}},
 membres:{membre_0001:{id:'membre_0001',nomComplet:'Camille Martin',_v:1}},
 etudes:{etude_0001:{id:'etude_0001',clientId:'client_0001',client:'Soléa',num:'HAC-001',date:'2026-09-01',statut:'En réalisation',montant:1200,jeh:400,_v:1}},
 factures:{facture_0001:{id:'facture_0001',etudeId:'etude_0001',type:'Acompte',etat:'Émise',montant:600,_v:1}},
 interventions:{interv_0001:{id:'interv_0001',etudeId:'etude_0001',membreId:'membre_0001',date:'2026-10-01',statut:'Payé',minutesIndividuelles:960,prixJehHt:300,_v:1}}}});
const ok=(n,c)=>console.log((c?'✔ ':'✘ ')+n);
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();const errs=[];
p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
let offline=false;
await p.route('https://script.google.com/**',async r=>{if(offline)return r.abort();const res=await srv.transport(JSON.parse(r.request().postData()));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res.body)})});
await p.goto('http://localhost:8766/app/index.html');
ok('écran de connexion affiché',await p.isVisible('#loginForm'));
await p.fill('input[name=url]','https://script.google.com/macros/s/TEST/exec');await p.fill('input[name=token]','mauvais-jeton');await p.click('#loginForm button');await p.waitForTimeout(400);
ok('jeton refusé → message',(await p.textContent('#loginMsg')).includes('refusé'));
await p.fill('input[name=url]','https://script.google.com/macros/s/TEST/exec');await p.fill('input[name=token]',TOKEN);await p.click('#loginForm button');await p.waitForTimeout(600);
ok('connexion réussie, tableau de bord affiché',await p.isHidden('#login')&&(await p.textContent('#content')).includes('JEH travaillées'));
await p.click('#tabs [data-page="Finances"]');await p.click('[data-invoice="facture_0001"]');await p.waitForTimeout(500);
ok('facture payée enregistrée sur le serveur',srv.lireDonnees().factures.facture_0001.etat==='Payée');
offline=true;await p.click('[data-invoice="facture_0001"]');await p.waitForTimeout(500);
ok('hors ligne : bannière « en attente »',(await p.textContent('#syncBanner')).includes('gardée'));
ok('hors ligne : serveur inchangé',srv.lireDonnees().factures.facture_0001.etat==='Payée');
await p.reload();await p.waitForTimeout(600);
ok('rechargement hors ligne : données du cache, modif en attente visible',(await p.textContent('#syncBanner')).includes('gardée'));
offline=false;await p.click('#tabs [data-page="Réglages"]');await p.click('#syncNow');await p.waitForTimeout(600);
ok('retour réseau : modif envoyée',srv.lireDonnees().factures.facture_0001.etat==='Émise'&&srv.lireDonnees().factures.facture_0001._v===3);
await p.click('#tabs [data-page="Études"]');await p.click('#addStudy');await p.selectOption('select[name=clientId]','client_0001');await p.fill('input[name=num]','HAC-002');await p.fill('input[name=montant]','900');await p.click('#saveStudy');await p.waitForTimeout(600);
ok('nouvelle étude créée sur le serveur',Object.values(srv.lireDonnees().etudes).some(e=>e.num==='HAC-002'));
await p.setViewportSize({width:390,height:800});await p.waitForTimeout(200);
ok('pas de défilement horizontal sur téléphone',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
ok('aucune erreur JavaScript',errs.length===0||console.log(errs));
await b.close();})();
