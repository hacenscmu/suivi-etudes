// E2E dédié à l'espace Salarié : vrai Code.gs via le simulateur Apps Script.
const {chromium}=require('playwright');
const path=require('path');
const {creerServeurAppsScriptSimule}=require('../backend/apps-script/simulateur.js');
const TOKEN='code-salarie-initial-123456';
const ID='membre_0001';
const donnees={
 membres:{[ID]:{id:ID,nomComplet:'Camille Martin',_v:1},membre_0002:{id:'membre_0002',nomComplet:'AUTRE SALARIE SECRET',_v:1}},
 clients:{client_0001:{id:'client_0001',raisonSociale:'CLIENT CONFIDENTIEL',_v:1}},
 etudes:{
  etude_0001:{id:'etude_0001',num:'HAC-001',resume:'Audit qualité personnel',clientId:'client_0001',_v:1},
  etude_0002:{id:'etude_0002',num:'HAC-SECRET',resume:'Étude confidentielle',clientId:'client_0001',_v:1}
 },
 factures:{facture_0001:{id:'facture_0001',etudeId:'etude_0001',montant:900,_v:1}},
 interventions:{
  interv_0001:{id:'interv_0001',etudeId:'etude_0001',membreId:ID,date:'2026-10-01',statut:'Pas payé',minutesIndividuelles:480,prixJehHt:300,_v:1},
  interv_0002:{id:'interv_0002',etudeId:'etude_0002',membreId:'membre_0002',date:'2026-10-02',statut:'Pas payé',minutesIndividuelles:960,prixJehHt:300,_v:1}
 },
 bvs:{
  bv_000001:{id:'bv_000001',reference:'BV-CAMILLE',date:'2026-10-15',net:120,_v:1},
  bv_000002:{id:'bv_000002',reference:'BV-PARTAGE',date:'2026-10-16',net:999,_v:1}
 },
 lignesBV:{
  ligne_0001:{id:'ligne_0001',bvId:'bv_000001',membreId:ID,jeh:1,_v:1},
  ligne_0002:{id:'ligne_0002',bvId:'bv_000002',membreId:ID,jeh:1,_v:1},
  ligne_0003:{id:'ligne_0003',bvId:'bv_000002',membreId:'membre_0002',jeh:2,_v:1}
 },
 formation:{form_00001:{id:'form_00001',membreId:ID,nom:'Formation personnelle',niveaux:{etude_0001:2},_v:1}},
 config:{main:{id:'main',smic:12.31,cot:{},patr:{},chomage:0,_v:1}}
};
const serveur=creerServeurAppsScriptSimule({token:TOKEN,membre:ID,role:'Salarie',donnees});
let dernierLoad=null, ecrituresRefusees=0, erreurs=[];
const ok=(nom,condition)=>{if(!condition){console.error('✘ '+nom);process.exitCode=1;}else console.log('✔ '+nom);};
(async()=>{
 const browser=await chromium.launch();
 const page=await browser.newPage();
 page.on('pageerror',e=>erreurs.push(e.message));
 page.on('dialog',d=>d.accept());
 await page.route('https://script.google.com/**',async route=>{
  const req=JSON.parse(route.request().postData());
  const res=await serveur.transport(req);
  if(req.action==='loadAll')dernierLoad=res.body.data;
  if(req.action==='save'&&res.body.error?.code==='FORBIDDEN')ecrituresRefusees++;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res.body)});
 });
 await page.goto('http://localhost:8766/refonte/app/index.html');
 await page.fill('input[name=url]','https://script.google.com/macros/s/TEST/exec');
 await page.fill('input[name=token]',TOKEN);
 await page.click('#loginForm button');
 await page.waitForSelector('#changerMonCode',{timeout:5000});
 await page.waitForTimeout(150);
 ok('connexion reconnue comme Salarié',await page.locator('#content').innerText().then(t=>t.includes('Bonjour Camille Martin')));
 ok('navigation limitée à Mon espace',await page.locator('#tabs [data-page]').count()===1&&await page.locator('#tabs [data-page]').first().getAttribute('data-page')==='Mon espace');
 ok('actions de création/édition absentes',await page.locator('#content button').count()===1&&await page.locator('#content button').first().getAttribute('id')==='changerMonCode');
 const body=await page.locator('body').innerText();
 ok('ses JEH, étude et formation sont visibles',body.includes('HAC-001')&&body.includes('1 JEH')&&body.includes('Formation personnelle'));
 ok('aucun client, facture ou autre salarié affiché',!body.includes('CLIENT CONFIDENTIEL')&&!body.includes('HAC-SECRET')&&!body.includes('AUTRE SALARIE SECRET')&&!body.includes('900'));
 ok('serveur : seules les données personnelles sont renvoyées',!!dernierLoad&&Object.keys(dernierLoad.membres).join(',')===ID&&Object.keys(dernierLoad.interventions).join(',')==='interv_0001'&&Object.keys(dernierLoad.etudes).join(',')==='etude_0001'&&Object.keys(dernierLoad.clients).length===0&&Object.keys(dernierLoad.factures).length===0);
 ok('montant du BV partagé masqué côté serveur',dernierLoad.bvs.bv_000002.net===undefined&&dernierLoad.bvs.bv_000001.net===120);
 const refus=await serveur.transport({apiVersion:3,action:'save',token:TOKEN,collection:'interventions',id:'interv_0001',record:{id:'interv_0001'},opId:'op_salarie_0001',expectedVersion:1});
 ok('serveur refuse toute écriture salarié',refus.body.error?.code==='FORBIDDEN');
 await page.click('#changerMonCode');
 await page.waitForFunction(old=>{const c=JSON.parse(localStorage.getItem('hac.v3.connexion')||'{}').token;return c&&c!==old;},TOKEN);
 const nouveauCode=JSON.parse(await page.evaluate(()=>localStorage.getItem('hac.v3.connexion'))).token;
 ok('changement de code effectué et code court stocké',nouveauCode!==TOKEN&&nouveauCode.length<=8);
 await page.click('#changerMonCode');
 await page.waitForFunction(old=>{const c=JSON.parse(localStorage.getItem('hac.v3.connexion')||'{}').token;return c&&c!==old;},nouveauCode);
 ok('le nouveau code authentifie les requêtes suivantes',JSON.parse(await page.evaluate(()=>localStorage.getItem('hac.v3.connexion'))).token!==nouveauCode);
 await page.click('#signalerJEH');
 await page.selectOption('select[name=etudeId]','etude_0001');
 await page.fill('input[name=date]','2026-10-03');
 await page.fill('input[name=duree]','240');
 await page.fill('input[name=nb]','2');
 await page.fill('input[name=commentaire]','Intervention oubliée');
 await page.click('button[data-ok]');
 await page.waitForFunction(()=>document.querySelector('#content')?.innerText.includes('En attente'));
 const reports=await serveur.lireDonnees();
 const report=Object.values(reports.signalementsJEH||{})[0];
 ok('signalement JEH créé avec identité serveur et durée répartie',!!report&&report.membreId===ID&&report.minutesIndividuelles===120&&report.statut==='En attente');
 ok('le salarié ne peut signaler que ses études associées',Object.keys(dernierLoad.signalementsJEH||{}).length===1);
 ok('aucune erreur JavaScript',erreurs.length===0);
 await browser.close();
 if(process.exitCode)process.exit(process.exitCode);
})().catch(e=>{console.error(e);process.exit(1);});
