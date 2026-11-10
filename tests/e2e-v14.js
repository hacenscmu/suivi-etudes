// Test navigateur v14 (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node tests/e2e-v14.js <préfixe-captures>
const {chromium}=require('playwright');const ok=(n,c)=>console.log((c?'✔ ':'✘ ')+n);const out=process.argv[2];
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:430,height:1300}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
await p.addInitScript(()=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('suivi.cache',JSON.stringify({etudes:{
e1:{client:'B+T Environnement',num:'1',statut:'En réalisation',montant:1428,jeh:400,frais:70,date:'2026-09-01',resume:'Taux de cendres'},
e2:{client:'b+t environnement',num:'5',statut:'Archivée',montant:2400,jeh:400,date:'2025-11-01'},
e3:{client:'Soléa Industrie',num:'2',statut:'Convention signée',montant:5040,jeh:400,date:'2026-10-04'}},
factures:{f1:{etude:'1',type:'Acompte',etat:'Payée',montant:500,date:'2026-09-02'},f2:{etude:'5',type:'Solde',etat:'Payée',montant:2400,date:'2025-12-01',datePaiement:'2025-12-20'}},
temps:{t1:{prenom:'Alex',etude:'1',min:240,nb:1,jeh:300,statut:'Pas payé',date:'2026-09-05'},t2:{prenom:'Zoé',etude:'1',min:960,nb:1,jeh:300,statut:'Pas payé',date:'2026-09-05'},t3:{prenom:'Zoé',etude:'5',min:480,nb:1,jeh:300,statut:'Payé',date:'2025-11-05'}},formation:{},
config:null}));localStorage.setItem('suivi.tab','etudes')});
await p.goto('http://localhost:8766/index.html');await p.waitForTimeout(1200);
await p.click('[data-eseg="clients"]');await p.waitForTimeout(300);let t=await p.innerText('#view');
ok('2 clients (B+T regroupé sans tenir compte des majuscules)',t.includes('Clients · 2')&&(t.match(/B\+T Environnement/g)||[]).length===1);
await p.screenshot({path:out+'-clients.png'});
await p.click('[data-openc="b+t environnement"]');await p.waitForTimeout(300);t=await p.innerText('#view');
ok('fiche client : chiffres et études',t.includes('Coordonnées')&&t.includes('CA signé TTC')&&t.includes('Taux de cendres'));
await p.click('[data-editc]');await p.waitForTimeout(300);
await p.fill('#edit [data-f="contact"]','Mme Martin, responsable');await p.fill('#edit [data-f="adresse"]','3 Av de Strasbourg, 68350 Brunstatt');await p.selectOption('#edit [data-f="collab"]','Récurrente');await p.selectOption('#edit [data-f="cadence"]','Mensuelle');
await p.fill('#edit [data-f="nom"]','B+T Environnement SAS');await p.locator('#edit [data-f="nom"]').dispatchEvent('change');await p.waitForTimeout(200);
await p.click('#edit .mb.solid');await p.waitForTimeout(400);t=await p.innerText('#view');
ok('renommage propagé aux études',t.includes('B+T Environnement SAS')&&!t.toLowerCase().includes('b+t environnement\n'));
ok('collaboration récurrente affichée',t.includes('Récurrente · mensuelle'));
await p.screenshot({path:out+'-fiche.png'});
await p.click('[data-closec]');await p.click('[data-eseg="etudes"]');await p.waitForTimeout(300);
ok('étude hérite de la récurrence du client (alerte périodique)',(await p.innerText('#view')).includes('Récurrente'));
await p.click('#nav [data-tab="finances"]');await p.click('[data-fseg="factures"]');await p.waitForTimeout(300);t=await p.innerText('#view');
ok('facture sans date de paiement : pas de fausse date',t.includes('date de paiement à renseigner')&&t.includes('Payée le 20/12/2025'));
await p.click('[data-fseg="paie"]');await p.waitForTimeout(300);t=await p.innerText('#view');
ok('cartes étudiants : net, brut, cotisations, coût',t.includes('net à virer')&&t.includes('Cotisations')&&t.includes('Coût Junior'));
ok('Alex 0,5 JEH : mention cotisé sur 1 JEH',t.includes('calculées sur 1 JEH'));
await p.screenshot({path:out+'-paie.png'});
ok('aucune erreur JS',errs.length===0||console.log(errs));await b.close()})();
