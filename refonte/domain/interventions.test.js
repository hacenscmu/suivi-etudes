const test = require("node:test");
const assert = require("node:assert/strict");
const { analyserIntervention, agregerInterventions } = require("./interventions");

const ligne = {
  id: "interv_001",
  etudeId: "etude_001",
  membreId: "membre_001",
  date: "2026-11-02",
  minutesIndividuelles: 240,
  statut: "Pas payé",
  prixJehHt: 250,
};

test("convertit les minutes individuelles en JEH sur une base de 8 heures", () => {
  const r = analyserIntervention(ligne);
  assert.equal(r.jeh, 0.5);
  assert.equal(r.jehTravaillees, 0.5);
  assert.equal(r.montantClientHt, 125);
});

test("compte le travail réalisé même si la rémunération n'est pas payée", () => {
  assert.equal(analyserIntervention({ ...ligne, statut: "Pas payé" }).jehTravaillees, 0.5);
});

test("exclut les interventions à venir", () => {
  assert.equal(analyserIntervention({ ...ligne, statut: "A venir" }).jehTravaillees, 0);
});

test("exclut les interventions non effectuées", () => {
  assert.equal(analyserIntervention({ ...ligne, statut: "Non effectué" }).jehTravaillees, 0);
});

test("ne compte pas une ligne avec statut inconnu", () => {
  const r = analyserIntervention({ ...ligne, statut: "En attente" });
  assert.equal(r.valide, false);
  assert.equal(r.jehTravaillees, 0);
});

test("rejette les durées nulles, négatives et manquantes", () => {
  for (const minutesIndividuelles of [0, -10, null, ""]) {
    assert.equal(analyserIntervention({ ...ligne, minutesIndividuelles }).valide, false);
  }
});

test("ne transforme pas un prix absent en zéro", () => {
  const r = analyserIntervention({ ...ligne, prixJehHt: null });
  assert.equal(r.montantClientHt, null);
  assert.equal(r.valide, true);
});

test("agrège les JEH travaillées par membre et étude", () => {
  const r = agregerInterventions([
    ligne,
    { ...ligne, id: "interv_002", membreId: "membre_002", minutesIndividuelles: 480, statut: "Payé" },
    { ...ligne, id: "interv_003", etudeId: "etude_002", minutesIndividuelles: 960, statut: "A venir" },
  ]);
  assert.equal(r.totalJehTravaillees, 1.5);
  assert.deepEqual(r.parMembre, [
    { membreId: "membre_001", jeh: 0.5 },
    { membreId: "membre_002", jeh: 1 },
  ]);
  assert.deepEqual(r.parEtude, [{ etudeId: "etude_001", jeh: 1.5 }]);
});

test("bloque l'agrégation si une intervention est invalide", () => {
  const r = agregerInterventions([ligne, { ...ligne, id: "interv_002", date: "2026-02-30" }]);
  assert.equal(r.valide, false);
  assert.equal(r.totalJehTravaillees, null);
});

test("bloque une collection qui n'est pas un tableau", () => {
  assert.equal(agregerInterventions(null).valide, false);
});

test("alerte au-dessus de 300 € HT/JEH pour l'intervenant sans bloquer l'intervention", () => {
  const r = analyserIntervention({ ...ligne, prixJehHt: 301 });
  assert.equal(r.valide, true);
  assert.ok(r.alertes.some(a => a.includes("plafond HAC de 300")));
});

test("le prix intervenant à 300 € HT est accepté sans alerte et le plafond est configurable", () => {
  assert.equal(analyserIntervention({ ...ligne, prixJehHt: 300 }).alertes.length, 0);
  assert.equal(analyserIntervention({ ...ligne, prixJehHt: 350 }, { plafondJehHt: 400 }).alertes.length, 0);
});

test("propage les alertes de prix intervenant dans l'agrégation", () => {
  const r = agregerInterventions([{ ...ligne, prixJehHt: 350 }]);
  assert.equal(r.valide, true);
  assert.equal(r.alertes.length, 1);
  assert.equal(r.alertes[0].index, 0);
});
