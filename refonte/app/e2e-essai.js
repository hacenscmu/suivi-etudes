// Test navigateur du mode essai (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node refonte/app/e2e-essai.js
const {chromium}=require('playwright');const ok=(n,c)=>console.log((c?'✔ ':'✘ ')+n);
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
let net=0;p.on('request',r=>{if(!r.url().startsWith('http://localhost'))net++});
await p.goto('http://localhost:8766/refonte/app/index.html');await p.click('#essai');await p.waitForTimeout(600);
ok('alertes affichées à l’accueil',(await p.textContent('#content')).includes('Alertes à traiter'));ok('mode essai démarré avec données d’exemple',(await p.textContent('#syncBanner')).includes('Mode essai')&&(await p.textContent('#content')).includes('JEH'));
await p.click('#tabs [data-page="Études"]');await p.click('[data-etude="etude_0002"]');await p.selectOption('dialog [name=statut]','Devis signé');await p.click('dialog [data-ok]');await p.waitForTimeout(400);
await p.reload();await p.waitForTimeout(600);await p.click('#tabs [data-page="Études"]');
ok('modification conservée après rechargement',(await p.textContent('#content')).includes('Devis signé'));
await p.click('#tabs [data-page="Équipe"]');ok('paie : Lucas à verser',(await p.textContent('#content')).includes('À verser'));
await p.click('[data-payer="membre_0002"]');await p.waitForTimeout(500);ok('BV créé, lignes passées à Payé',(await p.textContent('#content')).includes('Personne à payer')||!(await p.locator('[data-payer="membre_0002"]').count()));
ok('aucun appel réseau externe',net===0);ok('aucune erreur JS',errs.length===0||console.log(errs));await b.close()})();
