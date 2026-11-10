const test = require("node:test");
const assert = require("node:assert/strict");
const { creerFileHorsLigne } = require("./file-hors-ligne");

function stockage(initial = []) {
  let file = structuredClone(initial);
  return {
    lire: async () => structuredClone(file),
    ecrire: async next => { file = structuredClone(next); },
    valeur: () => structuredClone(file),
  };
}
const saveOp = (opId, name = "Client B", expectedVersion = 1) => ({
  type: "save", collection: "clients", id: "client_0001",
  record: { id: "client_0001", raisonSociale: name },
  opId, expectedVersion,
});
const apiOk = () => ({
  save: async () => ({ data: { ok: true } }),
  delete: async () => ({ data: { ok: true } }),
});

test("exige un stockage et un client API injectés", () => {
  assert.throws(() => creerFileHorsLigne(), /stockage asynchrone/);
  assert.throws(() => creerFileHorsLigne({ stockage: stockage() }), /client API v3/);
});

test("ajoute une opération et rend l'ajout idempotent dans la file", async () => {
  const store = stockage();
  const file = creerFileHorsLigne({ stockage: store, api: apiOk() });
  assert.deepEqual(await file.ajouter(saveOp("op_queue_0001")), {
    ajoutee: true, dejaPresente: false, nombre: 1,
  });
  assert.deepEqual(await file.ajouter(saveOp("op_queue_0001")), {
    ajoutee: false, dejaPresente: true, nombre: 1,
  });
  assert.equal(store.valeur()[0].etat, "en_attente");
});

test("refuse un opId déjà présent avec un contenu différent", async () => {
  const file = creerFileHorsLigne({ stockage: stockage(), api: apiOk() });
  await file.ajouter(saveOp("op_queue_0002", "Client B"));
  await assert.rejects(file.ajouter(saveOp("op_queue_0002", "Client C")), e => e.code === "DUPLICATE_OPERATION");
});

test("retire l'opération uniquement après succès API explicite", async () => {
  const store = stockage();
  let appels = 0;
  const file = creerFileHorsLigne({
    stockage: store,
    api: { save: async () => { appels += 1; return { data: { id: "client_0001" } }; }, delete: async () => ({}) },
  });
  await file.ajouter(saveOp("op_queue_0003"));
  const r = await file.synchroniser();
  assert.equal(r.traitees, 1);
  assert.equal(r.restantes, 0);
  assert.equal(appels, 1);
  assert.deepEqual(store.valeur(), []);
});

test("conserve l'opération après une coupure réseau", async () => {
  const store = stockage();
  const file = creerFileHorsLigne({
    stockage: store,
    api: { save: async () => { const e = new Error("hors ligne"); e.code = "NETWORK_ERROR"; throw e; }, delete: async () => ({}) },
  });
  await file.ajouter(saveOp("op_queue_0004"));
  const r = await file.synchroniser();
  assert.equal(r.traitees, 0);
  assert.equal(r.restantes, 1);
  assert.equal(r.bloquePar.code, "NETWORK_ERROR");
  assert.equal((await file.inspecter())[0].opId, "op_queue_0004");
});

test("un conflit est conservé et bloque les opérations suivantes", async () => {
  const store = stockage();
  const appels = [];
  const file = creerFileHorsLigne({
    stockage: store,
    api: {
      save: async op => { appels.push(op.opId); const e = new Error("conflit"); e.code = "VERSION_CONFLICT"; throw e; },
      delete: async () => ({}),
    },
  });
  await file.ajouter(saveOp("op_queue_0005"));
  await file.ajouter(saveOp("op_queue_0006", "Client C"));
  const r = await file.synchroniser();
  assert.equal(r.restantes, 2);
  assert.equal(r.bloquePar.code, "VERSION_CONFLICT");
  assert.deepEqual(appels, ["op_queue_0005"]);
  assert.equal((await file.inspecter())[0].etat, "conflit");
});

test("une résolution explicite remplace le conflit par un nouvel opId et une nouvelle version", async () => {
  const store = stockage();
  let sent;
  const file = creerFileHorsLigne({
    stockage: store,
    api: {
      save: async op => {
        sent = op;
        if (op.expectedVersion === 1) { const e = new Error("conflit"); e.code = "VERSION_CONFLICT"; throw e; }
        return { data: { ok: true } };
      },
      delete: async () => ({}),
    },
  });
  await file.ajouter(saveOp("op_queue_0007"));
  await file.synchroniser();
  await file.remplacerApresConflit("op_queue_0007", saveOp("op_queue_0008", "Client après arbitrage", 2));
  const r = await file.synchroniser();
  assert.equal(r.traitees, 1);
  assert.equal(sent.opId, "op_queue_0008");
  assert.equal(sent.expectedVersion, 2);
  assert.equal(r.restantes, 0);
});

