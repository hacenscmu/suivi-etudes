/** Tests propres au vrai Code.gs (simulé) : pannes, doublons, corruption, jetons, configuration. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { creerServeurAppsScriptSimule } = require("./simulateur");

const TOKEN = "jeton-de-test-0123456789abcdef";
const base = { clients: { client_0001: { id: "client_0001", raisonSociale: "A", _v: 1 } } };
const req = (action, extra = {}) => ({ action, apiVersion: 3, token: TOKEN, ...extra });
const save = (id, record, expectedVersion, opId, collection = "clients") => req("save", { collection, id, record: { id, ...record }, expectedVersion, opId });
const body = async (s, q) => (await s.transport(q)).body;

test("le jeton n'est stocké nulle part, seule son empreinte", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_secret_0001"));
  await body(s, req("loadAll"));
  const tout = JSON.stringify([s.props, s.feuilles["Données"].rows, s.feuilles["Journal"].rows, s.journaux]);
  assert.ok(!tout.includes(TOKEN));
});

test("jeton révoqué : AUTH_INVALID", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  s.api.revoquerJeton("membre_test");
  assert.equal((await body(s, req("loadAll"))).error.code, "AUTH_INVALID");
});

test("l'auteur enregistré vient du jeton, les champs système du client sont ignorés", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  const r = await body(s, save("client_0001", { raisonSociale: "B", _v: 99, _par: "pirate", _le: "1999" }, 1, "op_systeme_0001"));
  assert.equal(r.data._v, 2);
  assert.equal(r.data._par, "membre_test");
  assert.notEqual(r.data._le, "1999");
});

test("panne après le Journal « pending » : rien écrit, rejeu déterministe, nouvelle opération possible", async () => {
  let n = 0;
  const crochets = {};
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base, crochets });
  crochets.panne = nom => nom === "Données";
  const r1 = await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne1_0001"));
  crochets.panne = null;
  assert.equal(r1.error.code, "INTERNAL_ERROR");
  assert.equal(s.lireDonnees().clients.client_0001.raisonSociale, "A");
  const r2 = await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne1_0001"));
  assert.equal(r2.error.code, "OP_INTERRUPTED");
  assert.deepEqual(await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne1_0001")), r2);
  assert.equal((await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne1_0002"))).data._v, 2);
});

test("panne après l'écriture de la fiche : le rejeu restitue le succès sans double écriture", async () => {
  const crochets = {};
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base, crochets });
  let n = 0;
  crochets.panne = nom => nom === "Journal" && ++n > 1; // 1re écriture Journal (pending) OK, la clôture échoue
  const r1 = await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne2_0001"));
  crochets.panne = null;
  assert.equal(r1.error.code, "INTERNAL_ERROR");
  assert.equal(s.lireDonnees().clients.client_0001._v, 2);
  const lignes = JSON.stringify(s.feuilles["Données"].rows);
  const r2 = await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne2_0001"));
  assert.equal(r2.ok, true);
  assert.equal(r2.data._v, 2);
  assert.equal(JSON.stringify(s.feuilles["Données"].rows), lignes);
});

test("une autre opération sur la fiche résout d'abord l'opération interrompue", async () => {
  const crochets = {};
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base, crochets });
  let n = 0;
  crochets.panne = nom => nom === "Journal" && ++n > 1;
  await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne3_0001"));
  crochets.panne = null;
  assert.equal((await body(s, save("client_0001", { raisonSociale: "C" }, 1, "op_autre_0001"))).error.code, "VERSION_CONFLICT");
  assert.ok(!s.feuilles["Journal"].rows.some(r => r[4] === "pending"));
  assert.equal((await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_panne3_0001"))).data._v, 2);
});

test("clé en doublon ou ligne illisible : jamais publiée, jamais écrasée, réparable", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  s.feuilles["Données"].rows.push(["clients", "client_0001", JSON.stringify({ id: "client_0001", raisonSociale: "Z", _v: 1 })]);
  s.feuilles["Données"].rows.push(["clients", "client_0002", "{cassé"]);
  const L = await body(s, req("loadAll"));
  assert.ok(!("client_0001" in L.data.clients) && !("client_0002" in L.data.clients));
  assert.deepEqual([...new Set(L.meta.anomalies.map(a => a.erreur))].sort(), ["doublon", "json"]);
  const avant = JSON.stringify(s.feuilles["Données"].rows);
  assert.equal((await body(s, save("client_0001", { raisonSociale: "B" }, 1, "op_doublon_0001"))).error.code, "INVALID_REQUEST");
  assert.equal(JSON.stringify(s.feuilles["Données"].rows), avant);
  assert.equal(s.api.mettreEnQuarantaine("clients", "client_0001"), 2);
  assert.equal(s.feuilles["Quarantaine"].rows.length, 3);
  assert.equal(s.feuilles["Données"].rows.filter(r => r[1] === "client_0001").length, 1);
});

test("les anciennes lignes v11 « temps » restent lisibles mais non modifiables", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: { temps: { t_legacy_0001: { prenom: "A", min: 120, nb: 2, statut: "Payé" } } } });
  const L = await body(s, req("loadAll"));
  assert.equal(L.data.temps.t_legacy_0001.min, 120);
  assert.equal((await body(s, req("save", { collection: "temps", id: "t_legacy_0001", record: { id: "t_legacy_0001" }, expectedVersion: 0, opId: "op_temps_0001" }))).error.code, "READ_ONLY_COLLECTION");
});

test("configuration cassée : INTERNAL_ERROR sans détail ni création de tableur", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  s.props.TOKENS = "{cassé";
  const r = await body(s, req("loadAll"));
  assert.equal(r.error.code, "INTERNAL_ERROR");
  assert.ok(!r.error.message.includes("TOKENS"));
  const s2 = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  delete s2.props.SSID;
  assert.equal((await body(s2, req("loadAll"))).error.code, "INTERNAL_ERROR");
});

test("corps de requête mesuré en octets UTF-8", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  const r = await body(s, save("client_0001", { note: "𝄞".repeat(80000) }, 1, "op_taille_0001"));
  assert.equal(r.error.code, "PAYLOAD_TOO_LARGE");
});

test("un tombstone ne publie pas le marqueur interne _opId", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: { ...base, membres: { membre_0001: { id: "membre_0001", _v: 1 } } } });
  await body(s, req("delete", { collection: "membres", id: "membre_0001", expectedVersion: 1, opId: "op_tombstone_hide_01" }));
  const loaded = await body(s, req("loadAll"));
  assert.equal(loaded.data.membres.membre_0001._deleted, true);
  assert.equal("_opId" in loaded.data.membres.membre_0001, false);
});

test("le serveur refuse de supprimer un client encore référencé par une étude", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: {
    clients: { client_0001: { id: "client_0001", _v: 1 } },
    etudes: { etude_0001: { id: "etude_0001", clientId: "client_0001", _v: 1 } },
  } });
  const r = await body(s, req("delete", { collection: "clients", id: "client_0001", expectedVersion: 1, opId: "op_delete_parent_01" }));
  assert.equal(r.error.code, "INVALID_REQUEST");
});

test("le serveur refuse une intervention aux champs métier invalides", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: {
    etudes: { etude_0001: { id: "etude_0001", _v: 1 } },
    membres: { membre_0001: { id: "membre_0001", nomComplet: "A", _v: 1 } },
  } });
  const r = await body(s, req("save", {
    collection: "interventions", id: "interv_bad_001",
    record: { id: "interv_bad_001", etudeId: "etude_0001", membreId: "membre_0001", date: "2026-02-30", statut: "Pas payé", minutesIndividuelles: -1 },
    expectedVersion: 0, opId: "op_interv_bad_001",
  }));
  assert.equal(r.error.code, "INVALID_REQUEST");
  assert.equal(s.lireRevision(), 0);
});
