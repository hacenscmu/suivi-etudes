const test = require("node:test");
const assert = require("node:assert/strict");
const { validerBV, analyserCollectionBVs, assietteJeh } = require("./bv");

const base = {
  membres: [{ id: "membre_001" }, { id: "membre_002" }],
  bvs: [{ id: "bv_000001" }],
  lignesBV: [
    { id: "ligne_0001", bvId: "bv_000001", membreId: "membre_001", jeh: 0.25 },
    { id: "ligne_0002", bvId: "bv_000001", membreId: "membre_002", jeh: 0.75 },
  ],
};

test("assiette minimale : max(JEH, 1) par personne, 0 si aucune JEH", () => {
  assert.equal(assietteJeh(0.25), 1);
  assert.equal(assietteJeh(1), 1);
  assert.equal(assietteJeh(2.5), 2.5);
  assert.equal(assietteJeh(0), 0);
});

test("un BV de moins d'une JEH est VALIDE (le minimum est une assiette, pas une interdiction)", () => {
  const r = validerBV({ lignes: [{ personneId: "p1", jeh: 0.5 }] });
  assert.equal(r.valide, true);
  assert.equal(r.totalJeh, 0.5);
  assert.deepEqual(r.assiettes, [{ personneId: "p1", jeh: 0.5, assietteJeh: 1 }]);
});

test("l'assiette est calculée pour chaque personne, pas sur le total du BV", () => {
  const r = validerBV({ lignes: [{ personneId: "p1", jeh: 0.25 }, { personneId: "p2", jeh: 0.75 }] });
  assert.equal(r.valide, true);
  assert.equal(r.totalJeh, 1);
  assert.deepEqual(r.assiettes.map(x => x.assietteJeh), [1, 1]); // et non 1 au total
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
  assert.equal(resultat.anomalies.length, 2); // identifiant manquant + JEH invalide (plus de refus « < 1 JEH »)
});

test("valide des BV normalisés avec une ligne par membre", () => {
  const r = analyserCollectionBVs(base);
  assert.equal(r.valide, true);
  assert.deepEqual(r.resume, [{
    bvId: "bv_000001",
    nombreLignes: 2,
    nombrePersonnes: 2,
    totalJeh: 1,
    assiettes: [
      { membreId: "membre_001", jeh: 0.25, assietteJeh: 1 },
      { membreId: "membre_002", jeh: 0.75, assietteJeh: 1 },
    ],
  }]);
});

test("BV normalisé de moins d'une JEH : valide, assiette de 1 JEH par membre", () => {
  const r = analyserCollectionBVs({ ...base, lignesBV: base.lignesBV.map(l => ({ ...l, jeh: 0.25 })) });
  assert.equal(r.valide, true);
  assert.deepEqual(r.resume[0].assiettes.map(x => x.assietteJeh), [1, 1]);
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
