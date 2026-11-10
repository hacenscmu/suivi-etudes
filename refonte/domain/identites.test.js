const test = require("node:test");
const assert = require("node:assert/strict");
const {
  estIdValide,
  validerIdentite,
  verifierUniciteIdentifiants,
  resoudreReferenceHistorique,
  validerLiensMetier,
} = require("./identites");

test("un identifiant stable doit être une chaîne suffisamment longue", () => {
  assert.equal(estIdValide("client_0001"), true);
  assert.equal(estIdValide("Pauline"), false);
  assert.equal(estIdValide(""), false);
  assert.equal(estIdValide(null), false);
});

test("une identité valide porte un identifiant stable", () => {
  assert.deepEqual(validerIdentite({ id: "etude_000001" }, "etudes"), {
    valide: true,
    anomalie: null,
  });
  assert.equal(validerIdentite({ id: "12" }, "etudes").valide, false);
});

test("les identifiants en double sont détectés sans fusionner les objets", () => {
  const resultat = verifierUniciteIdentifiants([
    { id: "membre_0001", prenom: "Alex" },
    { id: "membre_0002", prenom: "Alex" },
    { id: "membre_0001", prenom: "Sam" },
  ], "membres");

  assert.equal(resultat.valide, false);
  assert.deepEqual(resultat.doublons, [{ index: 2, id: "membre_0001" }]);
});

test("une ancienne référence textuelle est résolue si elle est unique", () => {
  const membre = { id: "membre_0001", prenom: "Alex" };
  const resultat = resoudreReferenceHistorique("Alex", [membre], "prenom");
  assert.equal(resultat.statut, "resolue");
  assert.equal(resultat.objet, membre);
});

test("une ancienne référence textuelle ambiguë est bloquée", () => {
  const resultat = resoudreReferenceHistorique("Alex", [
    { id: "membre_0001", prenom: "Alex" },
    { id: "membre_0002", prenom: "Alex" },
  ], "prenom");
  assert.equal(resultat.statut, "ambiguë");
  assert.equal(resultat.objet, null);
  assert.equal(resultat.candidats.length, 2);
});

test("une ancienne référence introuvable n'est pas inventée", () => {
  const resultat = resoudreReferenceHistorique("Étude 42", [], "num");
  assert.equal(resultat.statut, "introuvable");
  assert.equal(resultat.objet, null);
});

test("les factures et lignes de BV doivent référencer des parents existants", () => {
  const resultat = validerLiensMetier({
    etudes: [{ id: "etude_000001" }],
    factures: [
      { id: "facture_0001", etudeId: "etude_000001" },
      { id: "facture_0002", etudeId: "etude_absente" },
    ],
    bvs: [{ id: "bv_00000001" }],
    lignesBV: [
      { id: "ligne_00001", bvId: "bv_00000001", membreId: "membre_0001" },
      { id: "ligne_00002", bvId: "bv_absent", membreId: "membre_0002" },
    ],
  });

  assert.equal(resultat.valide, false);
  assert.equal(resultat.anomalies.length, 2);
});
