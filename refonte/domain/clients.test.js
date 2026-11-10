const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resoudreRelation,
  calculerProchaineEcheance,
  analyserAlerteClient,
} = require("./clients");

test("une relation ponctuelle reste ponctuelle", () => {
  assert.deepEqual(resoudreRelation({ relationType: "ponctuelle" }), {
    type: "ponctuelle",
    cadenceFacturation: null,
    anomalie: null,
  });
});

test("une relation longue durée peut exister sans cadence de facturation", () => {
  assert.deepEqual(resoudreRelation({ relationType: "longue_duree" }), {
    type: "longue_duree",
    cadenceFacturation: null,
    anomalie: null,
  });
});

test("une relation longue durée n'implique pas automatiquement une alerte périodique", () => {
  const resultat = analyserAlerteClient({ relationType: "longue_duree" });
  assert.equal(resultat.alerteActivable, false);
  assert.equal(resultat.prochaineEcheance, null);
  assert.equal(resultat.anomalie, null);
});

test("une relation ponctuelle ne devient pas périodique même si une cadence est saisie", () => {
  const resultat = analyserAlerteClient({
    relationType: "ponctuelle",
    cadenceFacturation: "mensuelle",
    dateProchaineFacture: "2026-11-01",
  });
  assert.equal(resultat.alerteActivable, false);
});

test("une cadence explicite active les alertes pour une relation longue durée", () => {
  const resultat = analyserAlerteClient({
    relationType: "longue_duree",
    cadenceFacturation: "mensuelle",
    dateProchaineFacture: "2026-11-30",
  });
  assert.deepEqual(resultat, {
    alerteActivable: true,
    prochaineEcheance: "2026-12-30",
    anomalie: null,
  });
});

test("une étude peut surcharger la relation et la cadence du client", () => {
  const resultat = resoudreRelation(
    { relationType: "longue_duree", cadenceFacturation: "mensuelle" },
    { relationType: "ponctuelle", cadenceFacturation: null },
  );
  assert.deepEqual(resultat, {
    type: "ponctuelle",
    cadenceFacturation: null,
    anomalie: null,
  });
});

test("une relation longue durée avec cadence mais sans date ne déclenche pas d'alerte", () => {
  const resultat = analyserAlerteClient({
    relationType: "longue_duree",
    cadenceFacturation: "mensuelle",
  });
  assert.equal(resultat.alerteActivable, false);
  assert.ok(resultat.anomalie);
});

test("une cadence inconnue est signalée", () => {
  const resultat = resoudreRelation({
    relationType: "longue_duree",
    cadenceFacturation: "hebdomadaire",
  });
  assert.ok(resultat.anomalie);
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
