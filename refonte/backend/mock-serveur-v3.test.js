const test = require("node:test");
const assert = require("node:assert/strict");
const { creerServeurMemoireV3 } = require("./mock-serveur-v3");

const TOKEN = "token-de-test-123";
const base = () => creerServeurMemoireV3({
  token: TOKEN,
  donnees: {
    clients: { client_0001: { id: "client_0001", raisonSociale: "Client A", _v: 1 } },
    membres: { membre_0001: { id: "membre_0001", nomComplet: "Alex Martin", _v: 1 } },
    etudes: { etude_0001: { id: "etude_0001", clientId: "client_0001", _v: 1 } },
    bvs: { bv_000001: { id: "bv_000001", _v: 1 } },
  },
});
const req = (action, extra = {}) => ({ action, apiVersion: 3, token: TOKEN, ...extra });
const body = response => response.body;

test("refuse de démarrer avec un token vide", () => {
  assert.throws(() => creerServeurMemoireV3({ token: "" }), /token non vide/);
});

test("ping est public et ne révèle pas le token", async () => {
  const server = base();
  const r = body(await server.transport({ action: "ping", apiVersion: 3 }));
  assert.equal(r.ok, true);
  assert.equal(r.data.authentifie, false);
  assert.equal(JSON.stringify(r).includes(TOKEN), false);
});

test("exige une authentification pour charger les collections", async () => {
  const server = base();
  assert.equal(body(await server.transport(req("loadAll", { token: "" }))).error.code, "AUTH_REQUIRED");
  assert.equal(body(await server.transport(req("loadAll", { token: "mauvais" }))).error.code, "AUTH_INVALID");
});

test("charge le modèle actif et la collection historique en lecture seule", async () => {
  const server = base();
  const r = body(await server.transport(req("loadAll")));
  assert.equal(r.ok, true);
  assert.ok(r.data.interventions);
  assert.ok(r.data.temps);
  assert.equal(r.meta.schemaVersion, 3);
});

test("crée une fiche en version 1 puis l'incrémente à la modification", async () => {
  const server = base();
  const create = body(await server.transport(req("save", {
    collection: "interventions", id: "interv_0001",
    record: { id: "interv_0001", etudeId: "etude_0001", membreId: "membre_0001", minutesIndividuelles: 240 },
    opId: "op_create_0001", expectedVersion: 0,
  })));
  assert.equal(create.data._v, 1);
  const update = body(await server.transport(req("save", {
    collection: "interventions", id: "interv_0001",
    record: { id: "interv_0001", etudeId: "etude_0001", membreId: "membre_0001", minutesIndividuelles: 480 },
    opId: "op_update_0001", expectedVersion: 1,
  })));
  assert.equal(update.data._v, 2);
  assert.equal(server.lireRevision(), 2);
});

test("un conflit de version ne modifie jamais la fiche", async () => {
  const server = base();
  const r = body(await server.transport(req("save", {
    collection: "clients", id: "client_0001",
    record: { id: "client_0001", raisonSociale: "Autre nom" },
    opId: "op_stale_0001", expectedVersion: 0,
  })));
  assert.equal(r.error.code, "VERSION_CONFLICT");
  assert.equal(server.lireDonnees().clients.client_0001.raisonSociale, "Client A");
  assert.equal(server.lireRevision(), 0);
});

test("deux écritures concurrentes sur la même version ne peuvent pas toutes deux réussir", async () => {
  const server = base();
  const payload = {
    collection: "clients", id: "client_0001", expectedVersion: 1,
  };
  const [a, b] = await Promise.all([
    server.transport(req("save", { ...payload, record: { id: "client_0001", raisonSociale: "A" }, opId: "op_race_0001" })),
    server.transport(req("save", { ...payload, record: { id: "client_0001", raisonSociale: "B" }, opId: "op_race_0002" })),
  ]);
  assert.equal([body(a), body(b)].filter(x => x.ok).length, 1);
  assert.equal([body(a), body(b)].filter(x => x.error?.code === "VERSION_CONFLICT").length, 1);
});

test("la répétition du même opId et du même contenu est idempotente", async () => {
  const server = base();
  const request = req("save", {
    collection: "clients", id: "client_0001",
    record: { id: "client_0001", raisonSociale: "Client A modifié" },
    opId: "op_repeat_0001", expectedVersion: 1,
  });
  const a = body(await server.transport(request));
  const b = body(await server.transport(request));
  assert.deepEqual(b, a);
  assert.equal(server.lireRevision(), 1);
});

