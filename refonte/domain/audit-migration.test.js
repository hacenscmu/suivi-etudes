const test = require("node:test");
const assert = require("node:assert/strict");
const { regrouperParValeur, auditerDonneesHistoriques } = require("./audit-migration");

test("les doublons de numéros d'étude sont recensés avec leurs indices", () => {
  assert.deepEqual(regrouperParValeur([
    { num: "E-1" }, { num: "E-2" }, { num: "E-1" },
  ], "num"), [{ valeur: "E-1", nombre: 2, indices: [0, 2] }]);
});

test("un numéro d'étude dupliqué bloque la migration automatique", () => {
  const resultat = auditerDonneesHistoriques({
    etudes: [{ num: "E-1", client: "Client A" }, { num: "E-1", client: "Client B" }],
    factures: [{ etude: "E-1" }],
    temps: [],
  });
  assert.equal(resultat.migrationAutomatiqueAutorisee, false);
  assert.ok(resultat.anomalies.some(a => a.type === "facture_etude_ambigue"));
});

test("les références facture et temps introuvables sont bloquantes", () => {
  const resultat = auditerDonneesHistoriques({
    etudes: [{ num: "E-1", client: "Client A" }],
    factures: [{ etude: "E-404" }],
    temps: [{ etude: "E-404", prenom: "Alex" }],
  });
  assert.equal(resultat.resume.anomaliesBloquantes, 2);
});

test("les prénoms et noms clients réutilisés sont signalés sans fusion", () => {
  const resultat = auditerDonneesHistoriques({
    etudes: [
      { num: "E-1", client: "Client A" },
      { num: "E-2", client: "Client A" },
    ],
    factures: [],
    temps: [
      { etude: "E-1", prenom: "Alex" },
      { etude: "E-2", prenom: "Alex" },
    ],
  });
  assert.equal(resultat.resume.nomsClientsReutilises, 1);
  assert.equal(resultat.resume.prenomsReutilises, 1);
  assert.equal(resultat.migrationAutomatiqueAutorisee, true);
  assert.ok(resultat.anomalies.every(a => a.gravite === "a_verifier"));
});

test("une ligne de temps sans personne identifiable est bloquante", () => {
  const resultat = auditerDonneesHistoriques({
    etudes: [{ num: "E-1" }],
    factures: [],
    temps: [{ etude: "E-1", prenom: "" }],
  });
  assert.equal(resultat.migrationAutomatiqueAutorisee, false);
  assert.ok(resultat.anomalies.some(a => a.type === "temps_sans_personne_identifiable"));
});