test("la résolution d'un conflit exige un nouvel opId", async () => {
  const store = stockage();
  const file = creerFileHorsLigne({
    stockage: store,
    api: { save: async () => { const e = new Error("conflit"); e.code = "VERSION_CONFLICT"; throw e; }, delete: async () => ({}) },
  });
  await file.ajouter(saveOp("op_queue_0009"));
  await file.synchroniser();
  await assert.rejects(
    file.remplacerApresConflit("op_queue_0009", saveOp("op_queue_0009", "nouveau", 2)),
    e => e.code === "DUPLICATE_OPERATION"
  );
});

test("une suppression hors ligne passe par l'API et est retirée après succès", async () => {
  const store = stockage();
  let args;
  const file = creerFileHorsLigne({
    stockage: store,
    api: { save: async () => ({}), delete: async a => { args = a; return { data: { tombstone: true } }; } },
  });
  await file.ajouter({
    type: "delete", collection: "clients", id: "client_0001",
    opId: "op_queue_delete_01", expectedVersion: 2,
  });
  const r = await file.synchroniser();
  assert.equal(args.expectedVersion, 2);
  assert.equal(r.restantes, 0);
});

test("refuse une file persistée corrompue sans l'écraser", async () => {
  const store = { lire: async () => "corrompu", ecrire: async () => { throw new Error("ne doit pas écrire"); } };
  const file = creerFileHorsLigne({ stockage: store, api: apiOk() });
  await assert.rejects(file.inspecter(), e => e.code === "CORRUPT_QUEUE");
});

test("conserve l'ordre FIFO et arrête après la première erreur", async () => {
  const store = stockage();
  const ordre = [];
  const file = creerFileHorsLigne({
    stockage: store,
    api: {
      save: async op => { ordre.push(op.opId); if (op.opId === "op_queue_0012") { const e = new Error("stop"); e.code = "NETWORK_ERROR"; throw e; } },
      delete: async () => ({}),
    },
  });
  await file.ajouter(saveOp("op_queue_0011"));
  await file.ajouter(saveOp("op_queue_0012", "C"));
  await file.ajouter(saveOp("op_queue_0013", "D"));
  const r = await file.synchroniser();
  assert.deepEqual(ordre, ["op_queue_0011", "op_queue_0012"]);
  assert.equal(r.traitees, 1);
  assert.equal(r.restantes, 2);
});

test("abandonner ne retire que l'opération explicitement ciblée", async () => {
  const store = stockage();
  const file = creerFileHorsLigne({ stockage: store, api: apiOk() });
  await file.ajouter(saveOp("op_queue_0014"));
  await file.ajouter(saveOp("op_queue_0015", "Client C"));
  assert.deepEqual(await file.abandonner("op_queue_0014"), { retiree: true, nombre: 1 });
  assert.equal((await file.inspecter())[0].opId, "op_queue_0015");
});

test("réessaie avec le même opId si la réponse réseau est perdue après écriture serveur", async () => {
  const { creerClientApiV3 } = require("./client-api-v3");
  const { creerServeurMemoireV3 } = require("./mock-serveur-v3");
  const serveur = creerServeurMemoireV3({
    token: "token-retry-123",
    donnees: { clients: { client_0001: { id: "client_0001", raisonSociale: "Avant", _v: 1 } } },
  });
  let perdrePremiereReponse = true;
  const api = creerClientApiV3({
    obtenirToken: () => "token-retry-123",
    transport: async request => {
      const response = await serveur.transport(request);
      if (request.action === "save" && perdrePremiereReponse) {
        perdrePremiereReponse = false;
        throw new Error("réponse perdue après commit");
      }
      return response;
    },
  });
  const store = stockage();
  const file = creerFileHorsLigne({ stockage: store, api });
  await file.ajouter(saveOp("op_queue_retry_001", "Après", 1));
  const premier = await file.synchroniser();
  assert.equal(premier.restantes, 1);
  assert.equal(serveur.lireRevision(), 1);
  assert.equal(serveur.lireDonnees().clients.client_0001.raisonSociale, "Après");
  const second = await file.synchroniser();
  assert.equal(second.traitees, 1);
  assert.equal(second.restantes, 0);
  assert.equal(serveur.lireRevision(), 1);
  assert.deepEqual(await file.inspecter(), []);
});

test("refuse de mettre en file une écriture dans la collection historique temps", async () => {
  const store = stockage();
  const file = creerFileHorsLigne({ stockage: store, api: apiOk() });
  await assert.rejects(file.ajouter({
    type: "save", collection: "temps", id: "temps_0001",
    record: { id: "temps_0001" }, opId: "op_queue_temps_001", expectedVersion: 0,
  }), e => e.code === "READ_ONLY_COLLECTION");
  assert.deepEqual(store.valeur(), []);
});
