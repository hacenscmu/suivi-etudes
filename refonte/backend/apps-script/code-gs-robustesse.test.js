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

test("un id JSON incohérent ou une version invalide est mis en quarantaine logique et jamais publié", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: base });
  s.feuilles["Données"].rows.push(["clients", "client_0002", JSON.stringify({ id: "client_9999", raisonSociale: "Mauvais id", _v: 1 })]);
  s.feuilles["Données"].rows.push(["clients", "client_0003", JSON.stringify({ id: "client_0003", raisonSociale: "Mauvaise version", _v: -1 })]);
  const loaded = await body(s, req("loadAll"));
  assert.equal(loaded.data.clients.client_0002, undefined);
  assert.equal(loaded.data.clients.client_0003, undefined);
  assert.ok(loaded.meta.anomalies.some(a => a.erreur === "id_mismatch"));
  assert.ok(loaded.meta.anomalies.some(a => a.erreur === "version"));
  const unchanged = JSON.stringify(s.feuilles["Données"].rows);
  const write = await body(s, save("client_0003", { raisonSociale: "Écrasement" }, 0, "op_corrupt_version_01"));
  assert.equal(write.error.code, "INVALID_REQUEST");
  assert.equal(JSON.stringify(s.feuilles["Données"].rows), unchanged);
});


const crypto = require("node:crypto");
const tokenHash = value => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const donneesAcces = {
  membres: {
    membre_0001: { id: "membre_0001", nomComplet: "Alice Martin", _v: 1 },
    membre_0002: { id: "membre_0002", nomComplet: "Bob Durand", _v: 1 },
  },
  clients: { client_0001: { id: "client_0001", raisonSociale: "Client confidentiel", _v: 1 } },
  etudes: {
    etude_0001: { id: "etude_0001", num: "HAC-001", resume: "Étude Alice", client: "Client confidentiel", montant: 5000, _v: 1 },
    etude_0002: { id: "etude_0002", num: "HAC-002", resume: "Étude Bob", client: "Autre client", montant: 9000, _v: 1 },
  },
  factures: { facture_0001: { id: "facture_0001", etudeId: "etude_0001", montant: 5000, _v: 1 } },
  interventions: {
    interv_0001: { id: "interv_0001", etudeId: "etude_0001", membreId: "membre_0001", minutesIndividuelles: 240, statut: "Pas payé", _v: 1 },
    interv_0002: { id: "interv_0002", etudeId: "etude_0002", membreId: "membre_0002", minutesIndividuelles: 480, statut: "Payé", _v: 1 },
  },
  bvs: { bv_0000001: { id: "bv_0000001", reference: "BV-Alice", _v: 1 }, bv_0000002: { id: "bv_0000002", reference: "BV-Bob", _v: 1 } },
  lignesBV: {
    ligne_000001: { id: "ligne_000001", bvId: "bv_0000001", membreId: "membre_0001", jeh: 0.5, _v: 1 },
    ligne_000002: { id: "ligne_000002", bvId: "bv_0000002", membreId: "membre_0002", jeh: 1, _v: 1 },
  },
  formation: {
    form_000001: { id: "form_000001", membreId: "membre_0001", nom: "Formation Alice", niveaux: { etude_0001: 2 }, _v: 1 },
    form_000002: { id: "form_000002", membreId: "membre_0002", nom: "Formation Bob", niveaux: { etude_0002: 3 }, _v: 1 },
  },
};

test("la liste des accès crée un code salarié de 8 caractères au plus une seule fois", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: donneesAcces });
  const first = await body(s, req("adminAcces"));
  assert.equal(first.ok, true);
  assert.equal(first.data.membres.length, 2);
  assert.equal(first.data.codesGeneres.length, 2);
  assert.ok(first.data.codesGeneres.every(x => x.code.length <= 8 && /^[A-HJ-NP-Z2-9]+$/.test(x.code)));
  const second = await body(s, req("adminAcces"));
  assert.deepEqual(second.data.codesGeneres, []);
  assert.ok(second.data.membres.every(x => x.role === "Salarie"));
});

test("un salarié ne reçoit que ses données et les fiches strictement nécessaires", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: donneesAcces });
  const admin = await body(s, req("adminAcces"));
  const alice = admin.data.codesGeneres.find(x => x.id === "membre_0001").code;
  const loaded = await body(s, { action: "loadAll", apiVersion: 3, token: alice });
  assert.equal(loaded.ok, true);
  assert.deepEqual(Object.keys(loaded.data.membres), ["membre_0001"]);
  assert.deepEqual(Object.keys(loaded.data.interventions), ["interv_0001"]);
  assert.deepEqual(Object.keys(loaded.data.lignesBV), ["ligne_000001"]);
  assert.deepEqual(Object.keys(loaded.data.bvs), ["bv_0000001"]);
  assert.deepEqual(Object.keys(loaded.data.formation), ["form_000001"]);
  assert.deepEqual(Object.keys(loaded.data.etudes), ["etude_0001"]);
  assert.deepEqual(loaded.data.etudes.etude_0001, { id: "etude_0001", num: "HAC-001", resume: "Étude Alice", date: "", statut: "" });
  assert.deepEqual(loaded.data.clients, {});
  assert.deepEqual(loaded.data.factures, {});
  assert.deepEqual(loaded.data.config, {});
  assert.equal(JSON.stringify(loaded.data).includes("Client confidentiel"), false);
  assert.equal(JSON.stringify(loaded.data).includes("Bob Durand"), false);
  assert.equal(JSON.stringify(loaded.data).includes("HAC-002"), false);
});

