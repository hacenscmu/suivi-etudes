/**
 * File d'opérations hors ligne avec stockage injecté.
 *
 * Aucun localStorage/IndexedDB n'est imposé ici. Une opération n'est retirée
 * qu'après succès métier explicite ; réseau et conflits la conservent.
 */
const OP_ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;

class ErreurFile extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ErreurFile";
    this.code = code;
  }
}

function cloner(value) {
  return JSON.parse(JSON.stringify(value));
}

function signature(operation) {
  return JSON.stringify({
    type: operation.type,
    collection: operation.collection,
    id: operation.id,
    record: operation.record ?? null,
    opId: operation.opId,
    expectedVersion: operation.expectedVersion,
  });
}

function validerOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new ErreurFile("INVALID_OPERATION", "Opération hors ligne invalide");
  }
  if (!["save", "delete"].includes(operation.type)) {
    throw new ErreurFile("INVALID_OPERATION", "Type d'opération inconnu");
  }
  if (typeof operation.collection !== "string" || !operation.collection.trim()) {
    throw new ErreurFile("INVALID_OPERATION", "Collection absente");
  }
  if (operation.collection === "temps") {
    throw new ErreurFile("READ_ONLY_COLLECTION", "Les anciennes lignes temps sont en lecture seule ; utiliser interventions");
  }
  if (typeof operation.id !== "string" || !ID_VALIDE.test(operation.id)) {
    throw new ErreurFile("INVALID_OPERATION", "Identifiant absent ou invalide");
  }
  if (typeof operation.opId !== "string" || !OP_ID_VALIDE.test(operation.opId)) {
    throw new ErreurFile("INVALID_OPERATION", "opId stable absent ou invalide");
  }
  const minimum = operation.type === "delete" ? 1 : 0;
  if (!Number.isSafeInteger(operation.expectedVersion) || operation.expectedVersion < minimum) {
    throw new ErreurFile("INVALID_OPERATION", "Version attendue invalide");
  }
  if (operation.type === "save" &&
      (!operation.record || typeof operation.record !== "object" ||
       Array.isArray(operation.record) || operation.record.id !== operation.id)) {
    throw new ErreurFile("INVALID_OPERATION", "Enregistrement absent ou incohérent");
  }
}

function creerFileHorsLigne({ stockage, api } = {}) {
  if (!stockage || typeof stockage.lire !== "function" || typeof stockage.ecrire !== "function") {
    throw new TypeError("Un stockage asynchrone injecté (lire/ecrire) est obligatoire");
  }
  if (!api || typeof api.save !== "function" || typeof api.delete !== "function") {
    throw new TypeError("Un client API v3 est obligatoire");
  }

  async function lire() {
    const file = await stockage.lire();
    if (file == null) return [];
    if (!Array.isArray(file)) {
      throw new ErreurFile("CORRUPT_QUEUE", "La file persistée n'est pas un tableau ; aucune opération n'est supprimée");
    }
    return cloner(file);
  }

  async function ecrire(file) {
    await stockage.ecrire(cloner(file));
  }

  return Object.freeze({
    async inspecter() {
      return lire();
    },

    async ajouter(operation) {
      validerOperation(operation);
      const file = await lire();
      const existante = file.find(item => item.opId === operation.opId);
      if (existante) {
        if (signature(existante) !== signature(operation)) {
          throw new ErreurFile("DUPLICATE_OPERATION", "opId déjà présent avec un contenu différent");
        }
        return { ajoutee: false, dejaPresente: true, nombre: file.length };
      }
      file.push({ ...cloner(operation), etat: "en_attente", erreur: null });
      await ecrire(file);
      return { ajoutee: true, dejaPresente: false, nombre: file.length };
    },

    async synchroniser() {
      const file = await lire();
      let traitees = 0;
      let bloquePar = null;
      while (file.length) {
        const operation = file[0];
        if (operation.etat === "conflit") {
          bloquePar = { opId: operation.opId, code: "VERSION_CONFLICT" };
          break;
        }
        try {
          const args = {
            collection: operation.collection,
            id: operation.id,
            opId: operation.opId,
            expectedVersion: operation.expectedVersion,
          };
          if (operation.type === "save") {
            await api.save({ ...args, record: operation.record });
          } else {
            await api.delete(args);
          }
          file.shift();
          await ecrire(file);
          traitees += 1;
        } catch (error) {
          const code = typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR";
          operation.etat = code === "VERSION_CONFLICT" ? "conflit" : "en_attente";
          operation.erreur = { code, message: String(error?.message || "Échec de synchronisation") };
          await ecrire(file);
          bloquePar = { opId: operation.opId, code };
          break;
        }
      }
      return { traitees, restantes: file.length, bloquePar };
    },

    async remplacerApresConflit(opId, nouvelleOperation) {
      validerOperation(nouvelleOperation);
      const file = await lire();
      const index = file.findIndex(item => item.opId === opId);
      if (index < 0 || file[index].etat !== "conflit") {
        throw new ErreurFile("CONFLICT_NOT_FOUND", "Aucun conflit à résoudre pour cet opId");
      }
      if (nouvelleOperation.opId === opId || file.some((item, i) => i !== index && item.opId === nouvelleOperation.opId)) {
        throw new ErreurFile("DUPLICATE_OPERATION", "La résolution doit utiliser un nouvel opId");
      }
      file[index] = { ...cloner(nouvelleOperation), etat: "en_attente", erreur: null };
      await ecrire(file);
      return { resolu: true, nombre: file.length };
    },

    async abandonner(opId) {
      const file = await lire();
      const index = file.findIndex(item => item.opId === opId);
      if (index < 0) return { retiree: false, nombre: file.length };
      file.splice(index, 1);
      await ecrire(file);
      return { retiree: true, nombre: file.length };
    },
  });
}

module.exports = { ErreurFile, creerFileHorsLigne };
