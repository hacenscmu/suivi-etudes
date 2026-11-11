/* Généré par refonte/build/build-browser.mjs — ne pas modifier à la main. */
(function (global) {
  "use strict";
  const definitions = {
    "domain/identites.js": function(require, module, exports) {
    /**
     * HAC refonte — identités et liens entre objets métier.
     *
     * Les identifiants sont attribués à la création/import contrôlé, puis conservés.
     * Ce module ne fabrique pas d'identifiant à partir d'un prénom, d'un numéro
     * d'étude ou d'un nom de client : ces valeurs ne sont pas nécessairement uniques.
     *
     * Pendant la migration, une référence historique textuelle n'est résolue que
     * si elle correspond à un seul objet. Une correspondance ambiguë est bloquée.
     */
    
    const COLLECTIONS = new Set([
      "clients",
      "membres",
      "etudes",
      "factures",
      "interventions",
      "bvs",
      "lignesBV",
    ]);
    
    const RELATIONS = Object.freeze({
      etude: { collection: "etudes", parent: "clientId" },
      facture: { collection: "factures", parent: "etudeId" },
      intervention: { collection: "interventions", parents: ["etudeId", "membreId"] },
      bv: { collection: "bvs", parent: null },
      ligneBV: { collection: "lignesBV", parent: "bvId" },
    });
    
    function estIdValide(id) {
      return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id);
    }
    
    function validerIdentite(objet, collection) {
      if (!COLLECTIONS.has(collection)) {
        return { valide: false, anomalie: "Collection inconnue" };
      }
      if (!objet || typeof objet !== "object" || Array.isArray(objet)) {
        return { valide: false, anomalie: "Objet invalide" };
      }
      if (!estIdValide(objet.id)) {
        return { valide: false, anomalie: "Identifiant stable absent ou invalide" };
      }
      return { valide: true, anomalie: null };
    }
    
    function verifierUniciteIdentifiants(objets = [], collection) {
      if (!COLLECTIONS.has(collection)) {
        return { valide: false, doublons: [], anomalie: "Collection inconnue" };
      }
      if (!Array.isArray(objets)) {
        return { valide: false, doublons: [], anomalie: "La collection doit être un tableau" };
      }
    
      const vus = new Set();
      const doublons = [];
      objets.forEach((objet, index) => {
        const id = objet?.id;
        if (!estIdValide(id)) return;
        if (vus.has(id)) doublons.push({ index, id });
        vus.add(id);
      });
    
      return { valide: doublons.length === 0, doublons, anomalie: null };
    }
    
    function resoudreReferenceHistorique(valeur, objets, champ) {
      if (typeof valeur !== "string" || valeur.trim() === "") {
        return { statut: "absente", objet: null, candidats: [] };
      }
      if (!Array.isArray(objets) || typeof champ !== "string" || champ.trim() === "") {
        return { statut: "donnees_invalides", objet: null, candidats: [] };
      }
    
      const candidats = objets.filter(objet => objet && objet[champ] === valeur);
      if (candidats.length === 0) return { statut: "introuvable", objet: null, candidats: [] };
      if (candidats.length > 1) return { statut: "ambiguë", objet: null, candidats };
      if (!estIdValide(candidats[0].id)) {
        return { statut: "identifiant_manquant", objet: null, candidats };
      }
      return { statut: "resolue", objet: candidats[0], candidats };
    }
    
    function validerLiensMetier({ etudes = [], factures = [], interventions = [], membres = [], bvs = [], lignesBV = [] } = {}) {
      const anomalies = [];
      const idsEtudes = new Set(etudes.filter(e => estIdValide(e?.id)).map(e => e.id));
      const idsBVs = new Set(bvs.filter(b => estIdValide(b?.id)).map(b => b.id));
      const idsMembres = new Set(membres.filter(m => estIdValide(m?.id)).map(m => m.id));
    
      factures.forEach((facture, index) => {
        if (!estIdValide(facture?.etudeId)) {
          anomalies.push({ collection: "factures", index, raison: "etudeId absent ou invalide" });
        } else if (!idsEtudes.has(facture.etudeId)) {
          anomalies.push({ collection: "factures", index, raison: "Étude liée introuvable" });
        }
      });
    
      interventions.forEach((intervention, index) => {
        if (!estIdValide(intervention?.etudeId) || !idsEtudes.has(intervention.etudeId)) {
          anomalies.push({ collection: "interventions", index, raison: "Étude liée introuvable" });
        }
        if (!estIdValide(intervention?.membreId) || !idsMembres.has(intervention.membreId)) {
          anomalies.push({ collection: "interventions", index, raison: "Membre lié introuvable" });
        }
      });
    
      lignesBV.forEach((ligne, index) => {
        if (!estIdValide(ligne?.bvId)) {
          anomalies.push({ collection: "lignesBV", index, raison: "bvId absent ou invalide" });
        } else if (!idsBVs.has(ligne.bvId)) {
          anomalies.push({ collection: "lignesBV", index, raison: "BV lié introuvable" });
        }
        if (!estIdValide(ligne?.membreId)) {
          anomalies.push({ collection: "lignesBV", index, raison: "membreId absent ou invalide" });
        }
      });
    
      return { valide: anomalies.length === 0, anomalies };
    }
    
    module.exports = {
      COLLECTIONS,
      RELATIONS,
      estIdValide,
      validerIdentite,
      verifierUniciteIdentifiants,
      resoudreReferenceHistorique,
      validerLiensMetier,
    };
    
    },
    "domain/factures.js": function(require, module, exports) {
    /**
     * HAC refonte — calculs financiers indépendants de l'interface.
     *
     * Ne déduit jamais qu'une facture est payée à partir de l'absence d'état.
     * La compatibilité historique doit être explicite (legacy=true) et traitée
     * lors d'une migration contrôlée, pas dans les calculs métier courants.
     */
    
    const ETATS_FACTURE = new Set(["Émise", "Payée"]);
    
    function analyserFacture(facture, { legacy = false } = {}) {
      if (!facture || typeof facture !== "object") {
        return { etat: "invalide", payee: false, anomalie: "Facture invalide" };
      }
    
      let etat = facture.etat;
      if ((etat === undefined || etat === null || etat === "") && legacy) {
        // Les anciennes lignes sans état représentaient des encaissements.
        etat = "Payée";
      }
    
      if (!ETATS_FACTURE.has(etat)) {
        return {
          etat: "inconnu",
          payee: false,
          anomalie: "État de facture absent ou inconnu",
        };
      }
    
      return { etat, payee: etat === "Payée", anomalie: null };
    }
    
    function calculerSituationEtude(factures = [], options = {}) {
      if (!Array.isArray(factures)) {
        return {
          situation: "anomalie",
          nombreFactures: 0,
          nombrePayees: 0,
          montantTotal: 0,
          montantEncaisse: 0,
          resteAEncaisser: null,
          anomalies: ["La liste des factures est invalide"],
        };
      }
    
      if (factures.length === 0) {
        return {
          situation: "sans_facture",
          nombreFactures: 0,
          nombrePayees: 0,
          montantTotal: 0,
          montantEncaisse: 0,
          resteAEncaisser: 0,
          anomalies: [],
        };
      }
    
      let montantTotal = 0;
      let montantEncaisse = 0;
      let nombrePayees = 0;
      const anomalies = [];
    
      factures.forEach((facture, index) => {
        const analyse = analyserFacture(facture, options);
        if (analyse.anomalie) anomalies.push({ index, raison: analyse.anomalie });
    
        const montant = Number(facture?.montant);
        if (facture?.montant === "" || facture?.montant == null || !Number.isFinite(montant) || montant < 0) {
          anomalies.push({ index, raison: "Montant absent ou invalide" });
        } else {
          montantTotal += montant;
          if (analyse.payee) montantEncaisse += montant;
        }
    
        if (analyse.payee) nombrePayees += 1;
      });
    
      const etatsConnus = anomalies.length === 0;
      let situation;
      if (!etatsConnus) situation = "anomalie";
      else if (nombrePayees === factures.length) situation = "integralement_encaissee";
      else if (nombrePayees === 0) situation = "aucun_encaissement";
      else situation = "partiellement_encaissee";
    
      return {
        situation,
        nombreFactures: factures.length,
        nombrePayees,
        montantTotal,
        montantEncaisse,
        resteAEncaisser: anomalies.some(a => a.raison === "Montant absent ou invalide")
          ? null
          : montantTotal - montantEncaisse,
        anomalies,
      };
    }
    
    module.exports = { analyserFacture, calculerSituationEtude, ETATS_FACTURE };
    
    },
    "domain/etudes.js": function(require, module, exports) {
    /**
     * HAC refonte — analyse d'une étude.
     *
     * Compatibilité historique : le champ « jeh » de l'étude contient le
     * PRIX UNITAIRE HT de la JEH client, et non un nombre de JEH.
     * Le nombre de JEH facturées est donc montant HT / prix unitaire HT.
     * Les montants d'étude historiques sont TTC.
     */
    const STATUTS_ETUDE = Object.freeze([
      "Faisabilité",
      "Devis envoyé",
      "Devis signé",
      "Convention envoyée",
      "Convention signée",
      "Convention étudiant avant réalisation",
      "En réalisation",
      "Archivée",
      "Refusé / sans suite",
    ]);
    
    const STATUTS_CA_SIGNE = new Set([
      "Devis signé",
      "Convention signée",
      "Convention étudiant avant réalisation",
      "En réalisation",
      "Archivée",
    ]);
    
    function dateValide(value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const [y, m, d] = value.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }
    
    function nombreValide(value, { zero = true } = {}) {
      if (value === "" || value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) && (zero ? n >= 0 : n > 0) ? n : null;
    }
    
    function analyserEtude(etude, {
      factures = [],
      tva = 0.2,
      // Fourchette CNJE du prix de la JEH CLIENT (app.js v11 l. 34 et 166 : 80–450 € HT).
      // Le plafond de 300 € concerne la JEH versée à l'INTERVENANT (lignes JEH), pas ce prix-ci.
      prixJehMinHt = 80,
      prixJehMaxHt = 450,
    } = {}) {
      const anomalies = [];
      const alertes = [];
      if (!etude || typeof etude !== "object" || Array.isArray(etude)) {
        return { valide: false, anomalies: ["Étude invalide"], alertes: [] };
      }
      if (!Array.isArray(factures)) {
        return { valide: false, anomalies: ["La liste des factures est invalide"], alertes: [] };
      }
      if (!STATUTS_ETUDE.includes(etude.statut)) {
        anomalies.push("Statut d'étude absent ou inconnu");
      }
      if (typeof etude.id !== "string" || !etude.id.trim()) anomalies.push("Identifiant stable manquant");
      if (typeof etude.client !== "string" || !etude.client.trim()) anomalies.push("Client manquant");
      if (typeof etude.num !== "string" || !etude.num.trim()) anomalies.push("Numéro d'étude manquant");
      if (!dateValide(etude.date)) anomalies.push("Date de création absente ou invalide");
    
      const montantTtc = nombreValide(etude.montant);
      const prixJehHt = nombreValide(etude.jeh, { zero: false });
      const tauxTva = nombreValide(tva);
      if (montantTtc === null) anomalies.push("Montant TTC absent ou invalide");
      if (tauxTva === null || tauxTva > 1) anomalies.push("Taux de TVA invalide");
      if (STATUTS_CA_SIGNE.has(etude.statut) && prixJehHt === null) {
        anomalies.push("Prix unitaire HT de la JEH client absent ou invalide");
      }
    
      const liees = factures.filter(f => f && f.etudeId === etude.id);
      const situation = require("./factures").calculerSituationEtude(liees);
      if (situation.anomalies.length) anomalies.push(...situation.anomalies.map(a => "Facture : " + (a.raison || a)));
      if (montantTtc !== null && situation.montantTotal > montantTtc + 0.005) {
        alertes.push("Le total facturé dépasse le montant TTC de l'étude");
      }
      if (etude.statut === "Archivée" && situation.situation !== "integralement_encaissee" && situation.situation !== "sans_facture") {
        alertes.push("Étude archivée alors que toutes les factures ne sont pas encaissées");
      }
      if (etude.statut === "Refusé / sans suite" && liees.length) {
        alertes.push("Étude refusée mais déjà facturée");
      }
    
      const montantHt = montantTtc !== null && tauxTva !== null ? montantTtc / (1 + tauxTva) : null;
      const fraisHt = nombreValide(etude.frais) ?? 0;
      const baseJehHt = montantHt !== null ? Math.max(0, montantHt - fraisHt) : null;
      const nombreJehFacturees = baseJehHt !== null && prixJehHt !== null ? baseJehHt / prixJehHt : null;
      if (prixJehHt !== null && ((prixJehMinHt !== null && prixJehHt < prixJehMinHt) || (prixJehMaxHt !== null && prixJehHt > prixJehMaxHt))) {
        alertes.push("Prix de la JEH client (" + prixJehHt + " € HT) hors de la fourchette CNJE " + prixJehMinHt + "–" + prixJehMaxHt + " € HT");
      }
    
      return {
        valide: anomalies.length === 0,
        anomalies,
        alertes,
        caSigneHt: STATUTS_CA_SIGNE.has(etude.statut) ? montantHt : 0,
        montantHt,
        prixJehHt,
        nombreJehFacturees,
        situationFactures: situation,
      };
    }
    
    module.exports = { STATUTS_ETUDE, STATUTS_CA_SIGNE, analyserEtude, dateValide };
    
    },
    "backend/client-api-v3.js": function(require, module, exports) {
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
    const COLLECTIONS_LECTURE = new Set([...COLLECTIONS_ECRITURE, "temps", "signalementsJEH"]);
    const COLLECTIONS_TABLEAUX = Object.freeze([
      "etudes", "clients", "membres", "factures", "interventions",
      "bvs", "lignesBV", "formation", "appareils", "signalementsJEH",
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
    
        async session() {
          const enveloppe = await appeler({ action: "ping" });
          return enveloppe.data;
        },
    
        async adminAcces() {
          return (await appeler({ action: "adminAcces" })).data;
        },
    
        async definirRole({ membreId, role } = {}) {
          if (typeof membreId !== "string" || !ID_VALIDE.test(membreId) || !["Membre", "Salarie"].includes(role)) {
            throw new ErreurApiV3("INVALID_REQUEST", "Membre ou rôle invalide");
          }
          return (await appeler({ action: "adminDefinirRole", membreId, role })).data;
        },
    
        async regenererCode({ membreId } = {}) {
          if (typeof membreId !== "string" || !ID_VALIDE.test(membreId)) throw new ErreurApiV3("INVALID_REQUEST", "Membre invalide");
          return (await appeler({ action: "adminRegenererCode", membreId })).data;
        },
    
        async desactiverAcces({ membreId } = {}) {
          if (typeof membreId !== "string" || !ID_VALIDE.test(membreId)) throw new ErreurApiV3("INVALID_REQUEST", "Membre invalide");
          return (await appeler({ action: "adminDesactiver", membreId })).data;
        },
    
        async reactiverAcces({ membreId } = {}) {
          if (typeof membreId !== "string" || !ID_VALIDE.test(membreId)) throw new ErreurApiV3("INVALID_REQUEST", "Membre invalide");
          return (await appeler({ action: "adminReactiver", membreId })).data;
        },
    
        async changerMonCode() {
          return (await appeler({ action: "changerMonCode" })).data;
        },
    
        async signalerJEH({ numEtude, date, duree, nb, commentaire = "" } = {}) {
          return (await appeler({ action: "signalerJEH", numEtude, date, duree, nb, commentaire })).data;
        },
    
        async traiterSignalementJEH({ signalementId, decision } = {}) {
          return (await appeler({ action: "traiterSignalementJEH", signalementId, decision })).data;
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
    
    },
    "backend/file-hors-ligne.js": function(require, module, exports) {
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
      if (typeof operation.id !== "string" || (operation.collection === "config" ? operation.id !== "main" : !ID_VALIDE.test(operation.id))) {
        throw new ErreurFile("INVALID_OPERATION", "Identifiant absent ou invalide");
      }
      if (typeof operation.opId !== "string" || !OP_ID_VALIDE.test(operation.opId)) {
        throw new ErreurFile("INVALID_OPERATION", "opId stable absent ou invalide");
      }
      if (operation.collection === "config" && operation.type === "delete") throw new ErreurFile("READ_ONLY_COLLECTION", "La configuration principale ne peut pas être supprimée");
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
    
      async function remplacerIncident_(opId, nouvelleOperation, etatAttendu) {
        validerOperation(nouvelleOperation);
        const file = await lire();
        const index = file.findIndex(item => item.opId === opId);
        if (index < 0 || file[index].etat !== etatAttendu) {
          throw new ErreurFile("INCIDENT_NOT_FOUND", "Aucun incident de ce type à résoudre pour cet opId");
        }
        if (nouvelleOperation.opId === opId || file.some((item, i) => i !== index && item.opId === nouvelleOperation.opId)) {
          throw new ErreurFile("DUPLICATE_OPERATION", "La résolution doit utiliser un nouvel opId");
        }
        file[index] = { ...cloner(nouvelleOperation), etat: "en_attente", erreur: null };
        await ecrire(file);
        return { resolu: true, nombre: file.length };
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
            if (operation.etat === "conflit" || operation.etat === "incident") {
              bloquePar = { opId: operation.opId, code: operation.etat === "conflit" ? "VERSION_CONFLICT" : "OP_INTERRUPTED" };
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
              operation.etat = code === "VERSION_CONFLICT" ? "conflit" : code === "OP_INTERRUPTED" ? "incident" : "en_attente";
              operation.erreur = { code, message: String(error?.message || "Échec de synchronisation") };
              await ecrire(file);
              bloquePar = { opId: operation.opId, code };
              break;
            }
          }
          return { traitees, restantes: file.length, bloquePar };
        },
    
        async remplacerApresConflit(opId, nouvelleOperation) {
          return remplacerIncident_(opId, nouvelleOperation, "conflit");
        },
    
        async remplacerApresIncident(opId, nouvelleOperation) {
          return remplacerIncident_(opId, nouvelleOperation, "incident");
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
    
    },
    "backend/mock-serveur-v3.js": function(require, module, exports) {
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
    
    },
    "app/synchro.js": function(require, module, exports) {
    /**
     * HAC — synchronisation de l'application avec le serveur v3.
     *
     * Relie la couche application (état en mémoire, commandes) au client API v3 et à la file hors ligne :
     *  - démarrage : on envoie d'abord ce qui attend dans la file, puis on recharge depuis le serveur ;
     *    sans réseau, on repart du dernier état connu (cache local, qui inclut les modifications en attente) ;
     *  - chaque modification est appliquée tout de suite à l'écran (optimiste), mise en file avec un opId
     *    stable et la version attendue, puis envoyée ;
     *  - la version locale est avancée de 1 à la mise en file (le serveur incrémente de 1), pour que deux
     *    modifications successives hors ligne de la même fiche ne se contredisent pas ;
     *  - un conflit n'est jamais résolu en silence : la file s'arrête et l'interface demande quoi faire.
     * Aucune dépendance au navigateur : stockage, client et générateur d'opId sont injectés (testable dans Node).
     */
    const { creerEtatVide, construireVueApplication } = require("../application/lecture");
    const { creerFileHorsLigne } = require("../backend/file-hors-ligne");
    
    const CHAMPS_SERVEUR = ["_v", "_par", "_le", "_opId", "_deleted"];
    const sansChampsServeur = r => { const o = { ...r }; CHAMPS_SERVEUR.forEach(f => delete o[f]); return o; };
    
    function creerSynchro({ client, stockage, creerOpId }) {
      if (!client || !stockage || typeof creerOpId !== "function") throw new TypeError("client, stockage et creerOpId sont obligatoires");
      const file = creerFileHorsLigne({
        stockage: { lire: async () => (await stockage.lire("file")) ?? [], ecrire: v => stockage.ecrire("file", v) },
        api: client,
      });
      let etat = creerEtatVide(), config = null, source = "vide", dernierBlocage = null;
    
      const memoriser = () => stockage.ecrire("cache", { etat, config, le: new Date().toISOString() });
    
      async function chargerServeur() {
        const r = await client.loadAll();
        etat = { ...creerEtatVide(), ...r.collections };
        config = r.config;
        source = "serveur";
        await memoriser();
      }
      async function chargerCache() {
        const c = await stockage.lire("cache");
        if (c && c.etat) { etat = { ...creerEtatVide(), ...c.etat }; config = c.config ?? null; source = "cache"; return true; }
        return false;
      }
    
      async function synchroniser() {
        const r = await file.synchroniser();
        dernierBlocage = r.bloquePar;
        // On ne recharge depuis le serveur que si plus rien n'attend : sinon on perdrait l'affichage des modifications locales.
        if (r.restantes === 0) {
          try { await chargerServeur(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; }
        }
        return r;
      }
    
      return Object.freeze({
        lireEtat: () => etat,
        lireConfig: () => config,
        session: () => client.session(),
        adminAcces: () => client.adminAcces(),
        definirRole: options => client.definirRole(options),
        regenererCode: options => client.regenererCode(options),
        desactiverAcces: options => client.desactiverAcces(options),
        reactiverAcces: options => client.reactiverAcces(options),
        changerMonCode: () => client.changerMonCode(),
        signalerJEH: options => client.signalerJEH(options),
        traiterSignalementJEH: options => client.traiterSignalementJEH(options),
        statut: async () => ({ source, enAttente: (await file.inspecter()).length, blocage: dernierBlocage }),
    
        async demarrer() {
          await chargerCache();
          try {
            const r = await synchroniser();
            if (r.restantes === 0 && source !== "serveur") await chargerServeur();
          } catch (e) {
            if (e?.code !== "NETWORK_ERROR") throw e;
            if (source === "vide") throw e; // ni réseau ni cache : rien à afficher
          }
          return this.statut();
        },
    
        /** Applique une commande (preparerAjout / preparerModification) puis l'envoie au serveur. */
        async executer(commande) {
          return this.executerPlusieurs([commande]);
        },
    
        /**
         * Suppression logique optimiste. La vue métier est validée avant mise en file :
         * une fiche encore référencée (client, étude, membre, BV) ne peut donc pas disparaître.
         */
        async supprimer(collection, id) {
          if (collection === "config" || !Array.isArray(etat[collection])) {
            return { valide: false, anomalies: ["Collection non supprimable ou inconnue"] };
          }
          const fiche = etat[collection].find(x => x.id === id);
          if (!fiche) return { valide: false, anomalies: ["Fiche introuvable"] };
          const attendue = Number.isSafeInteger(fiche._v) ? fiche._v : 0;
          const suivant = { ...etat, [collection]: etat[collection].filter(x => x.id !== id) };
          const verif = construireVueApplication(suivant);
          if (!verif.valide) return { valide: false, anomalies: verif.anomalies };
          // Les fiches historiques ont une version 0 : les versionner avant leur tombstone.
          if (attendue === 0) {
            await file.ajouter({
              type: "save", collection, id, record: sansChampsServeur(fiche),
              opId: creerOpId(), expectedVersion: 0,
            });
          }
          await file.ajouter({
            type: "delete", collection, id, opId: creerOpId(), expectedVersion: attendue === 0 ? 1 : attendue,
          });
          etat = suivant;
          await memoriser();
          let envoi;
          try { envoi = await synchroniser(); }
          catch (e) {
            if (e?.code !== "NETWORK_ERROR") throw e;
            envoi = { restantes: (await file.inspecter()).length };
          }
          return { valide: true, envoi };
        },
    
        /**
         * Applique plusieurs commandes comme un tout (ex. un BV et sa ligne) : l'état final est validé une seule fois,
         * puis les écritures partent dans l'ordre (le parent avant l'enfant, comme l'exige le serveur).
         */
        async executerPlusieurs(commandes) {
          let suivant = etat;
          for (const c of commandes) {
            const col = c?.collection;
            if (!Array.isArray(suivant[col])) return { valide: false, anomalies: ["Collection inconnue"] };
            if (c.type === "ajouter") {
              if (!c.enregistrement || c.enregistrement.id !== c.id || suivant[col].some(x => x.id === c.id)) return { valide: false, anomalies: ["Ajout invalide"] };
              suivant = { ...suivant, [col]: [...suivant[col], { ...c.enregistrement }] };
            } else if (c.type === "modifier") {
              if (!suivant[col].some(x => x.id === c.id) || !c.modifications || "id" in c.modifications) return { valide: false, anomalies: ["Modification invalide"] };
              suivant = { ...suivant, [col]: suivant[col].map(x => (x.id === c.id ? { ...x, ...c.modifications } : x)) };
            } else return { valide: false, anomalies: ["Type de commande non pris en charge"] };
          }
          const verif = construireVueApplication(suivant);
          if (!verif.valide) return { valide: false, anomalies: verif.anomalies };
          for (const c of commandes) {
            const col = c.collection, id = c.id;
            const fiche = suivant[col].find(x => x.id === id);
            const attendue = Number.isSafeInteger(fiche?._v) ? fiche._v : 0;
            await file.ajouter({ type: "save", collection: col, id, record: sansChampsServeur(fiche), opId: creerOpId(), expectedVersion: attendue });
            suivant = { ...suivant, [col]: suivant[col].map(x => (x.id === id ? { ...x, _v: attendue + 1 } : x)) };
          }
          etat = suivant;
          await memoriser();
          let envoi;
          try { envoi = await synchroniser(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; envoi = { restantes: (await file.inspecter()).length }; }
          return { valide: true, envoi };
        },
    
        synchroniser,
    
        /** Enregistre la fiche unique de réglages (config/main), versionnée comme les autres fiches. */
        async enregistrerConfig(nouvelle) {
          if (!nouvelle || typeof nouvelle !== "object" || Array.isArray(nouvelle)) return { valide: false, anomalies: ["Réglages invalides"] };
          const attendue = Number.isSafeInteger(config?._v) ? config._v : 0;
          const record = { ...sansChampsServeur(nouvelle), id: "main" };
          await file.ajouter({ type: "save", collection: "config", id: "main", record, opId: creerOpId(), expectedVersion: attendue });
          config = { ...record, _v: attendue + 1 };
          await memoriser();
          let envoi;
          try { envoi = await synchroniser(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; envoi = { restantes: (await file.inspecter()).length }; }
          return { valide: true, envoi };
        },
    
        /** Conflit : abandonner les modifications en attente et repartir de la version du serveur. */
        async abandonnerEtRecharger() {
          for (const op of await file.inspecter()) await file.abandonner(op.opId);
          dernierBlocage = null;
          await chargerServeur();
        },
      });
    }
    
    /** Stockage navigateur (localStorage), protégé contre les erreurs (navigation privée, quota). */
    function stockageNavigateur(prefixe = "hac.v3.") {
      return {
        async lire(cle) { try { const v = globalThis.localStorage.getItem(prefixe + cle); return v ? JSON.parse(v) : null; } catch { return null; } },
        async ecrire(cle, valeur) { globalThis.localStorage.setItem(prefixe + cle, JSON.stringify(valeur)); },
      };
    }
    
    /** Transport fetch vers l'application Web Apps Script (text/plain : évite la requête préliminaire CORS). */
    function transportFetch(url) {
      return async requete => {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(requete), redirect: "follow" });
        return { status: r.status, body: await r.text() };
      };
    }
    
    async function prefixeStockageUtilisateur(token, cryptoApi = globalThis.crypto) {
      if (typeof token !== "string" || !token.trim()) throw new TypeError("Un jeton est nécessaire pour isoler le stockage local");
      if (!cryptoApi?.subtle?.digest || typeof TextEncoder !== "function") throw new Error("Web Crypto est nécessaire pour isoler le stockage local par compte");
      const empreinte = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const hex = Array.from(new Uint8Array(empreinte), b => b.toString(16).padStart(2, "0")).join("");
      return "hac.v3.user." + hex + ".";
    }
    
    module.exports = { creerSynchro, stockageNavigateur, transportFetch, prefixeStockageUtilisateur };
    
    }
  };
  const cache = Object.create(null);

  function resoudre(parent, demande) {
    const segments = demande.startsWith(".")
      ? parent.split("/").slice(0, -1).concat(demande.split("/"))
      : demande.split("/");
    const normalises = [];
    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") normalises.pop();
      else normalises.push(segment);
    }
    let id = normalises.join("/");
    if (!id.endsWith(".js")) id += ".js";
    if (!Object.prototype.hasOwnProperty.call(definitions, id)) {
      throw new Error("Module HAC introuvable : " + id);
    }
    return id;
  }

  function charger(id) {
    if (cache[id]) return cache[id].exports;
    const module = { exports: {} };
    cache[id] = module;
    definitions[id](
      demande => charger(resoudre(id, demande)),
      module,
      module.exports
    );
    return module.exports;
  }

  global.HAC = Object.freeze({
    ...charger("application/lecture.js"),
    ...charger("application/commandes.js"),
    ...charger("domain/clients.js"),
    ...charger("domain/alertes.js"),
    ...charger("domain/paie.js"),
    ...charger("backend/client-api-v3.js"),
    ...charger("backend/mock-serveur-v3.js"),
    ...charger("app/synchro.js")
  });
})(globalThis);
