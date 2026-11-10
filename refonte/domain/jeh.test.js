const test = require("node:test");
const assert = require("node:assert/strict");
const { calculerJehTravaillees } = require("./jeh");

test("compte les JEH des interventions réalisées, payées ou non", () => {
  const resultat = calculerJehTravaillees([
    { statut: "Payé", jeh: 1.5 },
    { statut: "Pas payé", jeh: 0.5 },
    { statut: "A venir", jeh: 4 },
    { statut: "Non effectué", jeh: 2 },
  ]);

  assert.equal(resultat.total, 2);
  assert.deepEqual(resultat.anomalies, []);
});

test("signale les statuts absents ou inconnus au lieu de les compter", () => {
  const resultat = calculerJehTravaillees([
    { jeh: 1 },
    { statut: "En attente", jeh: 2 },
  ]);

  assert.equal(resultat.total, 0);
  assert.equal(resultat.anomalies.length, 2);
});

test("signale une quantité de JEH invalide", () => {
  const resultat = calculerJehTravaillees([
    { statut: "Payé", jeh: null },
    { statut: "Pas payé", jeh: -1 },
    { statut: "Payé", jeh: "abc" },
  ]);

  assert.equal(resultat.total, 0);
  assert.equal(resultat.anomalies.length, 3);
});

test("accepte une intervention réalisée de zéro JEH sans créer d'anomalie", () => {
  const resultat = calculerJehTravaillees([
    { statut: "Payé", jeh: 0 },
  ]);

  assert.equal(resultat.total, 0);
  assert.deepEqual(resultat.anomalies, []);
});
