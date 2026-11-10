const test = require("node:test");
const assert = require("node:assert/strict");
const { calculerAlertes, statutFinancier, ALERTES } = require("./alertes");

const E = (o = {}) => ({ id: "etude_0001", num: "1", statut: "En réalisation", montant: 1200, jeh: 400, date: "2026-09-01", ...o });
const run = (etude, factures = [], interventions = [], config = {}) => calculerAlertes({ etudes: [etude], factures, interventions, config, aujourdhui: "2026-11-10" }).get(etude.id);
const cles = r => r.alertes.map(a => a.cle);
const F = o => ({ etudeId: "etude_0001", montant: 600, date: "2026-09-02", ...o });
const I = o => ({ etudeId: "etude_0001", membreId: "m1", statut: "Pas payé", minutesIndividuelles: 480, prixJehHt: 300, ...o });

test("22 alertes portées depuis la v12", () => assert.equal(ALERTES.length, 22));

test("statut financier : toutes les factures comptent (correction v12)", () => {
  assert.equal(statutFinancier(E(), [F({ type: "Acompte", etat: "Émise" }), F({ type: "Solde", etat: "Payée", date: "2026-10-01" })]), "Solde facturé");
  assert.equal(statutFinancier(E(), [F({ type: "Acompte", etat: "Émise" }), F({ type: "Intermédiaire", etat: "Payée", date: "2026-10-01" })]), "Acompte facturé");
  assert.equal(statutFinancier(E({ statut: "Convention signée" }), []), "Acompte à facturer");
});

test("retard et relances selon les délais configurés", () => {
  assert.match(run(E(), [F({ type: "Acompte", etat: "Émise", echeance: "2026-11-05" })]).alertes[0].texte, /Retard de 5 j : 1re relance/);
  assert.match(run(E(), [F({ type: "Acompte", etat: "Émise", echeance: "2026-10-20" })]).alertes[0].texte, /2e relance/);
});

test("facturer l'acompte, temps manquant, échéance manquante", () => {
  assert.ok(cles(run(E({ statut: "Convention signée" }))).includes("acompte"));
  assert.ok(cles(run(E())).includes("temps"));
  assert.ok(cles(run(E(), [F({ type: "Acompte", etat: "Émise" })], [I()])).includes("echeance"));
});

test("payer les BV puis archiver", () => {
  const sol = [F({ type: "Solde", etat: "Payée", montant: 1200 })];
  assert.ok(cles(run(E(), sol, [I()])).includes("payer_bv"));
  assert.ok(cles(run(E(), sol, [I({ statut: "Payé" })])).includes("archiver"));
});

test("CNJE : fourchette client, plafond intervenant, facturées ≠ rémunérées (frais exclus)", () => {
  const cfg = { cnje: { date: "2026-01-01", min: 80, max: 450, maxInt: 300 } };
  assert.ok(cles(run(E({ jeh: 500 }), [], [I()], cfg)).includes("cnje_cli"));
  assert.ok(cles(run(E(), [], [I({ prixJehHt: 320 })], cfg)).includes("cnje_int"));
  // 1428 TTC, 70 € de frais : (1190 − 70) / 400 = 2,8 JEH facturées ; 2,8 JEH rémunérées → pas d'écart
  const r = run(E({ montant: 1428, frais: 70 }), [], [I({ minutesIndividuelles: 2.8 * 480 })], cfg);
  assert.ok(!cles(r).includes("cnje_diff"));
  assert.equal(Math.round(r.jehFacturees * 1000) / 1000, 2.8);
  // sans règle CNJE datée : aucune alerte CNJE
  assert.ok(!cles(run(E({ jeh: 500 }), [], [I()])).some(k => k.startsWith("cnje")));
});

test("désactivation d'une alerte ou de toutes", () => {
  assert.ok(!cles(run(E(), [], [], { alertesOff: { temps: true } })).includes("temps"));
  assert.equal(run(E(), [], [], { alertesOn: false }).alertes.length, 0);
});

test("numéro en double et date manquante", () => {
  const r = calculerAlertes({ etudes: [E(), E({ id: "etude_0002", date: "" })], aujourdhui: "2026-11-10" });
  assert.ok(cles(r.get("etude_0001")).includes("double"));
  assert.ok(cles(r.get("etude_0002")).includes("date"));
});
