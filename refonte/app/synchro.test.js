const test = require("node:test");
const assert = require("node:assert/strict");
const { creerSynchro } = require("./synchro");
const { creerClientApiV3 } = require("../backend/client-api-v3");
const { creerServeurAppsScriptSimule } = require("../backend/apps-script/simulateur");
const { preparerAjout, preparerModification } = require("../application/commandes");

const TOKEN = "jeton-application-0123456789";
const donnees = {
  clients: { client_0001: { id: "client_0001", raisonSociale: "Soléa", relationType: "ponctuelle", _v: 1 } },
  membres: { membre_0001: { id: "membre_0001", nomComplet: "Camille Martin", _v: 1 } },
  etudes: { etude_0001: { id: "etude_0001", clientId: "client_0001", client: "Soléa", num: "HAC-001", date: "2026-09-01", statut: "En réalisation", montant: 1200, jeh: 400, _v: 1 } },
  factures: { facture_0001: { id: "facture_0001", etudeId: "etude_0001", type: "Acompte", etat: "Émise", montant: 600, _v: 1 } },
};
function memoire() { const m = new Map(); return { m, lire: async k => (m.has(k) ? JSON.parse(m.get(k)) : null), ecrire: async (k, v) => { m.set(k, JSON.stringify(v)); } }; }
function monter({ serveur, stockage, enLigne = { v: true } } = {}) {
  serveur = serveur || creerServeurAppsScriptSimule({ token: TOKEN, donnees: JSON.parse(JSON.stringify(donnees)) });
  stockage = stockage || memoire();
  let n = 0;
  const client = creerClientApiV3({ transport: async q => { if (!enLigne.v) throw new Error("hors ligne"); return serveur.transport(q); }, obtenirToken: () => TOKEN });
  return { serveur, stockage, enLigne, s: creerSynchro({ client, stockage, creerOpId: () => "op_test_" + String(++n).padStart(6, "0") + "_" + Math.random().toString(36).slice(2, 8) }) };
}
const payer = s => preparerModification({ etat: s.lireEtat(), collection: "factures", id: "facture_0001", modifications: { etat: "Payée" } }).commande;

test("démarrage : charge les données du serveur (vrai Code.gs simulé)", async () => {
  const { s } = monter();
  const st = await s.demarrer();
  assert.equal(st.source, "serveur");
  assert.equal(s.lireEtat().etudes[0].num, "HAC-001");
});

test("une modification est enregistrée sur le serveur et la version suit", async () => {
  const { s, serveur } = monter();
  await s.demarrer();
  const r = await s.executer(payer(s));
  assert.equal(r.valide, true);
  assert.equal(r.envoi.restantes, 0);
  assert.equal(serveur.lireDonnees().factures.facture_0001.etat, "Payée");
  assert.equal(serveur.lireDonnees().factures.facture_0001._v, 2);
  assert.equal(s.lireEtat().factures[0]._v, 2);
});

test("un ajout d'étude arrive sur le serveur avec son lien client", async () => {
  const { s, serveur } = monter();
  await s.demarrer();
  const c = preparerAjout({ etat: s.lireEtat(), collection: "etudes", donnees: { clientId: "client_0001", client: "Soléa", num: "HAC-002", date: "2026-11-10", statut: "Devis envoyé", montant: 900, jeh: 400 }, creerId: () => "etude_0002" });
  assert.equal((await s.executer(c.commande)).valide, true);
  assert.equal(serveur.lireDonnees().etudes.etude_0002.num, "HAC-002");
});

test("hors ligne : modifications gardées, affichées, puis envoyées au retour du réseau sans conflit", async () => {
  const m = monter();
  await m.s.demarrer();
  m.enLigne.v = false;
  await m.s.executer(payer(m.s));
  await m.s.executer(preparerModification({ etat: m.s.lireEtat(), collection: "factures", id: "facture_0001", modifications: { montant: 650 } }).commande);
  assert.equal((await m.s.statut()).enAttente, 2);
  assert.equal(m.s.lireEtat().factures[0].montant, 650);
  assert.equal(m.serveur.lireDonnees().factures.facture_0001.etat, "Émise");
  m.enLigne.v = true;
  const r = await m.s.synchroniser();
  assert.equal(r.restantes, 0);
  assert.equal(r.bloquePar, null);
  const f = m.serveur.lireDonnees().factures.facture_0001;
  assert.equal(f.etat, "Payée"); assert.equal(f.montant, 650); assert.equal(f._v, 3);
});

test("redémarrage hors ligne : repart du cache avec les modifications en attente", async () => {
  const m = monter();
  await m.s.demarrer();
  m.enLigne.v = false;
  await m.s.executer(payer(m.s));
  const m2 = monter({ serveur: m.serveur, stockage: m.stockage, enLigne: m.enLigne });
  const st = await m2.s.demarrer();
  assert.equal(st.source, "cache");
  assert.equal(st.enAttente, 1);
  assert.equal(m2.s.lireEtat().factures[0].etat, "Payée");
  m.enLigne.v = true;
  await m2.s.synchroniser();
  assert.equal(m.serveur.lireDonnees().factures.facture_0001.etat, "Payée");
});

test("conflit avec un autre appareil : rien n'est écrasé, la file s'arrête, on peut repartir du serveur", async () => {
  const a = monter();
  await a.s.demarrer();
  const b = monter({ serveur: a.serveur });
  await b.s.demarrer();
  await b.s.executer(preparerModification({ etat: b.s.lireEtat(), collection: "factures", id: "facture_0001", modifications: { montant: 700 } }).commande);
  const r = await a.s.executer(payer(a.s));
  assert.equal(r.envoi.bloquePar.code, "VERSION_CONFLICT");
  assert.equal(a.serveur.lireDonnees().factures.facture_0001.montant, 700);
  assert.equal(a.serveur.lireDonnees().factures.facture_0001.etat, "Émise");
  await a.s.abandonnerEtRecharger();
  assert.equal(a.s.lireEtat().factures[0].montant, 700);
  assert.equal((await a.s.statut()).enAttente, 0);
});

test("une commande métier invalide n'est ni appliquée ni envoyée", async () => {
  const { s } = monter();
  await s.demarrer();
  const r = await s.executer({ type: "modifier", collection: "factures", id: "facture_0001", modifications: { etudeId: "etude_inexistante" } });
  assert.equal(r.valide, false);
  assert.equal((await s.statut()).enAttente, 0);
});

test("BV et sa ligne enregistrés ensemble, dans l'ordre parent → enfant", async () => {
  const { s, serveur } = monter();
  await s.demarrer();
  const etat = s.lireEtat();
  const p1 = preparerAjout({ etat, collection: "bvs", donnees: { date: "2026-11-10", reference: "BV-1" }, creerId: () => "bv_00000001" });
  const p2 = preparerAjout({ etat: { ...etat, bvs: [p1.commande.enregistrement] }, collection: "lignesBV", donnees: { bvId: "bv_00000001", membreId: "membre_0001", jeh: 0.5 }, creerId: () => "ligne_00000001" });
  const seul = await s.executer(p2.commande);
  assert.equal(seul.valide, false, "une ligne sans son BV est refusée");
  const r = await s.executerPlusieurs([p1.commande, p2.commande]);
  assert.equal(r.valide, true);
  assert.equal(r.envoi.restantes, 0);
  assert.equal(serveur.lireDonnees().lignesBV.ligne_00000001.jeh, 0.5);
});
