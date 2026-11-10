const test = require("node:test");
const assert = require("node:assert/strict");
const { adaptateurHistorique } = require("./adaptateur-historique");

const ids = (() => { let n = 0; return prefix => prefix + "_" + String(++n).padStart(8, "0"); })();

test("refuse de fonctionner sans générateur d'identifiants explicite", () => {
  assert.throws(() => adaptateurHistorique(), /createId/);
});

test("bloque les numéros d'étude dupliqués sans produire de données cibles", () => {
  const r = adaptateurHistorique({
    etudes: { etude0001: { num: "A-1", client: "Client" }, etude0002: { num: "A-1", client: "Client" } },
    createId: ids,
  });
  assert.equal(r.statut, "bloquee");
  assert.deepEqual(r.donnees.etudes, []);
});

test("relie factures et temps à une étude uniquement si le numéro est unique", () => {
  const r = adaptateurHistorique({
    etudes: { etude0001: { num: "A-1", client: "Client" } },
    factures: { facture01: { etude: "A-1", type: "Acompte" } },
    temps: { temps0001: { etude: "A-1", prenom: "Alex", statut: "Payé" } },
    clientIdParEtudeSource: { etude0001: "client_00000001" },
    membreIdParTempsSource: { temps0001: "membre_000001" },
    createId: ids,
  });
  assert.equal(r.statut, "pret_a_reviser");
  assert.equal(r.donnees.factures[0].etudeId, r.donnees.etudes[0].id);
  assert.equal(r.donnees.temps[0].etudeId, r.donnees.etudes[0].id);
  assert.equal(r.donnees.temps[0].membreId, "membre_000001");
});

test("ne regroupe jamais les anciennes lignes de temps en BV sans preuve", () => {
  const r = adaptateurHistorique({
    etudes: { etude0001: { num: "A-1", client: "Client" } },
    temps: { temps0001: { etude: "A-1", prenom: "Alex", statut: "Payé" } },
    createId: ids,
  });
  assert.equal(r.donnees.temps[0].bvId, null);
  assert.equal(r.donnees.temps[0].statutMigrationBV, "a_regrouper_manuellement");
});

test("signale les correspondances client et membre non fournies", () => {
  const r = adaptateurHistorique({
    etudes: { etude0001: { num: "A-1", client: "Client" } },
    temps: { temps0001: { etude: "A-1", prenom: "Alex", statut: "Payé" } },
    createId: ids,
  });
  assert.equal(r.statut, "a_completer");
  assert.deepEqual(r.correspondancesManquantes.map(x => x.type), ["client", "membre"]);
});

test("conserve les champs et statuts historiques sans normalisation silencieuse", () => {
  const r = adaptateurHistorique({
    etudes: { etude0001: { num: "A-1", client: "Client", statut: "En réalisation" } },
    temps: { temps0001: { etude: "A-1", prenom: "Alex", statut: "A venir", min: 90 } },
    createId: ids,
  });
  assert.equal(r.donnees.etudes[0].statut, "En réalisation");
  assert.equal(r.donnees.temps[0].statut, "A venir");
  assert.equal(r.donnees.temps[0].min, 90);
});

test("ignore les identifiants client/membre invalides et les signale", () => {
  const r = adaptateurHistorique({
    etudes: { etude0001: { num: "A-1", client: "Client" } },
    temps: { temps0001: { etude: "A-1", prenom: "Alex", statut: "Payé" } },
    clientIdParEtudeSource: { etude0001: "client" },
    membreIdParTempsSource: { temps0001: "membre" },
    createId: ids,
  });
  assert.equal(r.statut, "a_completer");
  assert.deepEqual(r.correspondancesManquantes.map(x => x.type), ["client", "membre"]);
});
