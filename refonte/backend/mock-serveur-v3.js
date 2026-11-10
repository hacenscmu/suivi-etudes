/**
 * Faux serveur API v3 en mémoire, réservé aux tests.
 * N'utilise aucun service Google, réseau, secret réel ou stockage durable.
 */
const COLLECTIONS_ECRITURE = new Set([
  "etudes", "clients", "membres", "factures", "interventions",
  "bvs", "lignesBV", "formation", "config", "appareils",
]);
const COLLECTIONS_LECTURE = [...COLLECTIONS_ECRITURE, "temps"];
const ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const OP_ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

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
    return null;
  }

  function validerRequeteMutation(request, action) {
    if (!COLLECTIONS_ECRITURE.has(request.collection)) {
      return { code: COLLECTIONS_LECTURE.includes(request.collection) ? "READ_ONLY_COLLECTION" : "UNKNOWN_COLLECTION", message: "Collection non modifiable ou inconnue" };
    }
    if (typeof request.id !== "string" || !ID_VALIDE.test(request.id)) {
      return { code: "INVALID_REQUEST", message: "Identifiant absent ou invalide" };
    }
    if (typeof request.opId !== "string" || !OP_ID_VALIDE.test(request.opId)) {
      return { code: "INVALID_REQUEST", message: "opId absent ou invalide" };
    }
    if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < (action === "delete" ? 1 : 0)) {
      return { code: "INVALID_REQUEST", message: "expectedVersion invalide" };
    }
    if (action === "save") {
      if (!objetSimple(request.record) || request.record.id !== request.id || request.record._deleted === true) {
        return { code: "INVALID_REQUEST", message: "Enregistrement invalide ou identifiant incohérent" };
      }
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
      return enveloppe(true, cloner(collections), null, { revision, schemaVersion: 3 });
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
    const response = enveloppe(true, cloner(prochain), null, { revision });
    operations.set(request.opId, { fingerprint, response: cloner(response) });
    return response;
  }

  return Object.freeze({ transport, lireDonnees: () => cloner(collections), lireRevision: () => revision });
}

module.exports = { creerServeurMemoireV3 };
