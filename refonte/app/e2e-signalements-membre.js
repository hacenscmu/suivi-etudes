// E2E du traitement d'un signalement JEH par un Membre.
const {chromium}=require('playwright');
const crypto=require('node:crypto');
const {creerServeurAppsScriptSimule}=require('../backend/apps-script/simulateur.js');
const ADMIN='admin-token-test-0123456789';
const SALARIE='SALARIE8';
const ADMIN_ID='membre_0001';
const SALARIE_ID='membre_0002';
const donnees={
 membres:{
  [ADMIN_ID]:{id:ADMIN_ID,nomComplet:'Membre trésorerie',_v:1},
  [SALARIE_ID]:{id:SALARIE_ID,nomComplet:'Camille Martin',_v:1}
 },
 etudes:{etude_0001:{id:'etude_0001',num:'HAC-001',resume:'Audit qualité',date:'2026-10-01',statut:'En réalisation',montant:0,client:'Client A',_v:1}},
 interventions:{interv_0001:{id:'interv_0001',etudeId:'etude_0001',membreId:SALARIE_ID,date:'2026-10-01',statut:'Pas payé',minutesIndividuelles:120,_v:1}}
};
const serveur=creerServeurAppsScriptSimule({token:ADMIN,donnees,membre:ADMIN_ID,role:'Membre'});
serveur.api.enregistrerJeton(SALARIE_ID,crypto.createHash('sha256').update(SALARIE).digest('hex'),'Salarie');
const ok=(nom,condition)=>{if(!condition){console.error('✘ '+nom);process.exitCode=1;}else console.log('✔ '+nom);};
(async()=>{
 const cree=await serveur.transport({apiVersion:3,action:'signalerJEH',token:SALARIE,numEtude:'HAC-001',date:'2026-10-03',duree:240,nb:2,commentaire:'Oubli'});
 if(!cree.body.ok)throw new Error(cree.body.error.message);
 const refusInitial=await serveur.transport({apiVersion:3,action:'signalerJEH',token:SALARIE,numEtude:'HAC-001',date:'2026-10-04',duree:60,nb:1,commentaire:'Deuxième oubli'});
 if(!refusInitial.body.ok)throw new Error(refusInitial.body.error.message);
 const browser=await chromium.launch(),page=await browser.newPage(),erreurs=[];
 page.on('pageerror',e=>erreurs.push(e.message));
 page.on('dialog',async d=>{console.log('DIALOG '+d.message());await d.accept();});
 await page.route('https://script.google.com/**',async route=>{
  const req=JSON.parse(route.request().postData());
  const res=await serveur.transport(req);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res.body)});
 });
 await page.goto('http://localhost:8766/refonte/app/index.html');
 await page.fill('input[name=url]','https://script.google.com/macros/s/TEST/exec');
 await page.fill('input[name=token]',ADMIN);
 await page.click('#loginForm button');
 await page.waitForSelector('#tabs [data-page="Finances"]',{timeout:5000});
 await page.click('#tabs [data-page="Finances"]');
 await page.waitForSelector('[data-signalement="ajouter"]');
 ok('le Membre voit le signalement en attente',await page.locator('#content').innerText().then(t=>t.includes('Camille Martin')&&t.includes('HAC-001')));
 await page.click('[data-signalement="ajouter"]');
 await page.waitForFunction(()=>document.querySelector('#content')?.innerText.includes('Ajoutée'),{timeout:5000});
 const records=serveur.lireDonnees();
 const signalement=Object.values(records.signalementsJEH||{}).find(x=>x.date==='2026-10-03');
 const ligne=Object.values(records.interventions||{}).find(x=>x.signalementId===signalement.id);
 ok('le signalement passe à Ajoutée et son statut est affiché',signalement.statut==='Ajoutée'&&await page.locator('#content').innerText().then(t=>t.includes('Ajoutée')));
 ok('une intervention est créée avec le salarié, l’étude, la date et la durée répartie',!!ligne&&ligne.membreId===SALARIE_ID&&ligne.etudeId==='etude_0001'&&ligne.date==='2026-10-03'&&ligne.minutesIndividuelles===120);
 await page.click('[data-signalement="refuser"]');
 await page.waitForFunction(()=>document.querySelector('#content')?.innerText.includes('Refusée'),{timeout:5000});
 const apresRefus=serveur.lireDonnees();
 const refus=Object.values(apresRefus.signalementsJEH||{}).find(x=>x.date==='2026-10-04');
 ok('le refus est affiché et ne crée aucune intervention',refus?.statut==='Refusée'&&!Object.values(apresRefus.interventions||{}).some(x=>x.signalementId===refus.id));
 ok('aucune erreur JavaScript',erreurs.length===0);
 await browser.close();
 if(process.exitCode)process.exit(process.exitCode);
})().catch(e=>{console.error(e);process.exit(1);});
