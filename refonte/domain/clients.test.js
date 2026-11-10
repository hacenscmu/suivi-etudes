const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resoudreRelation,
  calculerProchaineEcheance,
  analyserAlerteClient,
} = require("./clients");

test("une relation ponctuelle reste ponctuelle même si le client a plusieurs études", () => {
  assert.deepEqual(resoudreRelation({ relationType: "ponctuelle" }), {
    type: "ponctuelle",
    cadence: null,
    anomalie: null,
  });
});

test("une relation récurrente exige une cadence explicite", () => {
  const resultat = resoudreRelation({ relationType: "recurrente" });
  assert.equal(resultat.type, "recurrente");
  assert.ok(resultat.anomalie);
});

test("une étude peut surcharger le type et la cadence du client", () => {
  const resultat = resoudreRelation(
    { relationType: "ponctuelle" },
    { relationType: "recurrente", cadence: "trimestrielle" },
  );
  assert.deepEqual(resultat, { type: "recurrente", cadence: "trimestrielle", anomalie: null });
});

test("une relation récurrente sans date de référence ne déclenche aucune alerte", () => {
  const resultat = analyserAlerteClient({ relationType: "recurrente", cadence: "mensuelle" });
  assert.equal(resultat.alerteActivable, false);
  assert.equal(resultat.prochaineEcheance, null);
});

test("une échéance mensuelle conserve le dernier jour possible du mois", () => {
  assert.equal(
    calculerProchaineEcheance({ dateReference: "2026-01-31", cadence: "mensuelle" }),
    "2026-02-28",
  );
});

test("une échéance annuelle gère les années bissextiles", () => {
  assert.equal(
    calculerProchaineEcheance({ dateReference: "2024-02-29", cadence: "annuelle" }),
    "2025-02-28",
  );
});

test("une date invalide ne génère pas de prochaine échéance", () => {
  assert.equal(
    calculerProchaineEcheance({ dateReference: "2026-02-30", cadence: "mensuelle" }),
    null,
  );
});
