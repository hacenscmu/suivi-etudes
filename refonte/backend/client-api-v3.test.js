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
  const c = client(async r => { request = r; return succes({ etudes: {}, clients: {}, membres: {}, factures: {}, interventions: {}, bvs: {}, lignesBV: {}, formation: {}, appareils: {}, config: { main: {} }, temps: {}, signalementsJEH: {} }); });
  const r = await c.loadAll();
  assert.equal(request.token, "token-test");
  assert.deepEqual(r.collections.etudes, []);
  assert.deepEqual(r.collections.interventions, []);
  assert.deepEqual(r.collections.signalementsJEH, []);
  assert.deepEqual(r.legacyTemps, {});
  assert.deepEqual(r.tombstones.etudes, {});
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

test("normalise les collections indexées en tableaux et sépare les tombstones", async () => {
  const c = client(async () => succes({
    etudes: {
      etude_0001: { id: "etude_0001", num: "A-1", _v: 2 },
      etude_0002: { id: "etude_0002", _deleted: true, _v: 3 },
    },
    clients: {}, membres: {}, factures: {}, interventions: {}, bvs: {}, lignesBV: {},
    formation: {}, appareils: {}, signalementsJEH: {}, config: { main: { id: "main", tva: 0.2 } },
    temps: { temps_0001: { prenom: "Alex", min: 60 } },
  }));
  const r = await c.loadAll();
  assert.deepEqual(r.collections.etudes, [{ id: "etude_0001", num: "A-1", _v: 2 }]);
  assert.deepEqual(r.tombstones.etudes, { etude_0002: 3 });
  assert.equal(r.config.id, "main");
  assert.equal(r.legacyTemps.temps_0001.prenom, "Alex");
});

test("refuse une collection active absente ou mal formée dans loadAll", async () => {
  const c = client(async () => succes({ etudes: {} }));
  await assert.rejects(c.loadAll(), e => e.code === "INVALID_RESPONSE" && e.message.includes("clients"));
});

test("autorise uniquement la fiche config/main et interdit sa suppression", async () => {
  let request;
  const c = client(async r => { request = r; return succes({ id: "main" }); });
  await c.save({ collection: "config", id: "main", record: { id: "main", tva: 0.2 }, opId: "op_config_0001", expectedVersion: 1 });
  assert.equal(request.id, "main");
  await assert.rejects(c.save({ collection: "config", id: "config_0001", record: { id: "config_0001" }, opId: "op_config_0002", expectedVersion: 0 }), e => e.code === "INVALID_REQUEST");
  await assert.rejects(c.delete({ collection: "config", id: "main", opId: "op_config_0003", expectedVersion: 1 }), e => e.code === "INVALID_REQUEST");
});


test("session authentifie le ping et récupère le rôle côté serveur", async () => {
  let request;
  const c = client(async r => { request = r; return succes({ authentifie: true, membreId: "membre_0001", role: "Salarie" }); });
  const session = await c.session();
  assert.equal(request.action, "ping");
  assert.equal(request.token, "token-test");
  assert.equal(session.role, "Salarie");
});

test("expose les opérations de gestion des accès avec validation des identifiants", async () => {
  const demandes = [];
  const c = client(async r => { demandes.push(r); return succes({ role: r.role || "Salarie", code: "ABCDEFGH", active: true, membres: [], codesGeneres: [] }); });
  await c.adminAcces();
  await c.definirRole({ membreId: "membre_0001", role: "Membre" });
  await c.regenererCode({ membreId: "membre_0001" });
  await c.desactiverAcces({ membreId: "membre_0001" });
  await c.reactiverAcces({ membreId: "membre_0001" });
  await c.changerMonCode();
  assert.deepEqual(demandes.map(r => r.action), ["adminAcces", "adminDefinirRole", "adminRegenererCode", "adminDesactiver", "adminReactiver", "changerMonCode"]);
  await assert.rejects(c.definirRole({ membreId: "bad", role: "Membre" }), e => e.code === "INVALID_REQUEST");
  await assert.rejects(c.definirRole({ membreId: "membre_0001", role: "Président" }), e => e.code === "INVALID_REQUEST");
});
