const test = require("node:test");
const assert = require("node:assert/strict");
const { creerClientApiV3, ErreurApiV3 } = require("./client-api-v3");

const succes = data => ({ status: 200, body: { ok: true, apiVersion: 3, data, meta: { revision: "r1" }, error: null } });
const client = (transport, token = "token-test") => creerClientApiV3({
  transport,
  obtenirToken: () => token,
});

test("refuse la création du client sans transport ou fournisseur de token", () => {
  assert.throws(() => creerClientApiV3(), /transport HTTP/);
  assert.throws(() => creerClientApiV3({ transport: async () => succes({}) }), /obtenirToken/);
});

test("ping est public et vérifie la version du contrat", async () => {
  let request;
  const c = client(async r => { request = r; return succes({ authenticated: false }); });
  const data = await c.ping();
  assert.equal(request.action, "ping");
  assert.equal(request.apiVersion, 3);
  assert.equal("token" in request, false);
  assert.deepEqual(data, { authenticated: false });
});

test("loadAll exige un token et retourne les collections et métadonnées", async () => {
  let request;
  const c = client(async r => { request = r; return succes({ etudes: {}, interventions: {}, temps: {} }); });
  const r = await c.loadAll();
  assert.equal(request.token, "token-test");
  assert.deepEqual(r.collections, { etudes: {}, interventions: {}, temps: {} });
  assert.equal(r.meta.revision, "r1");
});

test("refuse un token absent ou vide avant tout appel réseau", async () => {
  let called = false;
  const c = client(async () => { called = true; return succes({}); }, "  ");
  await assert.rejects(c.loadAll(), e => e.code === "AUTH_REQUIRED");
  assert.equal(called, false);
});

test("save envoie l'intervention avec opId/version et retire les métadonnées serveur", async () => {
  let request;
  const c = client(async r => { request = r; return succes({ id: r.id, _v: 2 }); });
  const result = await c.save({
    collection: "interventions",
    id: "interv_0001",
    record: { id: "interv_0001", etudeId: "etude_0001", _v: 99, _par: "client", _le: "date" },
    opId: "op_interv_0001",
    expectedVersion: 1,
  });
  assert.equal(request.collection, "interventions");
  assert.equal(request.record.id, "interv_0001");
  assert.equal("_v" in request.record, false);
  assert.equal("_par" in request.record, false);
  assert.equal("_le" in request.record, false);
  assert.equal(request.expectedVersion, 1);
  assert.equal(request.opId, "op_interv_0001");
  assert.equal(result.data._v, 2);
});

test("bloque les écritures sur la collection historique temps", async () => {
  let called = false;
  const c = client(async () => { called = true; return succes({}); });
  await assert.rejects(c.save({
    collection: "temps", id: "temps_0001", record: { id: "temps_0001" },
    opId: "op_temps_0001", expectedVersion: 0,
  }), e => e.code === "READ_ONLY_COLLECTION");
  assert.equal(called, false);
});

test("refuse collection inconnue, id incohérent, opId absent et version invalide", async () => {
  const c = client(async () => succes({}));
  await assert.rejects(c.save({ collection: "inconnue" }), e => e.code === "UNKNOWN_COLLECTION");
  await assert.rejects(c.save({
    collection: "clients", id: "client_0001", record: { id: "client_0002" },
    opId: "op_client_0001", expectedVersion: 0,
  }), e => e.code === "INVALID_REQUEST");
  await assert.rejects(c.save({
    collection: "clients", id: "client_0001", record: { id: "client_0001" },
    expectedVersion: 0,
  }), e => e.code === "INVALID_REQUEST");
  await assert.rejects(c.save({
    collection: "clients", id: "client_0001", record: { id: "client_0001" },
    opId: "op_client_0001", expectedVersion: -1,
  }), e => e.code === "INVALID_REQUEST");
});

test("delete exige une version existante et envoie une suppression logique identifiée", async () => {
  let request;
  const c = client(async r => { request = r; return succes({ tombstone: true }); });
  const result = await c.delete({ collection: "factures", id: "facture_0001", opId: "op_delete_0001", expectedVersion: 3 });
  assert.equal(request.action, "delete");
  assert.equal(request.expectedVersion, 3);
  assert.equal(result.data.tombstone, true);
  await assert.rejects(c.delete({
    collection: "factures", id: "facture_0001", opId: "op_delete_0002", expectedVersion: 0,
  }), e => e.code === "INVALID_REQUEST");
});

test("remonte les conflits métier sans les transformer en succès", async () => {
  const c = client(async () => ({
    status: 409,
    body: { ok: false, apiVersion: 3, error: { code: "VERSION_CONFLICT", message: "Version obsolète" } },
  }));
  await assert.rejects(c.save({
    collection: "clients", id: "client_0001", record: { id: "client_0001" },
    opId: "op_client_0001", expectedVersion: 2,
  }), e => e instanceof ErreurApiV3 && e.code === "VERSION_CONFLICT");
});

test("refuse une réponse v11 non enveloppée et une version d'API incompatible", async () => {
  const c = client(async () => ({ etudes: {} }));
  await assert.rejects(c.loadAll(), e => e.code === "API_VERSION_MISMATCH");
  const c2 = client(async () => ({ ok: true, apiVersion: 2, data: {} }));
  await assert.rejects(c2.loadAll(), e => e.code === "API_VERSION_MISMATCH");
});

test("une erreur réseau est explicitement retentable et ne devient pas un succès", async () => {
  const c = client(async () => { throw new Error("offline"); });
  await assert.rejects(c.loadAll(), e => e.code === "NETWORK_ERROR" && /conservée pour réessai/.test(e.message));
});

test("refuse une enveloppe invalide ou une réponse de succès sans data", async () => {
  const c = client(async () => ({ status: 200, body: "pas du json" }));
  await assert.rejects(c.loadAll(), e => e.code === "INVALID_RESPONSE");
  const c2 = client(async () => ({ ok: true, apiVersion: 3 }));
  await assert.rejects(c2.loadAll(), e => e.code === "INVALID_RESPONSE");
});
