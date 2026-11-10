const test = require("node:test");
const assert = require("node:assert/strict");
const { creerClientApiV3 } = require("./client-api-v3");
const { creerServeurMemoireV3 } = require("./mock-serveur-v3");

const TOKEN = "token-integration-123";
function setup() {
  const serveur = creerServeurMemoireV3({
    token: TOKEN,
    donnees: {
      clients: { client_0001: { id: "client_0001", raisonSociale: "Client A", _v: 1 } },
      membres: { membre_0001: { id: "membre_0001", nomComplet: "Alex Martin", _v: 1 } },
      etudes: { etude_0001: { id: "etude_0001", clientId: "client_0001", _v: 1 } },
      bvs: { bv_000001: { id: "bv_000001", _v: 1 } },
    },
  });
  return {
    serveur,
    client: creerClientApiV3({ transport: serveur.transport, obtenirToken: () => TOKEN }),
  };
}

test("le client et le serveur v3 dialoguent pour lire et modifier une fiche", async () => {
  const { client } = setup();
  const avant = await client.loadAll();
  assert.equal(avant.collections.clients[0].raisonSociale, "Client A");
  const saved = await client.save({
    collection: "clients",
    id: "client_0001",
    record: { id: "client_0001", raisonSociale: "Client B" },
    opId: "op_integration_save_001",
    expectedVersion: 1,
  });
  assert.equal(saved.data._v, 2);
  const apres = await client.loadAll();
  assert.equal(apres.collections.clients[0].raisonSociale, "Client B");
});

test("le client reçoit un conflit sans écraser la version concurrente", async () => {
  const { client } = setup();
  await client.save({
    collection: "clients", id: "client_0001",
    record: { id: "client_0001", raisonSociale: "Version 2" },
    opId: "op_integration_save_002", expectedVersion: 1,
  });
  await assert.rejects(client.save({
    collection: "clients", id: "client_0001",
    record: { id: "client_0001", raisonSociale: "Écrasement interdit" },
    opId: "op_integration_save_003", expectedVersion: 1,
  }), e => e.code === "VERSION_CONFLICT");
  assert.equal((await client.loadAll()).collections.clients[0].raisonSociale, "Version 2");
});

test("le client propage un tombstone après suppression logique", async () => {
  const { client } = setup();
  const deleted = await client.delete({
    collection: "clients", id: "client_0001",
    opId: "op_integration_delete_001", expectedVersion: 1,
  });
  assert.equal(deleted.data._deleted, true);
  const state = await client.loadAll();
  assert.equal(state.tombstones.clients.client_0001, 2);
  assert.equal(state.collections.clients.length, 0);
});

test("le client n'envoie jamais d'écriture dans temps historique", async () => {
  const { client, serveur } = setup();
  await assert.rejects(client.save({
    collection: "temps", id: "temps_0001",
    record: { id: "temps_0001" },
    opId: "op_integration_temps_001",
    expectedVersion: 0,
  }), e => e.code === "READ_ONLY_COLLECTION");
  assert.equal(serveur.lireRevision(), 0);
});
