const test = require("node:test");
const assert = require("node:assert/strict");
const { validerBV, analyserCollectionBVs } = require("./bv");

const base = {
  membres: [{ id: "membre_001" }, { id: "membre_002" }],
  bvs: [{ id: "bv_000001" }],
  lignesBV: [
    { id: "ligne_0001", bvId: "bv_000001", membreId: "membre_001", jeh: 0.25 },
    { id: "ligne_0002", bvId: "bv_000001", membreId: "membre_002", jeh: 0.75 },
  ],
};

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

test("valide des BV normalisés avec une ligne par membre", () => {
  const r = analyserCollectionBVs(base);
  assert.equal(r.valide, true);
  assert.deepEqual(r.resume, [{
    bvId: "bv_000001",
    nombreLignes: 2,
    nombrePersonnes: 2,
    totalJeh: 1,
  }]);
});

test("contrôle le minimum global sur le BV, pas sur chaque ligne", () => {
  const r = analyserCollectionBVs({
    ...base,
    lignesBV: base.lignesBV.map(l => ({ ...l, jeh: 0.5 })),
  });
  assert.equal(r.valide, true);
});

test("bloque un BV dont le total des lignes est inférieur à une JEH", () => {
  const r = analyserCollectionBVs({
    ...base,
    lignesBV: base.lignesBV.map(l => ({ ...l, jeh: 0.25 })),
  });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.raison.includes("au moins 1 JEH")));
});

test("signale une personne dupliquée sur le même BV", () => {
  const r = analyserCollectionBVs({
    ...base,
    lignesBV: [...base.lignesBV, { id: "ligne_0003", bvId: "bv_000001", membreId: "membre_001", jeh: 0.5 }],
  });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.raison.includes("plusieurs fois")));
});

test("signale les lignes orphelines et les membres inconnus", () => {
  const r = analyserCollectionBVs({
    ...base,
    lignesBV: [{ id: "ligne_0003", bvId: "bv_absent", membreId: "membre_absent", jeh: 1 }],
  });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.raison === "BV parent introuvable"));
  assert.ok(r.anomalies.some(a => a.raison === "Membre lié introuvable"));
});

test("signale les BV sans ligne et les identifiants de ligne dupliqués", () => {
  const r = analyserCollectionBVs({
    ...base,
    bvs: [...base.bvs, { id: "bv_000002" }],
    lignesBV: [base.lignesBV[0], { ...base.lignesBV[1], id: base.lignesBV[0].id }],
  });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.raison === "Le BV ne contient aucune ligne"));
  assert.ok(r.anomalies.some(a => a.raison === "Identifiant de ligne dupliqué"));
});

test("bloque les collections BV invalides", () => {
  assert.equal(analyserCollectionBVs({ ...base, lignesBV: null }).valide, false);
});
