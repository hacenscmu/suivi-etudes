// Test navigateur du détail de facture (Playwright, hors CI) : python3 -m http.server 8766 à la racine, puis node tests/e2e-facture-lignes.js <préfixe-captures>
const {chromium}=require('playwright');const ok=(n,c)=>console.log((c?'✔ ':'✘ ')+n);
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:430,height:1400}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
await p.addInitScript(()=>{if(localStorage.getItem('s'))return;localStorage.setItem('s','1');localStorage.setItem('suivi.tab','finances');localStorage.setItem('suivi.fseg','factures');localStorage.setItem('suivi.cache',JSON.stringify({etudes:{e1:{client:'B+T Environnement',num:'1',statut:'En réalisation',montant:1428,jeh:400,date:'2026-09-01'}},factures:{f1:{etude:'1',type:'Solde',etat:'Émise',montant:0,date:'2026-09-09'}},temps:{},formation:{}}))});
await p.goto('http://localhost:8766/index.html');await p.waitForTimeout(1000);
await p.locator('[data-edit^="factures:"]').first().click();await p.waitForTimeout(300);
const add=async k=>{await p.click(`#edit [data-lact="add:${k}"]`);await p.waitForTimeout(150)};
await add('titre');await p.locator('#edit .lgn.titre input').fill('Échantillon 1');await p.locator('#edit .lgn.titre input').blur();
await add('jeh');let n=await p.locator('#edit [data-lf="lib"]').count();await p.locator('#edit [data-lf="lib"]').nth(n-1).fill('Analyse taux biomasse/cendres');await p.locator('#edit [data-lf="ttc"]').nth(0).fill('168');
await add('jeh');n=await p.locator('#edit [data-lf="lib"]').count();await p.locator('#edit [data-lf="lib"]').nth(n-1).fill('Rapport d’étude');await p.locator('#edit [data-lf="ttc"]').nth(1).fill('24');
await add('frais');await p.locator('#edit [data-lf="ttc"]').nth(2).fill('12');
ok('nombre de JEH déduit : 168 € TTC → 140 € HT → 0,35 JEH à 400 €',(await p.locator('#edit .lj b').first().textContent())==='0,35');await p.waitForTimeout(200);
for(let k=0;k<6;k++){await p.locator('#edit .lgn.titre [data-lact^="dup"]').last().click();await p.waitForTimeout(120)}
const titres=await p.locator('#edit .lgn.titre input').evaluateAll(l=>l.map(x=>x.value));
ok('7 sections, numérotées 1 à 7',titres.length===7&&titres[6]==='Échantillon 7');
const tot=await p.textContent('#ltot');ok('total : 2,8 JEH, 1 190 € HT, 1 428 € TTC',/2,8 JEH/.test(tot)&&/1\s190,00/.test(tot)&&/1\s428,00/.test(tot));
ok('montant TTC de la facture mis à jour',(await p.locator('#edit [data-f="montant"]').inputValue())==='1428');
await p.screenshot({path:process.argv[2]+'-editeur.png'});
const pop=p.waitForEvent('popup');await p.click('[data-pdf]');const w=await pop;await w.waitForLoadState();const h=await w.content();
ok('PDF : sections, lignes, total JEH',(h.match(/Échantillon \d/g)||[]).length===7&&h.includes('Nombre total de JEH')&&/1\s428,00/.test(h)&&!h.includes('Attention'));
await w.setViewportSize({width:800,height:1400});await w.screenshot({path:process.argv[2]+'-pdf.png',fullPage:true});
ok('aucune erreur JS',errs.length===0||console.log(errs));await b.close()})();