test("un opId réutilisé avec un contenu différent est refusé", async () => {
  const server = base();
  const first = req("save", {
    collection: "clients", id: "client_0001", record: { id: "client_0001", raisonSociale: "A" },
    opId: "op_duplicate_0001", expectedVersion: 1,
  });
  await server.transport(first);
  const second = req("save", {
    collection: "clients", id: "client_0001", record: { id: "client_0001", raisonSociale: "B" },
    opId: "op_duplicate_0001", expectedVersion: 1,
  });
  assert.equal(body(await server.transport(second)).error.code, "DUPLICATE_OPERATION");
  assert.equal(server.lireDonnees().clients.client_0001.raisonSociale, "A");
});

test("la suppression crée un tombstone versionné au lieu d'effacer la fiche", async () => {
  const server = base();
  const r = body(await server.transport(req("delete", {
    collection: "membres", id: "membre_0001", opId: "op_delete_0001", expectedVersion: 1,
  })));
  assert.equal(r.data._deleted, true);
  assert.equal(r.data._v, 2);
  assert.equal(server.lireDonnees().membres.membre_0001._deleted, true);
});

test("un conflit de suppression conserve la fiche active", async () => {
  const server = base();
  const r = body(await server.transport(req("delete", {
    collection: "membres", id: "membre_0001", opId: "op_delete_0002", expectedVersion: 2,
  })));
  assert.equal(r.error.code, "VERSION_CONFLICT");
  assert.equal(server.lireDonnees().membres.membre_0001._deleted, undefined);
});

test("refuse les écritures sur temps et les collections inconnues", async () => {
  const server = base();
  const readOnly = await server.transport(req("save", {
    collection: "temps", id: "temps_0001", record: { id: "temps_0001" },
    opId: "op_temps_0001", expectedVersion: 0,
  }));
  const unknown = await server.transport(req("save", {
    collection: "surprise", id: "surprise_01", record: { id: "surprise_01" },
    opId: "op_unknown_01", expectedVersion: 0,
  }));
  assert.equal(body(readOnly).error.code, "READ_ONLY_COLLECTION");
  assert.equal(body(unknown).error.code, "UNKNOWN_COLLECTION");
});

test("vérifie les relations avant d'enregistrer une intervention", async () => {
  const server = base();
  const r = body(await server.transport(req("save", {
    collection: "interventions", id: "interv_0002",
    record: { id: "interv_0002", etudeId: "etude_absente", membreId: "membre_0001" },
    opId: "op_relation_0001", expectedVersion: 0,
  })));
  assert.equal(r.error.code, "INVALID_REQUEST");
  assert.equal(server.lireRevision(), 0);
});

test("mesure la taille en octets UTF-8 et refuse un payload trop grand", async () => {
  const server = creerServeurMemoireV3({ token: TOKEN, maxBytes: 30 });
  const r = body(await server.transport(req("save", {
    collection: "clients", id: "client_0001",
    record: { id: "client_0001", raisonSociale: "é".repeat(40) },
    opId: "op_big_payload_001", expectedVersion: 0,
  })));
  assert.equal(r.error.code, "PAYLOAD_TOO_LARGE");
});

test("refuse une API version incorrecte et une action inconnue", async () => {
  const server = base();
  assert.equal(body(await server.transport({ action: "loadAll", apiVersion: 2, token: TOKEN })).error.code, "API_VERSION_MISMATCH");
  assert.equal(body(await server.transport(req("inventer"))).error.code, "INVALID_REQUEST");
});

test("accepte uniquement config/main et protège la configuration contre la suppression", async () => {
  const server = base();
  const save = body(await server.transport(req("save", {
    collection: "config", id: "main", record: { id: "main", tva: 0.2 },
    opId: "op_config_save_01", expectedVersion: 0,
  })));
  assert.equal(save.ok, true, JSON.stringify(save));
  const del = body(await server.transport(req("delete", {
    collection: "config", id: "main", opId: "op_config_del_01", expectedVersion: 1,
  })));
  assert.equal(del.error.code, "INVALID_REQUEST");
});

test("refuse de supprimer un parent encore référencé par une fiche active", async () => {
  const server = base();
  const r = body(await server.transport(req("delete", {
    collection: "clients", id: "client_0001", opId: "op_delete_parent_01", expectedVersion: 1,
  })));
  assert.equal(r.error.code, "INVALID_REQUEST");
  assert.equal(server.lireDonnees().clients.client_0001._deleted, undefined);
});

test("ne publie jamais le marqueur interne opId, même pour les tombstones", async () => {
  const server = base();
  await server.transport(req("delete", {
    collection: "membres", id: "membre_0001", opId: "op_delete_internal_01", expectedVersion: 1,
  }));
  const loaded = body(await server.transport(req("loadAll")));
  assert.equal("_opId" in loaded.data.membres.membre_0001, false);
});
