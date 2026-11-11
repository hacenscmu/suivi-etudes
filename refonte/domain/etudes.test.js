const test = require("node:test");
const assert = require("node:assert/strict");
const { analyserEtude } = require("./etudes");

const etude = {
  id: "etude_0001",
  num: "HAC-2026-001",
  date: "2026-10-01",
  client: "Client A",
  statut: "Convention signée",
  montant: 3600,
  // Compatibilité v11 : le champ jeh est le prix unitaire HT, pas le nombre de JEH.
  jeh: 250,
};

test("convertit le montant TTC en CA HT et déduit le nombre de JEH du prix unitaire", () => {
  const r = analyserEtude(etude);
  assert.equal(r.caSigneHt, 3000);
  assert.equal(r.prixJehHt, 250);
  assert.equal(r.nombreJehFacturees, 12);
});

test("ne compte pas le CA d'une étude non signée", () => {
  const r = analyserEtude({ ...etude, statut: "Devis envoyé" });
  assert.equal(r.caSigneHt, 0);
});

test("compte le CA d'une étude archivée", () => {
  const r = analyserEtude({ ...etude, statut: "Archivée" });
  assert.equal(r.caSigneHt, 3000);
});

test("accepte un prix JEH client de 350 € HT (dans la fourchette CNJE 80–450 €)", () => {
  const r = analyserEtude({ ...etude, jeh: 350 });
  assert.equal(r.alertes.length, 0);
  assert.equal(r.nombreJehFacturees, 3000 / 350);
  assert.equal(r.valide, true);
});

test("signale un prix JEH client hors de la fourchette CNJE (alerte, pas anomalie)", () => {
  for (const jeh of [79, 451]) {
    const r = analyserEtude({ ...etude, jeh });
    assert.ok(r.alertes.some(a => a.includes("hors de la fourchette CNJE 80–450")));
    assert.equal(r.valide, true);
  }
});

test("les bornes 80 et 450 € HT sont acceptées", () => {
  for (const jeh of [80, 450]) assert.equal(analyserEtude({ ...etude, jeh }).alertes.length, 0);
});

test("ne confond pas la fourchette client avec le plafond intervenant de 300 €", () => {
  const r = analyserEtude({ ...etude, jeh: 400 });
  assert.equal(r.alertes.length, 0);
});

test("exige un prix JEH positif pour une étude signée", () => {
  for (const jeh of [null, 0, -10, ""]) {
    const r = analyserEtude({ ...etude, jeh });
    assert.equal(r.valide, false);
    assert.ok(r.anomalies.some(a => a.includes("Prix unitaire HT")));
  }
});

test("autorise une étude non signée sans prix JEH encore défini", () => {
  const r = analyserEtude({ ...etude, statut: "Devis envoyé", jeh: null });
  assert.equal(r.valide, true);
  assert.equal(r.nombreJehFacturees, null);
});

test("rattache les factures par identifiant stable et calcule leur situation", () => {
  const factures = [
    { id: "facture_001", etudeId: etude.id, montant: 1200, etat: "Payée" },
    { id: "facture_002", etudeId: etude.id, montant: 2400, etat: "Émise" },
    { id: "facture_003", etudeId: "etude_0002", montant: 999, etat: "Payée" },
  ];
  const r = analyserEtude(etude, { factures });
  assert.equal(r.situationFactures.montantTotal, 3600);
  assert.equal(r.situationFactures.montantEncaisse, 1200);
  assert.equal(r.situationFactures.situation, "partiellement_encaissee");
});

test("alerte si une étude archivée conserve une facture non encaissée", () => {
  const r = analyserEtude({ ...etude, statut: "Archivée" }, {
    factures: [{ id: "facture_001", etudeId: etude.id, montant: 3600, etat: "Émise" }],
  });
  assert.ok(r.alertes.some(a => a.includes("archivée")));
});

test("alerte si une étude refusée comporte des factures", () => {
  const r = analyserEtude({ ...etude, statut: "Refusé / sans suite" }, {
    factures: [{ id: "facture_001", etudeId: etude.id, montant: 100, etat: "Émise" }],
  });
  assert.ok(r.alertes.some(a => a.includes("refusée")));
});

test("signale les factures dont le total dépasse le montant de l'étude", () => {
  const r = analyserEtude(etude, {
    factures: [{ id: "facture_001", etudeId: etude.id, montant: 4000, etat: "Émise" }],
  });
  assert.ok(r.alertes.some(a => a.includes("dépasse")));
});

test("rejette un statut et une date invalides", () => {
  const r = analyserEtude({ ...etude, statut: "En cours", date: "2026-02-30" });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.length >= 2);
});


test("déduit les frais hors JEH avant de calculer le nombre de JEH facturées", () => {
  const r = analyserEtude({ ...etude, montant: 1428, frais: 70 });
  assert.equal(r.montantHt, 1190);
  assert.equal(r.nombreJehFacturees, 2.8);
});

test("ne calcule pas un nombre négatif de JEH si les frais dépassent le montant HT", () => {
  const r = analyserEtude({ ...etude, montant: 120, frais: 200 });
  assert.equal(r.nombreJehFacturees, 0);
});
