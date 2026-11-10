/**
 * Client backend HAC API v3.
 *
 * Transport injecté : aucune URL, aucun secret ni accès réseau n'est codé ici.
 * Le module valide le protocole et laisse au transport la responsabilité HTTP.
 */
const COLLECTIONS_ECRITURE = new Set([
  "etudes", "clients", "membres", "factures", "interventions",
  "bvs", "lignesBV", "formation", "config", "appareils",
]);
const COLLECTIONS_LECTURE = new Set([...COLLECTIONS_ECRITURE, "temps"]);
const COLLECTIONS_TABLEAUX = Object.freeze([
  "etudes", "clients", "membres", "factures", "interventions",
  "bvs", "lignesBV", "formation", "appareils",
]);
const ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const OP_ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

class ErreurApiV3 extends Error {
  constructor(code, message, { status = null, details = null, cause = null } = {}) {
    super(message || code, cause ? { cause } : undefined);
    this.name = "ErreurApiV3";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function objetSimple(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validerIdentifiant(id, label = "identifiant") {
  if (typeof id !== "string" || !ID_VALIDE.test(id)) {
    throw new ErreurApiV3("INVALID_REQUEST", label + " absent ou invalide");
  }
}
function validerIdentifiantCollection(id, collection, action) {
  if (collection === "config") {
    if (id !== "main") throw new ErreurApiV3("INVALID_REQUEST", "La collection config utilise uniquement l'identifiant main");
    if (action === "delete") throw new ErreurApiV3("INVALID_REQUEST", "La configuration principale ne peut pas être supprimée");
    return;
  }
  validerIdentifiant(id);
}

function validerOperation({ opId, expectedVersion }, { suppression = false } = {}) {
  if (typeof opId !== "string" || !OP_ID_VALIDE.test(opId)) {
    throw new ErreurApiV3("INVALID_REQUEST", "Un opId stable et valide est obligatoire");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < (suppression ? 1 : 0)) {
    throw new ErreurApiV3("INVALID_REQUEST", "expectedVersion doit être un entier valide");
  }
}

function lireEnveloppe(response) {
  const status = Number.isInteger(response?.status) ? response.status : 200;
  let body = response && Object.prototype.hasOwnProperty.call(response, "body")
    ? response.body
    : response;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch (cause) {
      throw new ErreurApiV3("INVALID_RESPONSE", "La réponse du serveur n'est pas un JSON valide", { status, cause });
    }
  }
  if (!objetSimple(body)) {
    throw new ErreurApiV3("INVALID_RESPONSE", "La réponse du serveur ne respecte pas l'enveloppe v3", { status });
  }
  if (body.apiVersion !== 3) {
    throw new ErreurApiV3("API_VERSION_MISMATCH", "Le serveur ne répond pas au contrat API v3", {
      status,
      details: { apiVersionRecue: body.apiVersion ?? null },
    });
  }
  if (body.ok !== true) {
    const code = typeof body.error?.code === "string" ? body.error.code : "API_ERROR";
    const message = typeof body.error?.message === "string" ? body.error.message : "L'opération a été refusée par le serveur";
    throw new ErreurApiV3(code, message, { status, details: body.error?.details ?? null });
  }
  if (!Object.prototype.hasOwnProperty.call(body, "data")) {
    throw new ErreurApiV3("INVALID_RESPONSE", "La réponse de succès ne contient pas data", { status });
  }
  return body;
}

function creerClientApiV3({ transport, obtenirToken } = {}) {
  if (typeof transport !== "function") {
    throw new TypeError("Un transport HTTP doit être injecté");
  }
  if (typeof obtenirToken !== "function") {
    throw new TypeError("Une fonction obtenirToken doit être injectée");
  }

  async function appeler(payload, { authentifie = true } = {}) {
    const token = authentifie ? obtenirToken() : null;
    if (authentifie && (typeof token !== "string" || token.trim() === "")) {
      throw new ErreurApiV3("AUTH_REQUIRED", "Authentification requise : aucun token fourni");
    }
    const requete = { ...payload, apiVersion: 3 };
    if (authentifie) requete.token = token;
    let response;
    try {
      response = await transport(requete);
    } catch (cause) {
      throw new ErreurApiV3("NETWORK_ERROR", "Le serveur est injoignable ; l'opération doit être conservée pour réessai", { cause });
    }
    return lireEnveloppe(response);
  }

  return Object.freeze({
    async ping() {
      const enveloppe = await appeler({ action: "ping" }, { authentifie: false });
      return enveloppe.data;
    },

    async loadAll() {
      const enveloppe = await appeler({ action: "loadAll" });
      if (!objetSimple(enveloppe.data)) {
        throw new ErreurApiV3("INVALID_RESPONSE", "loadAll doit renvoyer un objet de collections");
      }
      const collections = {};
      const tombstones = {};
      for (const nom of COLLECTIONS_TABLEAUX) {
        const raw = enveloppe.data[nom];
        if (!objetSimple(raw)) {
          throw new ErreurApiV3("INVALID_RESPONSE", "Collection absente ou mal formée : " + nom);
        }
        collections[nom] = [];
        tombstones[nom] = {};
        for (const [id, record] of Object.entries(raw)) {
          if (!objetSimple(record) || (record.id !== undefined && record.id !== id)) {
            throw new ErreurApiV3("INVALID_RESPONSE", "Enregistrement invalide dans " + nom + " : " + id);
          }
          if (record._deleted === true) {
            tombstones[nom][id] = Number.isSafeInteger(record._v) ? record._v : 0;
          } else {
            collections[nom].push({ ...record, id });
          }
        }
      }
      const legacyTemps = enveloppe.data.temps;
      if (!objetSimple(legacyTemps)) {
        throw new ErreurApiV3("INVALID_RESPONSE", "Collection historique temps absente ou mal formée");
      }
      const configRaw = enveloppe.data.config;
      if (!objetSimple(configRaw)) {
        throw new ErreurApiV3("INVALID_RESPONSE", "Collection config absente ou mal formée");
      }
      const configRecord = configRaw.main;
      if (configRecord && configRecord._deleted === true) tombstones.config = { main: configRecord._v ?? 0 };
      return {
        collections,
        config: configRecord && configRecord._deleted !== true ? configRecord : null,
        tombstones,
        legacyTemps,
        meta: enveloppe.meta ?? null,
      };
    },

    async save({ collection, id, record, opId, expectedVersion } = {}) {
      if (!COLLECTIONS_LECTURE.has(collection)) {
        throw new ErreurApiV3("UNKNOWN_COLLECTION", "Collection inconnue : " + String(collection));
      }
      if (collection === "temps" || !COLLECTIONS_ECRITURE.has(collection)) {
        throw new ErreurApiV3("READ_ONLY_COLLECTION", "La collection historique temps est en lecture seule ; utiliser interventions");
      }
      validerIdentifiantCollection(id, collection, "save");
      if (!objetSimple(record) || record.id !== id) {
        throw new ErreurApiV3("INVALID_REQUEST", "record doit être un objet dont id correspond à id");
      }
      validerOperation({ opId, expectedVersion });
      const recordSecurise = { ...record };
      delete recordSecurise._v;
      delete recordSecurise._par;
      delete recordSecurise._le;
      const enveloppe = await appeler({
        action: "save",
        collection,
        id,
        record: recordSecurise,
        opId,
        expectedVersion,
      });
      return { data: enveloppe.data, meta: enveloppe.meta ?? null };
    },

    async delete({ collection, id, opId, expectedVersion } = {}) {
      if (!COLLECTIONS_LECTURE.has(collection)) {
        throw new ErreurApiV3("UNKNOWN_COLLECTION", "Collection inconnue : " + String(collection));
      }
      if (collection === "temps" || !COLLECTIONS_ECRITURE.has(collection)) {
        throw new ErreurApiV3("READ_ONLY_COLLECTION", "La collection historique temps est en lecture seule ; utiliser interventions");
      }
      validerIdentifiantCollection(id, collection, "delete");
      validerOperation({ opId, expectedVersion }, { suppression: true });
      const enveloppe = await appeler({ action: "delete", collection, id, opId, expectedVersion });
      return { data: enveloppe.data, meta: enveloppe.meta ?? null };
    },
  });
}

module.exports = {
  COLLECTIONS_ECRITURE,
  COLLECTIONS_TABLEAUX,
  ErreurApiV3,
  lireEnveloppe,
  creerClientApiV3,
};
