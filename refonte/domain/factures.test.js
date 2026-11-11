const test = require("node:test");
const assert = require("node:assert/strict");
const { analyserFacture, calculerSituationEtude } = require("./factures");

test("une étude n'est encaissée que si toutes ses factures sont payées", () => {
  const resultat = calculerSituationEtude([
    { etat: "Payée", montant: 100 },
    { etat: "Payée", montant: 200 },
  ]);

  assert.equal(resultat.situation, "integralement_encaissee");
  assert.equal(resultat.montantEncaisse, 300);
  assert.equal(resultat.resteAEncaisser, 0);
});

test("une facture de solde payée ne masque pas un acompte impayé", () => {
  const resultat = calculerSituationEtude([
    { type: "Acompte", etat: "Émise", montant: 100 },
    { type: "Solde", etat: "Payée", montant: 900 },
  ]);

  assert.equal(resultat.situation, "partiellement_encaissee");
  assert.equal(resultat.montantEncaisse, 900);
  assert.equal(resultat.resteAEncaisser, 100);
});

test("un état absent n'est pas automatiquement considéré comme payé", () => {
  const facture = analyserFacture({ montant: 50 });
  assert.equal(facture.payee, false);
  assert.equal(facture.etat, "inconnu");
  assert.ok(facture.anomalie);
});

test("la compatibilité historique est explicite et facultative", () => {
  const ancienne = { montant: 50 };
  assert.equal(analyserFacture(ancienne).payee, false);
  assert.equal(analyserFacture(ancienne, { legacy: true }).payee, true);
});

test("une étude sans facture n'est pas déclarée encaissée", () => {
  const resultat = calculerSituationEtude([]);
  assert.equal(resultat.situation, "sans_facture");
  assert.equal(resultat.nombrePayees, 0);
});

test("un état inconnu déclenche une anomalie et bloque le statut encaissé", () => {
  const resultat = calculerSituationEtude([
    { etat: "Payée", montant: 100 },
    { etat: "En attente", montant: 20 },
  ]);
  assert.equal(resultat.situation, "anomalie");
  assert.equal(resultat.montantEncaisse, 100);
  assert.equal(resultat.anomalies.length, 1);
});

test("un montant invalide ne produit pas de reste à encaisser fictif", () => {
  const resultat = calculerSituationEtude([
    { etat: "Émise", montant: "?" },
  ]);
  assert.equal(resultat.situation, "anomalie");
  assert.equal(resultat.resteAEncaisser, null);
});


test("calcule une facture par lignes HT, TVA unique et frais hors JEH", () => {
  const { calculerFactureParLignes } = require("./factures");
  const r = calculerFactureParLignes({ lignes: [
    { type: "prestation", quantite: 2.8, prixUnitaireHt: 400 },
    { type: "frais", montantHt: 70 },
  ], tauxTva: 0.2 });
  assert.equal(r.valide, true);
  assert.equal(r.prestationsHt, 1120);
  assert.equal(r.fraisHt, 70);
  assert.equal(r.montantHt, 1190);
  assert.equal(r.montantTva, 238);
  assert.equal(r.montantTtc, 1428);
});

test("déduit les factures antérieures en TTC sans convertir les anciens montants", () => {
  const { calculerFactureParLignes } = require("./factures");
  const r = calculerFactureParLignes({ lignes: [
    { type: "prestation", quantite: 2.8, prixUnitaireHt: 400 },
    { type: "frais", montantHt: 70 },
  ], tauxTva: 0.2, facturesPrecedentes: [{ montant: 600 }, { montant: 300 }] });
  assert.equal(r.montantTtcBrut, 1428);
  assert.equal(r.deductionTtc, 900);
  assert.equal(r.montant, 528);
});

test("refuse un dépassement par les factures précédentes", () => {
  const { calculerFactureParLignes } = require("./factures");
  const r = calculerFactureParLignes({ lignes: [{ type: "prestation", quantite: 1, prixUnitaireHt: 100 }], tauxTva: 0.2, facturesPrecedentes: [{ montant: 200 }] });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.includes("dépassent")));
});

test("refuse les taux TVA et lignes invalides", () => {
  const { calculerFactureParLignes } = require("./factures");
  const r = calculerFactureParLignes({ lignes: [{ type: "prestation", quantite: 0, prixUnitaireHt: -1 }], tauxTva: 1.2 });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.length >= 3);
});

 
test("refuse un prix ou un montant de frais laissé vide", () => {
  const { calculerFactureParLignes } = require("./factures");
  for (const lignes of [
    [{ type: "prestation", quantite: 1, prixUnitaireHt: null }],
    [{ type: "frais", montantHt: null }],
  ]) assert.equal(calculerFactureParLignes({ lignes }).valide, false);
});


test("refuse une facture antérieure sans montant TTC", () => {
  const { calculerFactureParLignes } = require("./factures");
  const r = calculerFactureParLignes({ lignes: [{ type: "prestation", quantite: 1, prixUnitaireHt: 100 }], facturesPrecedentes: [{ montant: null }] });
  assert.equal(r.valide, false);
  assert.ok(r.anomalies.some(a => a.includes("facture précédente")));
});
