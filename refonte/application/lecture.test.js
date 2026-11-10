const test = require("node:test");
const assert = require("node:assert/strict");
const {
  creerEtatVide,
  validerEtat,
  construireVueApplication,
} = require("./lecture");

const etat = () => ({
  clients: [{ id: "client_001", raisonSociale: "Client Alpha" }],
  membres: [{ id: "membre_001", nomComplet: "Alice Martin" }],
  etudes: [{
    id: "etude_0001",
    clientId: "client_001",
    num: "HAC-2026-001",
    date: "2026-10-01",
    client: "Client Alpha",
    statut: "Convention signée",
    montant: 3600,
    jeh: 12,
  }],
  factures: [{ id: "facture_001", etudeId: "etude_0001", montant: 1800, etat: "Payée" }],
  interventions: [{
    id: "interv_001",
    etudeId: "etude_0001",
    membreId: "membre_001",
    date: "2026-10-10",
    statut: "Pas payé",
    minutesIndividuelles: 480,
    prixJehHt: 250,
  }],
  bvs: [{ id: "bv_000001" }],
  lignesBV: [{
    id: "ligne_0001",
    bvId: "bv_000001",
    membreId: "membre_001",
    jeh: 1,
  }],
});

test("crée un état vide avec toutes les collections attendues", () => {
  const vide = creerEtatVide();
  assert.deepEqual(Object.keys(vide), [
    "clients", "membres", "etudes", "factures",
    "interventions", "bvs", "lignesBV",
  ]);
  assert.ok(Object.values(vide).every(Array.isArray));
});

test("refuse un état absent ou une collection absente", () => {
  assert.equal(validerEtat(null).valide, false);
  const incomplet = creerEtatVide();
  delete incomplet.factures;
  assert.equal(validerEtat(incomplet).valide, false);
});

test("valide les identifiants stables et les références entre collections", () => {
  assert.equal(validerEtat(etat()).valide, true);
});

test("bloque les identifiants dupliqués", () => {
  const data = etat();
  data.membres.push({ ...data.membres[0] });
  const r = validerEtat(data);
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.raison === "Identifiant dupliqué"));
});

test("bloque les factures, interventions et lignes BV orphelines", () => {
  const data = etat();
  data.factures[0].etudeId = "etude_absente";
  data.interventions[0].membreId = "membre_absent";
  data.lignesBV[0].bvId = "bv_absent";
  const r = validerEtat(data);
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.length >= 3);
});

test("assemble une vue de lecture reliée pour l'interface", () => {
  const r = construireVueApplication(etat(), { dateFin: "2026-11-10", nombreMois: 2 });
  assert.equal(r.valide, true);
  assert.equal(r.tableauDeBord.caSigne, 3000);
  assert.equal(r.tableauDeBord.montantFacture, 1500);
  assert.equal(r.tableauDeBord.encaisse, 1500);
  assert.equal(r.tableauDeBord.totalJehTravaillees, 1);
  assert.equal(r.listes.etudes[0].clientLibelle, "Client Alpha");
  assert.equal(r.listes.etudes[0].factures.length, 1);
  assert.equal(r.listes.interventions[0].membreLibelle, "Alice Martin");
  assert.equal(r.listes.bvs[0].lignes[0].membreLibelle, "Alice Martin");
});

test("ne renvoie aucune vue partielle si l'état contient une anomalie", () => {
  const data = etat();
  data.factures[0].etudeId = "etude_absente";
  const r = construireVueApplication(data);
  assert.equal(r.valide, false);
  assert.equal(r.tableauDeBord, null);
  assert.equal(r.listes, null);
});

test("ne modifie jamais les données fournies", () => {
  const data = etat();
  const avant = JSON.stringify(data);
  construireVueApplication(data, { dateFin: "2026-11-10" });
  assert.equal(JSON.stringify(data), avant);
});

test("ne fabrique pas de nom lorsqu'une référence client est absente", () => {
  const data = etat();
  data.etudes[0].clientId = undefined;
  const r = construireVueApplication(data, { dateFin: "2026-11-10" });
  assert.equal(r.listes.etudes[0].clientLibelle, "Client Alpha");
});
