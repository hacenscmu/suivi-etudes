/**
 * Faux serveur API v3 en mémoire, réservé aux tests.
 * N'utilise aucun service Google, réseau, secret réel ou stockage durable.
 */
const COLLECTIONS_ECRITURE = new Set([
  "etudes", "clients", "membres", "factures", "interventions",
  "bvs", "lignesBV", "formation", "config", "appareils",
]);
const COLLECTIONS_LECTURE = [...COLLECTIONS_ECRITURE, "temps", "signalementsJEH"];
const ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const OP_ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
function idValidePour(collection, id) { return collection === "config" ? id === "main" : typeof id === "string" && ID_VALIDE.test(id); }

function cloner(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function enveloppe(ok, data, error, meta, status = 200) {
  return {
    status,
    body: {
      ok,
      apiVersion: 3,
      ...(ok ? { data } : {}),
      meta: meta ?? null,
      error: error ?? null,
    },
  };
}

function creerServeurMemoireV3({
  token,
  donnees = {},
  maxBytes = 100_000,
  maintenant = () => "2026-11-10T00:00:00.000Z",
} = {}) {
  if (typeof token !== "string" || token.trim() === "") {
    throw new TypeError("Le serveur simulé exige un token non vide");
  }
  const collections = Object.fromEntries(COLLECTIONS_LECTURE.map(nom => [
    nom,
    objetSimple(donnees[nom]) ? cloner(donnees[nom]) : {},
  ]));
  const operations = new Map();
  let revision = 0;

  function objetSimple(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function erreur(code, message, status = 200, details = null) {
    return enveloppe(false, null, { code, message, ...(details ? { details } : {}) }, { revision }, status);
  }

  function relationValide(collection, record) {
    if (collection === "etudes" && record.clientId && !collections.clients[record.clientId]) {
      return "Client lié introuvable";
    }
    if (collection === "factures" && (!record.etudeId || !collections.etudes[record.etudeId] || collections.etudes[record.etudeId]._deleted)) {
      return "Étude liée introuvable";
    }
    if (collection === "interventions") {
      if (!collections.etudes[record.etudeId] || collections.etudes[record.etudeId]._deleted) return "Étude liée introuvable";
      if (!collections.membres[record.membreId] || collections.membres[record.membreId]._deleted) return "Membre lié introuvable";
    }
    if (collection === "lignesBV") {
      if (!collections.bvs[record.bvId] || collections.bvs[record.bvId]._deleted) return "BV parent introuvable";
      if (!collections.membres[record.membreId] || collections.membres[record.membreId]._deleted) return "Membre lié introuvable";
    }
    if (collection === "formation") {
      if (!collections.membres[record.membreId] || collections.membres[record.membreId]._deleted) return "Membre de formation introuvable";
      const autreGrille = Object.values(collections.formation).some(f =>
        f && f._deleted !== true && f.id !== record.id && f.membreId === record.membreId);
      if (autreGrille) return "Une grille Qualité formation existe déjà pour ce membre";
      for (const etudeId of Object.keys(record.niveaux || {})) {
        if (!collections.etudes[etudeId] || collections.etudes[etudeId]._deleted) return "Étude de formation introuvable";
      }
    }
    return null;
  }

  function dependance(collection, id) {
    const references = {
      clients: [["etudes", "clientId"]],
      etudes: [["factures", "etudeId"], ["interventions", "etudeId"]],
      membres: [["interventions", "membreId"], ["lignesBV", "membreId"], ["formation", "membreId"]],
      bvs: [["lignesBV", "bvId"]],
    }[collection] || [];
    for (const [nom, champ] of references) {
      if (Object.values(collections[nom]).some(record => record && record._deleted !== true && record[champ] === id)) {
        return "Suppression refusée : des fiches " + nom + " référencent encore cet élément";
      }
    }
    if (collection === "etudes" && Object.values(collections.formation).some(record =>
      record && record._deleted !== true && record.niveaux && Object.prototype.hasOwnProperty.call(record.niveaux, id))) {
      return "Suppression refusée : la grille Qualité formation référence encore cette étude";
    }
    return null;
  }

  function dateValide(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, mo, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  }
  function validerMetier(collection, record) {
    const present = value => typeof value === "string" && value.trim() !== "";
    const positif = value => typeof value === "number" && Number.isFinite(value) && value > 0;
    const nonNegatif = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (Object.keys(record).length > 100) return "Trop de champs dans la fiche";
    if (collection === "clients" && ![record.raisonSociale, record.nom, record.name].some(present)) return "Nom du client requis";
    if (collection === "membres" && ![record.nomComplet, record.nom, record.prenom].some(present)) return "Nom du membre requis";
    if (collection === "etudes") {
      if (!dateValide(record.date) || !present(record.num) || !present(record.statut) || !nonNegatif(record.montant)) return "Étude : date, numéro, statut ou montant invalide";
      if (!present(record.client) && !record.clientId) return "Étude : client ou clientId requis";
      if (record.clientId && (typeof record.clientId !== "string" || !ID_VALIDE.test(record.clientId))) return "Étude : clientId invalide";
      if (["Devis signé","Convention signée","Convention étudiant avant réalisation","En réalisation","Archivée"].includes(record.statut) && !positif(record.jeh)) return "Étude signée : prix unitaire JEH client HT positif requis";
    }
    if (collection === "factures") {
      if (typeof record.etudeId !== "string" || !ID_VALIDE.test(record.etudeId) || !present(record.type) || !present(record.etat) || !nonNegatif(record.montant)) return "Facture : étude, type, état ou montant invalide";
    }
    if (collection === "interventions") {
      if (typeof record.etudeId !== "string" || !ID_VALIDE.test(record.etudeId) ||
          typeof record.membreId !== "string" || !ID_VALIDE.test(record.membreId) ||
          !dateValide(record.date) || !["Payé","Pas payé","A venir","Non effectué"].includes(record.statut) ||
          !positif(record.minutesIndividuelles) ||
          (record.prixJehHt != null && !nonNegatif(record.prixJehHt))) return "Intervention : étude, membre, date, statut, durée ou prix invalide";
    }
    if (collection === "lignesBV") {
      if (typeof record.bvId !== "string" || !ID_VALIDE.test(record.bvId) ||
          typeof record.membreId !== "string" || !ID_VALIDE.test(record.membreId) ||
          !nonNegatif(record.jeh)) return "Ligne BV : BV, membre ou nombre de JEH invalide";
    }
    if (collection === "formation") {
      if (!present(record.nom)) return "Nom de formation requis";
      if (typeof record.membreId !== "string" || !ID_VALIDE.test(record.membreId)) return "Membre de formation invalide";
      if (!objetSimple(record.niveaux) || Object.keys(record.niveaux).length > 500) return "Grille de niveaux invalide";
      if (Object.entries(record.niveaux).some(([id, niveau]) =>
        !ID_VALIDE.test(id) || !Number.isInteger(niveau) || niveau < 0 || niveau > 4)) return "Niveau de formation invalide";
    }
    return null;
  }
  function validerRequeteMutation(request, action) {
    if (!COLLECTIONS_ECRITURE.has(request.collection)) {
      return { code: COLLECTIONS_LECTURE.includes(request.collection) ? "READ_ONLY_COLLECTION" : "UNKNOWN_COLLECTION", message: "Collection non modifiable ou inconnue" };
    }
    if (!idValidePour(request.collection, request.id)) {
      return { code: "INVALID_REQUEST", message: "Identifiant absent ou invalide" };
    }
    if (typeof request.opId !== "string" || !OP_ID_VALIDE.test(request.opId)) {
      return { code: "INVALID_REQUEST", message: "opId absent ou invalide" };
    }
    if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < (action === "delete" ? 1 : 0)) {
      return { code: "INVALID_REQUEST", message: "expectedVersion invalide" };
    }
    if (action === "delete" && request.collection === "config") return { code: "INVALID_REQUEST", message: "La configuration principale ne peut pas être supprimée" };
    if (action === "save") {
      if (!objetSimple(request.record) || request.record.id !== request.id || request.record._deleted === true) {
        return { code: "INVALID_REQUEST", message: "Enregistrement invalide ou identifiant incohérent" };
      }
      const erreurMetier = validerMetier(request.collection, request.record);
      if (erreurMetier) return { code: "INVALID_REQUEST", message: erreurMetier };
      const bytes = new TextEncoder().encode(JSON.stringify(request.record)).length;
      if (bytes > maxBytes) return { code: "PAYLOAD_TOO_LARGE", message: "Enregistrement trop volumineux" };
    }
    return null;
  }

  async function transport(request) {
    if (!objetSimple(request) || request.apiVersion !== 3) {
      return erreur("API_VERSION_MISMATCH", "Version d'API incompatible");
    }
    if (request.action === "ping") {
      return enveloppe(true, { apiVersion: 3, authentifie: typeof request.token === "string" && request.token === token }, null, { revision });
    }
    if (typeof request.token !== "string" || request.token.trim() === "") {
      return erreur("AUTH_REQUIRED", "Authentification requise", 401);
    }
    if (request.token !== token) return erreur("AUTH_INVALID", "Token invalide", 403);

    if (request.action === "loadAll") {
      const publicCollections = cloner(collections);
      for (const records of Object.values(publicCollections)) {
        for (const record of Object.values(records)) if (record && typeof record === "object") delete record._opId;
      }
      return enveloppe(true, publicCollections, null, { revision, schemaVersion: 3 });
    }

    if (request.action !== "save" && request.action !== "delete") {
      return erreur("INVALID_REQUEST", "Action inconnue");
    }
    const invalid = validerRequeteMutation(request, request.action);
    if (invalid) return erreur(invalid.code, invalid.message, 400);

    const fingerprint = stableStringify({
      action: request.action,
      collection: request.collection,
      id: request.id,
      record: request.action === "save" ? request.record : null,
      expectedVersion: request.expectedVersion,
    });
    const deja = operations.get(request.opId);
    if (deja) {
      if (deja.fingerprint !== fingerprint) {
        return erreur("DUPLICATE_OPERATION", "opId déjà utilisé avec un contenu différent", 409);
      }
      return cloner(deja.response);
    }

    const collection = collections[request.collection];
    const courant = collection[request.id];
    const versionCourante = courant?._v ?? 0;
    if (request.expectedVersion !== versionCourante || (request.action === "save" && courant?._deleted)) {
      return erreur("VERSION_CONFLICT", "La fiche a changé depuis sa dernière lecture", 409, {
        currentVersion: versionCourante,
      });
    }
    if (request.action === "delete" && (!courant || courant._deleted)) {
      return erreur("NOT_FOUND", "Fiche introuvable", 404);
    }

    if (request.action === "delete") {
      const dependanceActive = dependance(request.collection, request.id);
      if (dependanceActive) return erreur("INVALID_REQUEST", dependanceActive, 400);
    }

    let prochain;
    if (request.action === "save") {
      const relation = relationValide(request.collection, request.record);
      if (relation) return erreur("INVALID_REQUEST", relation, 400);
      prochain = {
        ...cloner(request.record),
        id: request.id,
        _v: versionCourante + 1,
        _par: "mock",
        _le: maintenant(),
        _opId: request.opId,
      };
    } else {
      prochain = {
        id: request.id,
        _deleted: true,
        _v: versionCourante + 1,
        _par: "mock",
        _le: maintenant(),
        _opId: request.opId,
      };
    }
    collection[request.id] = prochain;
    revision += 1;
    const publicRecord = cloner(prochain);
    delete publicRecord._opId;
    const response = enveloppe(true, publicRecord, null, { revision });
    operations.set(request.opId, { fingerprint, response: cloner(response) });
    return response;
  }

  return Object.freeze({ transport, lireDonnees: () => cloner(collections), lireRevision: () => revision });
}

module.exports = { creerServeurMemoireV3 };
