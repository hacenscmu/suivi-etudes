const test = require("node:test");
const assert = require("node:assert/strict");
const { migrerV11 } = require("./migrer-v11");
const { versLignesSheet, versCsv } = require("./vers-sheet");
const { creerServeurAppsScriptSimule } = require("../backend/apps-script/simulateur");
const { creerClientApiV3 } = require("../backend/client-api-v3");
const { construireVueApplication } = require("../application/lecture");

const exp = {
  etudes: { e_0000001: { client: "Soléa", num: "1", statut: "En réalisation", montant: 1428, jeh: 400, date: "2026-09-01" } },
  factures: { f_0000001: { etude: "1", type: "Acompte", etat: "Payée", montant: 500, date: "2026-09-02" } },
  temps: { t_0000001: { prenom: "Alex", etude: "1", min: 120, nb: 2, jeh: 300, statut: "Pas payé", date: "2026-09-05" } },
  formation: {}, config: { tva: 0.2 },
};

test("refuse un aperçu bloqué", () => {
  assert.throws(() => versLignesSheet({ statut: "bloquee" }), /non prêt/);
});

const CORR = { jehTemps: "prix_intervenant_ht" };
test("un aperçu à vérifier exige la confirmation explicite", () => {
  const a = migrerV11(exp, { correspondances: CORR });
  if (a.statut === "apercu_a_verifier") assert.throws(() => versLignesSheet(a), /à vérifier/);
});

test("une ligne par fiche, version 1, config/main, ancien temps recopié", () => {
  const L = versLignesSheet(migrerV11(exp, { correspondances: CORR }), { exportV11: exp, maintenant: "2026-11-10T00:00:00Z", verifie: true });
  assert.deepEqual(L[0], ["collection", "id", "json"]);
  const cols = L.slice(1).map(r => r[0]);
  for (const c of ["clients", "membres", "etudes", "factures", "interventions", "config", "temps"]) assert.ok(cols.includes(c), c);
  assert.ok(L.slice(1).every(r => r[0] === "temps" || JSON.parse(r[2])._v === 1));
  assert.equal(L.find(r => r[0] === "config")[1], "main");
});

test("CSV : guillemets échappés", () => {
  assert.equal(versCsv([["a", 'b"c']]), '"a","b""c"\n');
});

test("bout en bout : les lignes chargées dans le vrai Code.gs sont lues par le client et valides pour l'application", async () => {
  const L = versLignesSheet(migrerV11(exp, { correspondances: CORR }), { exportV11: exp, verifie: true });
  const TOKEN = "jeton-migration-0123456789";
  const serveur = creerServeurAppsScriptSimule({ token: TOKEN });
  L.slice(1).forEach(r => serveur.feuilles["Données"].rows.push(r));
  const client = creerClientApiV3({ transport: serveur.transport, obtenirToken: () => TOKEN });
  const r = await client.loadAll();
  assert.equal(r.collections.etudes.length, 1);
  assert.equal(r.collections.interventions[0].minutesIndividuelles, 60);
  assert.equal(Object.keys(r.legacyTemps).length, 1);
  assert.deepEqual(r.meta.anomalies, []);
  const vue = construireVueApplication({ ...r.collections }, { dateFin: "2026-11-30" });
  assert.equal(vue.valide, true, JSON.stringify(vue.anomalies));
});
