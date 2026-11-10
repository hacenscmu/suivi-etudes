const test = require("node:test");
const assert = require("node:assert/strict");
const { calculerTableauDeBord } = require("./tableau-de-bord");

const base = {
  dateFin: "2026-11-10",
  nombreMois: 3,
  etudes: [
    { id: "etude_0001", montant: 5000 },
    { id: "etude_0002", montant: 2000 },
  ],
  factures: [
    { id: "facture_001", etudeId: "etude_0001", montant: 2000, etat: "Payée" },
    { id: "facture_002", etudeId: "etude_0001", montant: 1000, etat: "Émise" },
    { id: "facture_003", etudeId: "etude_0002", montant: 1500, etat: "Payée" },
  ],
  interventions: [
    { id: "t1", etudeId: "etude_0001", membreId: "membre_001", date: "2026-09-15", statut: "Payé", minutesIndividuelles: 960 },
    { id: "t2", etudeId: "etude_0001", membreId: "membre_001", date: "2026-10-15", statut: "Pas payé", minutesIndividuelles: 720 },
    { id: "t3", etudeId: "etude_0002", membreId: "membre_002", date: "2026-11-02", statut: "A venir", minutesIndividuelles: 3840 },
    { id: "t4", etudeId: "etude_0002", membreId: "membre_002", date: "2026-11-03", statut: "Non effectué", minutesIndividuelles: 1920 },
  ],
};

test("sépare CA signé, facturé et encaissé", () => {
  const r = calculerTableauDeBord(base);
  assert.equal(r.caSigne, 7000);
  assert.equal(r.montantFacture, 4500);
  assert.equal(r.encaisse, 3500);
  assert.equal(r.resteAEncaisser, 1000);
});

test("ne compte que les JEH réellement travaillées", () => {
  const r = calculerTableauDeBord(base);
  assert.equal(r.totalJehTravaillees, 3.5);
  assert.deepEqual(r.jehParMois, [
    { mois: "2026-09", jeh: 2 },
    { mois: "2026-10", jeh: 1.5 },
    { mois: "2026-11", jeh: 0 },
  ]);
});

test("répartit les JEH par identifiant stable de membre", () => {
  const r = calculerTableauDeBord(base);
  assert.deepEqual(r.jehParMembre, [
    { membreId: "membre_001", jeh: 3.5 },
  ]);
});

test("n'affiche pas un total financier complet si une facture est incohérente", () => {
  const r = calculerTableauDeBord({
    ...base,
    factures: [...base.factures, { etudeId: "etude_0001", montant: 90 }],
  });
  assert.equal(r.montantFacture, null);
  assert.equal(r.encaisse, null);
  assert.equal(r.resteAEncaisser, null);
  assert.equal(r.valide, false);
});

test("signale une facture orpheline au lieu de l'ignorer", () => {
  const r = calculerTableauDeBord({
    ...base,
    factures: [...base.factures, { etudeId: "etude_absente", montant: 90, etat: "Payée" }],
  });
  assert.equal(r.encaisse, null);
  assert.ok(r.anomalies.some(a => a.raison === "Facture sans lien d'étude valide"));
});

test("ne masque pas un montant d'étude absent", () => {
  const r = calculerTableauDeBord({
    ...base,
    etudes: [...base.etudes, { id: "etude_0003" }],
  });
  assert.equal(r.caSigne, null);
  assert.equal(r.valide, false);
});

test("bloque les paramètres de période invalides", () => {
  assert.equal(calculerTableauDeBord({ ...base, dateFin: "2026-02-30" }).valide, false);
  assert.equal(calculerTableauDeBord({ ...base, nombreMois: 0 }).valide, false);
});

test("bloque les collections invalides", () => {
  const r = calculerTableauDeBord({ ...base, factures: null });
  assert.equal(r.valide, false);
});

test("détecte les identifiants d'étude dupliqués", () => {
  const r = calculerTableauDeBord({
    ...base,
    etudes: [...base.etudes, { id: "etude_0001", montant: 10 }],
  });
  assert.equal(r.caSigne, null);
  assert.ok(r.anomalies.some(a => a.raison === "Identifiant d'étude dupliqué"));
});

test("le tableau de bord consomme le modèle canonique des interventions individuelles", () => {
  const r = calculerTableauDeBord({
    ...base,
    interventions: [{ ...base.interventions[0], minutesIndividuelles: undefined, jeh: 2 }],
  });
  assert.equal(r.totalJehTravaillees, null);
  assert.equal(r.jehParMois, null);
  assert.equal(r.valide, false);
});
