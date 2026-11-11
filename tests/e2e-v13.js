// Test navigateur de l'app v13 (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node tests/e2e-v13.js
const {chromium}=require('playwright');const ok=(n,c)=>console.log((c?'✔ ':'✘ ')+n);
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.addInitScript(()=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('suivi.cache',JSON.stringify({etudes:{e1:{client:'B+T Environnement',adresse:'3 Av de Strasbourg, 68350 Brunstatt',num:'1',statut:'En réalisation',montant:1428,jeh:400,frais:70,date:'2026-09-01',collab:'Récurrente',cadence:'Mensuelle'}},factures:{f1:{etude:'1',type:'Solde',etat:'Émise',montant:1428,date:'2026-09-09',echeance:'2026-10-09',jehFact:2.8,fraisFact:70,prestation:'Détermination du taux de cendres'}},temps:{t1:{prenom:'Alex',etude:'1',min:480,nb:1,jeh:300,statut:'Pas payé',date:'2026-09-05'},t2:{prenom:'Zoé',etude:'1',min:240,nb:1,jeh:300,statut:'Payé',date:'2026-09-05'},t3:{prenom:'Zoé',etude:'1',min:60,nb:1,jeh:300,date:'2026-09-06'}},formation:{}}))});
await p.goto('http://localhost:8766/index.html');await p.waitForTimeout(1200);
const txt=await p.innerText('body');
ok('KPI JEH réalisées en tête',txt.includes('JEH réalisées'));
ok('1,5 JEH (Pas payé + Payé, sans la ligne sans statut)',txt.includes('1,5'));

ok('onglet Finances présent, Factures/Paie absents de la barre',await p.locator('#nav [data-tab="finances"]').count()===1&&await p.locator('#nav [data-tab="remun"]').count()===0);
await p.click('#nav [data-tab="finances"]');await p.waitForTimeout(300);const f=await p.innerText('#view');
ok('Finances : synthèse',f.includes('ENCAISSÉ HT')&&f.includes('Net à verser'));
await p.click('[data-fseg="paie"]');await p.waitForTimeout(300);ok('Finances : Paie',(await p.innerText('#view')).includes('Net à virer'));
ok('aide « par BV »',(await p.content()).includes('Par BV'));
await p.click('#nav [data-tab="dash"]');await p.waitForTimeout(300);ok('alerte facture périodique',(await p.innerText('body')).includes('Facture périodique à émettre'));
await p.click('#nav [data-tab="finances"]');await p.click('[data-fseg="factures"]');await p.waitForTimeout(300);await p.locator('[data-edit^="factures:"]').first().click();await p.waitForTimeout(300);
const pop=p.waitForEvent('popup');await p.click('[data-pdf]');const w=await pop;await w.waitForLoadState();const h=await w.content();
ok('facture générée : référence FS-1-202609-01 (nom de l’étude, ici son n°)',/FS-1-202609-01/.test(h));ok('facture : 2,8 JEH × 400 € + frais 70 € = 1 190 € HT, TTC 1 428 €',/1\s190,00/.test(h)&&/1\s428,00/.test(h)&&!h.includes('Attention : le total'));

ok('aucune erreur JS',errs.length===0||console.log(errs));await b.close()})();
