const test = require("node:test");
const assert = require("node:assert/strict");
const { calculerPaie } = require("./paie");
const cfg = { smic: 10, cot: { a: 0.1 }, patr: { b: 0.5 }, chomage: 0 }; // base JEH = 40 €
const M = [{ id: "m1", nomComplet: "Alex" }];
const I = o => ({ membreId: "m1", statut: "Pas payé", minutesIndividuelles: 480, prixJehHt: 300, ...o });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " ≠ " + b);

test("1 JEH à 300 € : brut 300, net 300 − 1×40×10 %, coût 300 + 1×40×50 %", () => {
  const r = calculerPaie({ interventions: [I()], membres: M, config: cfg }).lignes[0];
  close(r.brut, 300); close(r.net, 296); close(r.cout, 320);
});

test("0,5 JEH : payé sur 0,5 JEH, cotisé sur 1 JEH (assiette minimale par BV)", () => {
  const r = calculerPaie({ interventions: [I({ minutesIndividuelles: 240 })], membres: M, config: cfg }).lignes[0];
  close(r.brut, 150); assert.equal(r.assiette, 1); close(r.net, 146); close(r.cout, 170);
});

test("les lignes déjà payées ne recomptent pas de minimum ; à venir et non effectué exclus", () => {
  const r = calculerPaie({ interventions: [I({ statut: "Payé", minutesIndividuelles: 240 }), I({ statut: "A venir" }), I({ statut: "Non effectué" })], membres: M, config: cfg }).lignes[0];
  assert.equal(r.jehAPayer, 0); assert.equal(r.net, 0); close(r.dejaPaye, 150);
});

test("total et signalement d'un prix manquant", () => {
  const p = calculerPaie({ interventions: [I(), I({ prixJehHt: null })], membres: M, config: cfg });
  close(p.total.brut, 300); assert.equal(p.lignes[0].sansPrix, true);
});
