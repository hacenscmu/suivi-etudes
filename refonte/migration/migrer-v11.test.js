const test = require("node:test");
const assert = require("node:assert/strict");
const { migrerV11, rapportTexte } = require("./migrer-v11");
const { construireVueApplication } = require("../application/lecture");

// Export fictif au format v11 (clés générées par l'app : e…, f…, t…).
const exportV11 = () => ({
  etudes: {
    e1: { client: "B+T Environnement", num: "1", statut: "En réalisation", montant: 1428, jeh: 400, frais: 70, date: "2026-09-01" },
    e2: { client: "b+t  environnement", num: "2", statut: "Archivée", montant: 2400, jeh: 400, date: "2026-06-01" },
    e3: { client: "Soléa", num: "3", statut: "Devis envoyé", montant: 1200, jeh: 500, date: "2026-10-01" },
  },
  factures: {
    f1: { etude: "1", type: "Acompte", etat: "Payée", montant: 500, date: "2026-09-02", datePaiement: "2026-09-20" },
    f2: { etude: "2", montant: 2400, date: "2026-07-01", note: "solde" },
  },
  temps: {
    t1: { prenom: "Alex", etude: "1", min: 120, nb: 2, jeh: 300, statut: "Pas payé", date: "2026-09-05" },
    t2: { prenom: "Zoé", etude: "1", min: 120, nb: 2, jeh: 300, statut: "Payé", date: "2026-09-05" },
    t3: { prenom: "Alex", etude: "2", min: 960, nb: 1, jeh: 320, statut: "Payé", date: "2026-06-10" },
    t4: { prenom: "Zoé", etude: "1", min: 60, nb: 1, jeh: 300, date: "2026-09-06" },
    t5: { prenom: "Alex", etude: "1", min: 240, nb: 1, jeh: 300, statut: "A venir", date: "2026-11-20" },
  },
  formation: { f_alex: { nom: "Alex", niveaux: { "1": 3, "2": 4 } } },
  config: { tva: 0.2, smic: 12.02, cnje: { min: 80, max: 450, maxInt: 300 } },
});

test("n'écrit rien et ne modifie pas l'export source", () => {
  const src = exportV11(), copie = JSON.stringify(src);
  migrerV11(src);
  assert.equal(JSON.stringify(src), copie);
});

test("minutes individuelles = min ÷ nb et le champ jeh v11 reste non qualifié par défaut", () => {
  const r = migrerV11(exportV11());
  const t1 = r.collections.interventions.find(i => i.sourceLegacyId === "t1");
  assert.equal(t1.minutesIndividuelles, 60);
  assert.equal(t1.prixJehHt, null);
  assert.equal(t1.jehV11, 300);
  assert.ok(r.anomalies.some(a => a.type === "jeh_historique_non_qualifie"));
});

test("le prix JEH client et les frais de l'étude sont conservés", () => {
  const e1 = migrerV11(exportV11()).collections.etudes.find(e => e.sourceLegacyId === "e1");
  assert.equal(e1.jeh, 400);
  assert.equal(e1.frais, 70);
});

test("clients regroupés par nom normalisé, et la fusion est soumise à Pauline", () => {
  const r = migrerV11(exportV11());
  assert.equal(r.collections.clients.length, 2);
  const [e1, e2] = ["e1", "e2"].map(s => r.collections.etudes.find(e => e.sourceLegacyId === s));
  assert.equal(e1.clientId, e2.clientId);
  assert.ok(r.questions.some(q => q.type === "clients_fusionnes" && q.valeurs.length === 2));
});

test("une correspondance fournie sépare deux clients", () => {
  const r = migrerV11(exportV11(), { correspondances: { clients: { "b+t  environnement": "cli_bt_sudouest" } } });
  assert.equal(r.collections.clients.length, 3);
});

test("membres créés par prénom, chacun soumis à confirmation ; formation rattachée", () => {
  const r = migrerV11(exportV11());
  assert.equal(r.collections.membres.length, 2);
  assert.equal(r.questions.filter(q => q.type === "membre_a_confirmer").length, 2);
  const alex = r.collections.membres.find(m => m.nomComplet === "Alex");
  assert.equal(r.collections.formation[0].membreId, alex.id);
  assert.equal(Object.keys(r.collections.formation[0].niveaux).length, 2);
});

test("état et type de facture absents : complétés comme en v11 mais signalés", () => {
  const r = migrerV11(exportV11());
  const f2 = r.collections.factures.find(f => f.sourceLegacyId === "f2");
  assert.equal(f2.etat, "Payée"); assert.equal(f2.etatSuppose, true);
  assert.equal(f2.type, "Solde"); assert.equal(f2.typeSuppose, true);
  assert.ok(r.anomalies.some(a => a.type === "facture_etat_suppose_payee"));
});

test("ligne JEH sans statut : non comptée, signalée, écart expliqué dans les totaux", () => {
  const r = migrerV11(exportV11());
  assert.equal(r.collections.interventions.find(i => i.sourceLegacyId === "t4").statut, null);
  assert.ok(r.anomalies.some(a => a.type === "intervention_sans_statut"));
  assert.equal(r.totaux.jehTravailleesAvant, 0.125 + 0.125 + 2 + 0.125); // t1 + t2 + t3 + t4 (sans statut, compté par v11)
  assert.equal(r.totaux.jehTravailleesApres, 0.125 + 0.125 + 2);
  assert.equal(r.totaux.ecartJeh, 0.125);
});