test("un salarié ne peut ni écrire ni administrer les accès", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: donneesAcces });
  const admin = await body(s, req("adminAcces"));
  const alice = admin.data.codesGeneres.find(x => x.id === "membre_0001").code;
  const write = await body(s, { action: "save", apiVersion: 3, token: alice, collection: "clients", id: "client_0001", record: { id: "client_0001", raisonSociale: "Intrusion" }, expectedVersion: 1, opId: "op_forbidden_0001" });
  assert.equal(write.error.code, "FORBIDDEN");
  const manage = await body(s, { action: "adminAcces", apiVersion: 3, token: alice });
  assert.equal(manage.error.code, "FORBIDDEN");
});

test("seul un membre peut changer le rôle, régénérer ou désactiver un accès", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: donneesAcces });
  const admin = await body(s, req("adminAcces"));
  const alice = admin.data.codesGeneres.find(x => x.id === "membre_0001").code;
  const promotion = await body(s, req("adminDefinirRole", { membreId: "membre_0001", role: "Membre" }));
  assert.equal(promotion.data.role, "Membre");
  assert.equal(promotion.data.code.length, 32);
  assert.equal((await body(s, { action: "loadAll", apiVersion: 3, token: alice })).error.code, "AUTH_INVALID");
  const ping = await body(s, { action: "ping", apiVersion: 3, token: promotion.data.code });
  assert.equal(ping.data.role, "Membre");
  const off = await body(s, req("adminDesactiver", { membreId: "membre_0001" }));
  assert.equal(off.data.active, false);
  assert.equal((await body(s, { action: "loadAll", apiVersion: 3, token: promotion.data.code })).error.code, "AUTH_INVALID");
});


test("le dernier compte Membre ne peut pas se rétrograder ni se désactiver", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: { membres: { membre_0001: { id: "membre_0001", nomComplet: "Administratrice", _v: 1 } } }, membre: "membre_0001" });
  const down = await body(s, req("adminDefinirRole", { membreId: "membre_0001", role: "Salarie" }));
  assert.equal(down.error.code, "LAST_ADMIN");
  const off = await body(s, req("adminDesactiver", { membreId: "membre_0001" }));
  assert.equal(off.error.code, "LAST_ADMIN");
  assert.equal((await body(s, req("ping"))).data.role, "Membre");
});


test("un salarié reçoit les seuls paramètres de paie, pas les réglages de gestion", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: {
    membres: { membre_0001: { id: "membre_0001", nomComplet: "Alice", _v: 1 } },
    config: { main: { id: "main", smic: 13, cot: { salariale: 0.1 }, patr: { patronale: 0.2 }, chomage: 0.01, tva: 0.2, relance1: 3, mandats: [{ nom: "secret" }], _v: 1 } },
  } });
  const created = await body(s, req("adminAcces"));
  const code = created.data.codesGeneres[0].code;
  const loaded = await body(s, { action: "loadAll", apiVersion: 3, token: code });
  assert.deepEqual(loaded.data.config.main, { smic: 13, cot: { salariale: 0.1 }, patr: { patronale: 0.2 }, chomage: 0.01 });
});


test("un membre ne peut pas désactiver son propre accès même si un autre administrateur existe", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: {
    membres: {
      membre_0001: { id: "membre_0001", nomComplet: "Admin A", _v: 1 },
      membre_0002: { id: "membre_0002", nomComplet: "Admin B", _v: 1 },
    },
  }, membre: "membre_0001" });
  s.props.TOKENS = JSON.stringify({
    membre_0001: { h: tokenHash(TOKEN), active: true, role: "Membre" },
    membre_0002: { h: tokenHash("autre-token-12345678901234567890"), active: true, role: "Membre" },
  });
  const result = await body(s, req("adminDesactiver", { membreId: "membre_0001" }));
  assert.equal(result.error.code, "SELF_DEACTIVATE");
  assert.equal((await body(s, req("ping"))).data.authentifie, true);
});


test("un salarié ne reçoit pas les montants globaux d'un BV partagé", async () => {
  const s = creerServeurAppsScriptSimule({ token: TOKEN, donnees: {
    membres: {
      membre_0001: { id: "membre_0001", nomComplet: "Alice", _v: 1 },
      membre_0002: { id: "membre_0002", nomComplet: "Bob", _v: 1 },
    },
    bvs: { bv_0000001: { id: "bv_0000001", reference: "BV commun", brut: 900, net: 700, _v: 1 } },
    lignesBV: {
      ligne_000001: { id: "ligne_000001", bvId: "bv_0000001", membreId: "membre_0001", jeh: 1, _v: 1 },
      ligne_000002: { id: "ligne_000002", bvId: "bv_0000001", membreId: "membre_0002", jeh: 2, _v: 1 },
    },
  } });
  const admin = await body(s, req("adminAcces"));
  const code = admin.data.codesGeneres.find(x => x.id === "membre_0001").code;
  const loaded = await body(s, { action: "loadAll", apiVersion: 3, token: code });
  assert.deepEqual(loaded.data.bvs.bv_0000001, { id: "bv_0000001", date: "", reference: "BV commun" });
  assert.equal(JSON.stringify(loaded.data).includes("700"), false);
  assert.equal(JSON.stringify(loaded.data).includes("900"), false);
});
