// Test de bout en bout dans Chromium (CI et local) :
// (python3 -m http.server 8766, à la racine du dépôt) puis node refonte/app/e2e-navigateur.js
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
let failures=0;const ok=(n,c)=>{if(!c)failures++;console.log((c?'✔ ':'✘ ')+n);};
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();const errs=[];
p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
let offline=false;
await p.route('https://script.google.com/**',async r=>{if(offline)return r.abort();const res=await srv.transport(JSON.parse(r.request().postData()));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res.body)})});
await p.goto('http://localhost:8766/refonte/app/index.html');
ok('écran de connexion affiché',await p.isVisible('#loginForm'));
await p.fill('input[name=url]','https://script.google.com/macros/s/TEST/exec');await p.fill('input[name=token]','mauvais-jeton');await p.click('#loginForm button');await p.waitForTimeout(400);
ok('jeton refusé → message',(await p.textContent('#loginMsg')).includes('refusé'));
await p.fill('input[name=url]','https://script.google.com/macros/s/TEST/exec');await p.fill('input[name=token]',TOKEN);await p.click('#loginForm button');await p.waitForTimeout(600);
ok('connexion réussie, tableau de bord affiché',await p.isHidden('#login')&&(await p.textContent('#content')).includes('JEH travaillées'));
const remplir=async(o)=>{for(const[k,v]of Object.entries(o)){const el=p.locator('dialog [name="'+k+'"]');if(await el.evaluate(e=>e.tagName)==='SELECT')await el.selectOption(v);else await el.fill(String(v));}await p.click('dialog [data-ok]');await p.waitForTimeout(500);};
const payerFacture=async()=>{await p.click('#tabs [data-page="Finances"]');await p.click('[data-invoice="facture_0001"]');const etat=await p.locator('dialog [name=etat]').inputValue();await remplir({etat:etat==='Payée'?'Émise':'Payée'});};
await payerFacture();
ok('facture payée enregistrée sur le serveur',srv.lireDonnees().factures.facture_0001.etat==='Payée');
offline=true;await payerFacture();
ok('hors ligne : bannière « en attente »',(await p.textContent('#syncBanner')).includes('gardée'));
ok('hors ligne : serveur inchangé',srv.lireDonnees().factures.facture_0001.etat==='Payée');
await p.reload();await p.waitForTimeout(600);
ok('rechargement hors ligne : données du cache, modif en attente visible',(await p.textContent('#syncBanner')).includes('gardée'));
offline=false;await p.click('#tabs [data-page="Réglages"]');await p.click('#syncNow');await p.waitForTimeout(600);
ok('retour réseau : modif envoyée',srv.lireDonnees().factures.facture_0001.etat==='Émise'&&srv.lireDonnees().factures.facture_0001._v===3);
const D=()=>srv.lireDonnees();
await p.click('#tabs [data-page="Études"]');await p.click('#addClient');await remplir({raisonSociale:'Novalys',relationType:'longue_duree',cadenceFacturation:'mensuelle',dateProchaineFacture:'2026-10-10'});
const cli=Object.values(D().clients).find(c=>c.raisonSociale==='Novalys');ok('client créé (longue durée + cadence)',cli&&cli.relationType==='longue_duree'&&cli.cadenceFacturation==='mensuelle');await p.click('#tabs [data-page="Accueil"]');ok('alerte de facture périodique affichée',(await p.textContent('#content')).includes('Facture périodique à émettre'));await p.click('#tabs [data-page="Études"]');
await p.click('#addStudy');await remplir({clientId:cli.id,num:'HAC-002',statut:'Convention signée',montant:1428,jeh:400,frais:70});
const et=Object.values(D().etudes).find(e=>e.num==='HAC-002');ok('étude créée avec prix JEH et frais',et&&et.jeh===400&&et.frais===70&&et.clientId===cli.id);
await p.click('[data-etude="'+et.id+'"]');ok('rapport d’étude affiché',(await p.textContent('#content')).includes('Finances'));ok('relation longue durée visible dans le rapport',(await p.textContent('#content')).includes('Longue durée'));await p.click('[data-modifier-etude]');await remplir({statut:'En réalisation',cadenceFacturationMode:'aucune'});ok('étude modifiée et cadence client désactivée',D().etudes[et.id].statut==='En réalisation'&&D().etudes[et.id]._v===2&&D().etudes[et.id].cadenceFacturationMode==='aucune');await p.click('#tabs [data-page="Accueil"]');ok('surcharge d’étude : aucune alerte périodique',(await p.textContent('#content')).includes('Facture périodique à émettre')===false);await p.click('#tabs [data-page="Études"]');
await p.click('#tabs [data-page="Équipe"]');await p.click('#addMembre');await remplir({nomComplet:'Lucas Bernard'});
const mb=Object.values(D().membres).find(m=>m.nomComplet==='Lucas Bernard');ok('membre créé',!!mb);
await p.click('#addInterv');await remplir({etudeId:et.id,membreId:mb.id,statut:'Pas payé',duree:120,nb:2,prixJehHt:300});
const iv=Object.values(D().interventions).find(i=>i.membreId===mb.id);ok('intervention : 120 min à 2 = 60 min individuelles',iv&&iv.minutesIndividuelles===60);
await p.click('#addInterv');await remplir({etudeId:et.id,membreId:mb.id,duree:60,nb:0});ok('nb = 0 refusé avec message',(await p.textContent('dialog [data-erreur]')).includes('entier'));await p.click('dialog button[value=cancel]');
await p.click('#addBV');await remplir({membreId:mb.id,jeh:0.5,reference:'BV-TEST'});
ok('BV de 0,5 JEH accepté, mention assiette 1 JEH',Object.keys(D().bvs).length===1&&Object.values(D().lignesBV)[0].jeh===0.5&&(await p.textContent('#content')).includes('calculées sur 1 JEH'));
await p.click('#tabs [data-page="Finances"]');await p.click('#addFacture');await remplir({etudeId:et.id,type:'Acompte',etat:'Payée',montant:500});
const fa=Object.values(D().factures).find(f=>f.etudeId===et.id);ok('facture créée, date de paiement remplie',fa&&fa.etat==='Payée'&&!!fa.datePaiement);
await p.setViewportSize({width:390,height:800});await p.waitForTimeout(200);
ok('pas de défilement horizontal sur téléphone',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
ok('aucune erreur JavaScript',errs.length===0||console.log(errs));
await b.close();if(failures)process.exitCode=1;})();