test("aucun BV inventé ; anciennes lignes payées marquées « non ventilé »", () => {
  const r = migrerV11(exportV11());
  assert.equal(r.collections.bvs.length, 0);
  assert.equal(r.collections.interventions.filter(i => i.bvHistorique === "non_ventile").length, 2);
  assert.ok(r.questions.some(q => q.type === "bv_historiques"));
});

test("identifiants déterministes : deux aperçus identiques", () => {
  assert.equal(JSON.stringify(migrerV11(exportV11()).collections), JSON.stringify(migrerV11(exportV11()).collections));
});

test("numéro d'étude en double : aperçu bloqué", () => {
  const src = exportV11(); src.etudes.e3.num = "1";
  const r = migrerV11(src);
  assert.equal(r.statut, "bloquee");
  assert.ok(r.anomalies.some(a => a.gravite === "bloquante"));
});

test("bout en bout : l'aperçu est lisible par la couche application v3", () => {
  const r = migrerV11(exportV11());
  const src = r.collections;
  const etat = { clients: src.clients, membres: src.membres, etudes: src.etudes, factures: src.factures,
    interventions: src.interventions.filter(i => i.statut), bvs: [], lignesBV: [] }; // lignes sans statut : à classer avant
  const vue = construireVueApplication(etat, { dateFin: "2026-11-30" });
  assert.equal(vue.valide, true, JSON.stringify(vue.anomalies));
});

test("le rapport texte liste résumé, totaux et questions", () => {
  const t = rapportTexte(migrerV11(exportV11()));
  assert.match(t, /Questions pour Pauline/);
  assert.match(t, /jehTravailleesAvant/);
});

test("ne mappe le champ jeh v11 en prix intervenant qu'avec une correspondance explicite", () => {
  const r = migrerV11(exportV11(), { correspondances: { jehTemps: "prix_intervenant_ht" } });
  const t1 = r.collections.interventions.find(i => i.sourceLegacyId === "t1");
  assert.equal(t1.prixJehHt, 300);
  assert.equal(t1.jehV11, 300);
  assert.equal(r.anomalies.some(a => a.type === "jeh_historique_non_qualifie"), false);
});

test("si jeh v11 est déclaré comme nombre de JEH, compare avec les minutes calculées", () => {
  const r = migrerV11(exportV11(), { correspondances: { jehTemps: "nombre_jeh" } });
  const t1 = r.collections.interventions.find(i => i.sourceLegacyId === "t1");
  assert.equal(t1.jehDeclaree, 300);
  assert.equal(t1.prixJehHt, null);
  assert.ok(r.anomalies.some(a => a.type === "jeh_historique_ecart_minutes"));
});

test("un aperçu avec des questions ou anomalies non bloquantes reste à vérifier", () => {
  assert.equal(migrerV11(exportV11()).statut, "apercu_a_verifier");
});

test("une étude sans client est bloquante pour la migration", () => {
  const src = exportV11();
  src.etudes.e1.client = "";
  const r = migrerV11(src);
  assert.equal(r.statut, "bloquee");
  assert.ok(r.anomalies.some(a => a.type === "etude_sans_client" && a.gravite === "bloquante"));
});

test("une formation peut être rattachée à un membre séparé par correspondance", () => {
  const r = migrerV11(exportV11(), {
    correspondances: {
      tempsVersMembre: { t1: "mbr_alex_0001", t3: "mbr_alex_0002" },
      membres: { "Zoé": "mbr_zoe_000001" },
      nomsMembres: { mbr_alex_0001: "Alex Martin", mbr_alex_0002: "Alex Dupont", mbr_zoe_000001: "Zoé Durand" },
      formationVersMembre: { f_alex: "mbr_alex_0001" },
    },
  });
  assert.equal(r.collections.formation[0].membreId, "mbr_alex_0001");
  assert.equal(r.questions.some(q => q.type === "membre_a_confirmer"), false);
});

test("refuse une correspondance avec un identifiant instable", () => {
  assert.throws(() => migrerV11(exportV11(), { correspondances: { membres: { Alex: "a1" } } }), /Identifiant de correspondance invalide/);
});

test("le plafond de 300 € ne s'applique au champ historique que si son sens prix est confirmé", () => {
  const r = migrerV11(exportV11(), { correspondances: { jehTemps: "prix_intervenant_ht" } });
  assert.ok(r.anomalies.some(a => a.type === "prix_jeh_intervenant_sup_300" && a.valeur === 320));
});

test("une correspondance client explicite supprime la question de fusion correspondante", () => {
  const r = migrerV11(exportV11(), { correspondances: {
    clients: { "B+T Environnement": "cli_bt_sudouest", "b+t  environnement": "cli_bt_sudouest" },
  } });
  assert.equal(r.questions.some(q => q.type === "clients_fusionnes"), false);
});
