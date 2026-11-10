const test = require("node:test");
const assert = require("node:assert/strict");
const { validerBV } = require("./bv");

test("un BV avec plusieurs personnes atteint le minimum global d'une JEH", () => {
  const resultat = validerBV({
    lignes: [
      { personneId: "p1", jeh: 0.25 },
      { personneId: "p2", jeh: 0.75 },
    ],
  });
  assert.equal(resultat.valide, true);
  assert.equal(resultat.totalJeh, 1);
  assert.deepEqual(resultat.anomalies, []);
});

test("le minimum d'une JEH ne s'applique pas à chaque personne", () => {
  const resultat = validerBV({
    lignes: [
      { personneId: "p1", jeh: 0.25 },
      { personneId: "p2", jeh: 0.25 },
      { personneId: "p3", jeh: 0.5 },
    ],
  });
  assert.equal(resultat.valide, true);
});

test("un BV inférieur à une JEH est invalide même si chaque ligne est valide", () => {
  const resultat = validerBV({
    lignes: [
      { personneId: "p1", jeh: 0.25 },
      { personneId: "p2", jeh: 0.5 },
    ],
  });
  assert.equal(resultat.valide, false);
  assert.ok(resultat.anomalies.includes("Le total du BV doit atteindre au moins 1 JEH"));
});

test("une personne ne peut apparaître qu'une fois sur le même BV", () => {
  const resultat = validerBV({
    lignes: [
      { personneId: "p1", jeh: 0.5 },
      { personneId: "p1", jeh: 0.5 },
    ],
  });
  assert.equal(resultat.valide, false);
});

test("les identifiants et quantités manquants sont signalés", () => {
  const resultat = validerBV({ lignes: [{ jeh: -0.2 }] });
  assert.equal(resultat.valide, false);
  assert.equal(resultat.anomalies.length, 3);
});
