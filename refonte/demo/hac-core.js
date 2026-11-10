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
      "bvs",
      "lignesBV",
    ]);
    
    const RELATIONS = Object.freeze({
      etude: { collection: "etudes", parent: "clientId" },
      facture: { collection: "factures", parent: "etudeId" },
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
    
    function validerLiensMetier({ etudes = [], factures = [], bvs = [], lignesBV = [] } = {}) {
      const anomalies = [];
      const idsEtudes = new Set(etudes.filter(e => estIdValide(e?.id)).map(e => e.id));
      const idsBVs = new Set(bvs.filter(b => estIdValide(b?.id)).map(b => b.id));
    
      factures.forEach((facture, index) => {
        if (!estIdValide(facture?.etudeId)) {
          anomalies.push({ collection: "factures", index, raison: "etudeId absent ou invalide" });
        } else if (!idsEtudes.has(facture.etudeId)) {
          anomalies.push({ collection: "factures", index, raison: "Étude liée introuvable" });
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
      plafondJehHt = 300,
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
      const nombreJehFacturees = montantHt !== null && prixJehHt !== null ? montantHt / prixJehHt : null;
      if (prixJehHt !== null && plafondJehHt !== null && prixJehHt > plafondJehHt) {
        alertes.push("Prix de JEH supérieur au plafond HAC de " + plafondJehHt + " € HT");
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
    "domain/interventions.js": function(require, module, exports) {
    /**
     * HAC refonte — interventions individuelles.
     *
     * Le nouveau modèle enregistre explicitement les minutes attribuées à
     * chaque membre. Il ne devine pas si les anciennes minutes étaient
     * individuelles ou collectives : cette conversion exige un arbitrage
     * dans l'adaptateur historique.
     */
    const STATUTS_INTERVENTION = Object.freeze(["Pas payé", "Payé", "A venir", "Non effectué"]);
    const STATUTS_TRAVAILLE = new Set(["Pas payé", "Payé"]);
    
    function dateValide(value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const [y, m, d] = value.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }
    
    function analyserIntervention(intervention) {
      const anomalies = [];
      if (!intervention || typeof intervention !== "object" || Array.isArray(intervention)) {
        return { valide: false, anomalies: ["Intervention invalide"] };
      }
      for (const champ of ["id", "etudeId", "membreId"]) {
        if (typeof intervention[champ] !== "string" || !intervention[champ].trim()) {
          anomalies.push("Identifiant " + champ + " absent ou invalide");
        }
      }
      if (!dateValide(intervention.date)) anomalies.push("Date d'intervention absente ou invalide");
      if (!STATUTS_INTERVENTION.includes(intervention.statut)) anomalies.push("Statut d'intervention absent ou inconnu");
    
      const minutes = intervention.minutesIndividuelles === "" || intervention.minutesIndividuelles == null
        ? null : Number(intervention.minutesIndividuelles);
      if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
        anomalies.push("Durée individuelle absente ou invalide");
      }
    
      const prixJehHt = intervention.prixJehHt === "" || intervention.prixJehHt == null
        ? null : Number(intervention.prixJehHt);
      if (prixJehHt !== null && (!Number.isFinite(prixJehHt) || prixJehHt < 0)) {
        anomalies.push("Prix HT/JEH invalide");
      }
    
      const jeh = minutes !== null && Number.isFinite(minutes) && minutes > 0 ? minutes / 480 : null;
      const travaille = STATUTS_TRAVAILLE.has(intervention.statut);
      return {
        valide: anomalies.length === 0,
        anomalies,
        minutesIndividuelles: minutes,
        jeh,
        jehTravaillees: travaille && jeh !== null ? jeh : 0,
        statutTravaille: travaille,
        montantClientHt: jeh !== null && prixJehHt !== null ? jeh * prixJehHt : null,
      };
    }
    
    function agregerInterventions(interventions) {
      if (!Array.isArray(interventions)) {
        return { valide: false, totalJehTravaillees: null, parMembre: [], parEtude: [], anomalies: ["La liste des interventions doit être un tableau"] };
      }
      const parMembre = new Map();
      const parEtude = new Map();
      let totalJehTravaillees = 0;
      const anomalies = [];
      interventions.forEach((intervention, index) => {
        const analyse = analyserIntervention(intervention);
        analyse.anomalies.forEach(raison => anomalies.push({ index, raison }));
        if (!analyse.valide || !analyse.statutTravaille) return;
        totalJehTravaillees += analyse.jehTravaillees;
        parMembre.set(intervention.membreId, (parMembre.get(intervention.membreId) || 0) + analyse.jehTravaillees);
        parEtude.set(intervention.etudeId, (parEtude.get(intervention.etudeId) || 0) + analyse.jehTravaillees);
      });
      return {
        valide: anomalies.length === 0,
        totalJehTravaillees: anomalies.length ? null : totalJehTravaillees,
        parMembre: [...parMembre].map(([membreId, jeh]) => ({ membreId, jeh })),
        parEtude: [...parEtude].map(([etudeId, jeh]) => ({ etudeId, jeh })),
        anomalies,
      };
    }
    
    module.exports = { STATUTS_INTERVENTION, STATUTS_TRAVAILLE, analyserIntervention, agregerInterventions, dateValide };
    
    },
    "domain/bv.js": function(require, module, exports) {
    /**
     * HAC refonte — validation métier des bulletins de versement.
     *
     * Un BV peut contenir plusieurs lignes (une par personne).
     * Le minimum de 1 JEH s'applique au total du BV, pas à chaque ligne,
     * ni au cumul annuel d'une personne.
     */
    
    const { estIdValide } = require("./identites");
    
    function validerBV(bv) {
      const anomalies = [];
      if (!bv || typeof bv !== "object") {
        return { valide: false, totalJeh: 0, anomalies: ["Bulletin de versement invalide"] };
      }
    
      const lignes = Array.isArray(bv.lignes) ? bv.lignes : [];
      if (lignes.length === 0) anomalies.push("Le BV doit contenir au moins une ligne");
    
      const personnes = new Set();
      let totalJeh = 0;
    
      lignes.forEach((ligne, index) => {
        if (!ligne || typeof ligne !== "object") {
          anomalies.push({ index, raison: "Ligne invalide" });
          return;
        }
    
        const personneId = ligne.personneId;
        if (typeof personneId !== "string" || personneId.trim() === "") {
          anomalies.push({ index, raison: "Identifiant de personne manquant" });
        } else if (personnes.has(personneId)) {
          anomalies.push({ index, raison: "Une personne apparaît plusieurs fois sur le même BV" });
        } else {
          personnes.add(personneId);
        }
    
        const jeh = Number(ligne.jeh);
        if (ligne.jeh === "" || ligne.jeh == null || !Number.isFinite(jeh) || jeh < 0) {
          anomalies.push({ index, raison: "Nombre de JEH absent ou invalide" });
        } else {
          totalJeh += jeh;
        }
      });
    
      if (lignes.length > 0 && totalJeh < 1) {
        anomalies.push("Le total du BV doit atteindre au moins 1 JEH");
      }
    
      return { valide: anomalies.length === 0, totalJeh, anomalies };
    }
    
    
    function analyserCollectionBVs({ bvs = [], lignesBV = [], membres = [] } = {}) {
      const anomalies = [];
      if (![bvs, lignesBV, membres].every(Array.isArray)) {
        return { valide: false, resume: [], anomalies: ["Les collections BV, lignesBV et membres doivent être des tableaux"] };
      }
    
      const membresIds = new Set(membres.map(m => m?.id).filter(id => typeof id === "string" && id.trim()));
      const bvsParId = new Map();
      bvs.forEach((bv, index) => {
        if (!bv || typeof bv !== "object" || !estIdValide(bv.id)) {
          anomalies.push({ collection: "bvs", index, raison: "Identifiant de BV absent ou invalide" });
          return;
        }
        if (bvsParId.has(bv.id)) {
          anomalies.push({ collection: "bvs", index, raison: "Identifiant de BV dupliqué", id: bv.id });
          return;
        }
        bvsParId.set(bv.id, { bv, index, lignes: [] });
      });
    
      const ligneIds = new Set();
      lignesBV.forEach((ligne, index) => {
        if (!ligne || typeof ligne !== "object") {
          anomalies.push({ collection: "lignesBV", index, raison: "Ligne invalide" });
          return;
        }
        if (!estIdValide(ligne.id)) {
          anomalies.push({ collection: "lignesBV", index, raison: "Identifiant de ligne absent ou invalide" });
        } else if (ligneIds.has(ligne.id)) {
          anomalies.push({ collection: "lignesBV", index, raison: "Identifiant de ligne dupliqué", id: ligne.id });
        } else {
          ligneIds.add(ligne.id);
        }
    
        const parent = estIdValide(ligne.bvId) ? bvsParId.get(ligne.bvId) : null;
        if (!parent) {
          anomalies.push({ collection: "lignesBV", index, raison: "BV parent introuvable" });
        } else {
          parent.lignes.push({ ligne, index });
        }
        if (!estIdValide(ligne.membreId) || !membresIds.has(ligne.membreId)) {
          anomalies.push({ collection: "lignesBV", index, raison: "Membre lié introuvable" });
        }
        const jeh = Number(ligne.jeh);
        if (ligne.jeh === "" || ligne.jeh == null || !Number.isFinite(jeh) || jeh < 0) {
          anomalies.push({ collection: "lignesBV", index, raison: "Nombre de JEH absent ou invalide" });
        }
      });
    
      const resume = [];
      for (const [bvId, entry] of bvsParId) {
        const personnes = new Set();
        let totalJeh = 0;
        entry.lignes.forEach(({ ligne, index }) => {
          if (typeof ligne.membreId === "string" && personnes.has(ligne.membreId)) {
            anomalies.push({ collection: "lignesBV", index, raison: "Une personne apparaît plusieurs fois sur le même BV" });
          }
          if (typeof ligne.membreId === "string") personnes.add(ligne.membreId);
          const jeh = Number(ligne.jeh);
          if (ligne.jeh !== "" && ligne.jeh != null && Number.isFinite(jeh) && jeh >= 0) totalJeh += jeh;
        });
        if (entry.lignes.length === 0) {
          anomalies.push({ collection: "bvs", index: entry.index, raison: "Le BV ne contient aucune ligne" });
        } else if (totalJeh < 1) {
          anomalies.push({ collection: "bvs", index: entry.index, raison: "Le total du BV doit atteindre au moins 1 JEH" });
        }
        resume.push({ bvId, nombreLignes: entry.lignes.length, nombrePersonnes: personnes.size, totalJeh });
      }
    
      return { valide: anomalies.length === 0, resume, anomalies };
    }
    
    module.exports = { validerBV, analyserCollectionBVs };
    
    },
    "domain/tableau-de-bord.js": function(require, module, exports) {
    /**
     * HAC refonte — agrégats du tableau de bord.
     *
     * Ce module ne lit aucune source externe et ne modifie aucune donnée.
     * Les JEH sont calculées uniquement via les statuts métier autorisés.
     * Le CA signé vient des études ; facturation et encaissement viennent
     * exclusivement des factures liées par etudeId.
     */
    
    const { analyserIntervention, agregerInterventions } = require("./interventions");
    const { analyserFacture } = require("./factures");
    const { STATUTS_ETUDE, STATUTS_CA_SIGNE } = require("./etudes");
    
    function dateValide(value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const [y, m, d] = value.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    }
    
    function montantValide(value) {
      if (value === "" || value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    
    function calculerTableauDeBord({
      etudes = [],
      factures = [],
      interventions = [],
      dateFin = new Date().toISOString().slice(0, 10),
      nombreMois = 6,
      tva = 0.2,
    } = {}) {
      const anomalies = [];
      if (![etudes, factures, interventions].every(Array.isArray)) {
        return { valide: false, anomalies: ["Les collections du tableau de bord doivent être des tableaux"] };
      }
      if (!dateValide(dateFin) || !Number.isInteger(nombreMois) || nombreMois < 1 || nombreMois > 24 || !Number.isFinite(tva) || tva < 0 || tva > 1) {
        return { valide: false, anomalies: ["Paramètres de période ou taux de TVA invalides"] };
      }
    
      let caSigne = 0;
      let caSigneComplet = true;
      const etudeIds = new Set();
    
      etudes.forEach((etude, index) => {
        if (!etude || typeof etude !== "object" || typeof etude.id !== "string" || !etude.id) {
          anomalies.push({ collection: "etudes", index, raison: "Étude ou identifiant invalide" });
          caSigneComplet = false;
          return;
        }
        if (etudeIds.has(etude.id)) {
          anomalies.push({ collection: "etudes", index, raison: "Identifiant d'étude dupliqué" });
          caSigneComplet = false;
          return;
        }
        etudeIds.add(etude.id);
        if (!STATUTS_ETUDE.includes(etude.statut)) {
          anomalies.push({ collection: "etudes", index, raison: "Statut d'étude absent ou inconnu" });
          caSigneComplet = false;
          return;
        }
        const montant = montantValide(etude.montant);
        if (STATUTS_CA_SIGNE.has(etude.statut)) {
          if (montant === null) {
            anomalies.push({ collection: "etudes", index, raison: "Montant signé absent ou invalide" });
            caSigneComplet = false;
          } else {
            caSigne += montant / (1 + tva);
          }
        } else if (etude.montant !== undefined && etude.montant !== null && etude.montant !== "" && montant === null) {
          anomalies.push({ collection: "etudes", index, raison: "Montant d'étude invalide" });
          caSigneComplet = false;
        }
      });
    
      let montantFacture = 0;
      let encaisse = 0;
      let facturesCompletes = true;
    
      factures.forEach((facture, index) => {
        if (!facture || typeof facture !== "object" || typeof facture.etudeId !== "string" || !etudeIds.has(facture.etudeId)) {
          anomalies.push({ collection: "factures", index, raison: "Facture sans lien d'étude valide" });
          facturesCompletes = false;
          return;
        }
        const montant = montantValide(facture.montant);
        const analyse = analyserFacture(facture);
        if (montant === null || analyse.anomalie) {
          anomalies.push({ collection: "factures", index, raison: montant === null ? "Montant absent ou invalide" : analyse.anomalie });
          facturesCompletes = false;
          return;
        }
        montantFacture += montant / (1 + tva);
        if (analyse.payee) encaisse += montant / (1 + tva);
      });
    
      const calculInterventions = agregerInterventions(interventions);
      calculInterventions.anomalies.forEach(a => anomalies.push({ collection: "interventions", ...a }));
    
      const fin = new Date(dateFin + "T00:00:00.000Z");
      const debut = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - (nombreMois - 1), 1));
      const mois = [];
      for (let i = 0; i < nombreMois; i++) {
        const d = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + i, 1));
        const key = d.toISOString().slice(0, 7);
        mois.push({ mois: key, jeh: 0 });
      }
      const moisIndex = new Map(mois.map((m, i) => [m.mois, i]));
      interventions.forEach(ligne => {
        const analyse = analyserIntervention(ligne);
        if (!analyse.valide || !analyse.statutTravaille) return;
        const idx = moisIndex.get(ligne.date.slice(0, 7));
        if (idx !== undefined) mois[idx].jeh += analyse.jeh;
      });
    
      return {
        valide: anomalies.length === 0,
        nombreEtudes: etudes.length,
        caSigne: caSigneComplet ? caSigne : null,
        montantFacture: facturesCompletes ? montantFacture : null,
        encaisse: facturesCompletes ? encaisse : null,
        resteAEncaisser: facturesCompletes ? montantFacture - encaisse : null,
        totalJehTravaillees: calculInterventions.totalJehTravaillees,
        jehParMois: calculInterventions.valide ? mois : null,
        jehParMembre: calculInterventions.valide ? calculInterventions.parMembre : null,
        anomalies,
      };
    }
    
    module.exports = { calculerTableauDeBord };
    
    },
    "application/lecture.js": function(require, module, exports) {
    /**
     * HAC refonte — couche de lecture applicative.
     *
     * Assemble les domaines métier en un seul modèle de lecture pour l'interface.
     * Aucun accès réseau, aucune écriture et aucune correction silencieuse.
     */
    const { estIdValide } = require("../domain/identites");
    const { analyserCollectionBVs } = require("../domain/bv");
    const { calculerTableauDeBord } = require("../domain/tableau-de-bord");
    
    const COLLECTIONS = Object.freeze([
      "clients",
      "membres",
      "etudes",
      "factures",
      "interventions",
      "bvs",
      "lignesBV",
    ]);
    
    function creerEtatVide() {
      return Object.fromEntries(COLLECTIONS.map(nom => [nom, []]));
    }
    
    function libellePersonne(personne) {
      if (!personne) return "Référence inconnue";
      return personne.raisonSociale || personne.nomComplet || personne.nom ||
        personne.name || personne.client || personne.id;
    }
    
    function indexer(collection) {
      return new Map(collection.map(item => [item.id, item]));
    }
    
    function validerEtat(etat) {
      const anomalies = [];
      if (!etat || typeof etat !== "object" || Array.isArray(etat)) {
        return { valide: false, anomalies: ["L'état applicatif doit être un objet"] };
      }
    
      for (const nom of COLLECTIONS) {
        if (!Array.isArray(etat[nom])) {
          anomalies.push({ collection: nom, raison: "Collection absente ou non tabulaire" });
        }
      }
      if (anomalies.length) return { valide: false, anomalies };
    
      const index = {};
      for (const nom of COLLECTIONS) {
        const ids = new Set();
        index[nom] = new Map();
        etat[nom].forEach((objet, position) => {
          if (!objet || typeof objet !== "object" || Array.isArray(objet) || !estIdValide(objet.id)) {
            anomalies.push({ collection: nom, index: position, raison: "Objet ou identifiant stable invalide" });
            return;
          }
          if (ids.has(objet.id)) {
            anomalies.push({ collection: nom, index: position, id: objet.id, raison: "Identifiant dupliqué" });
            return;
          }
          ids.add(objet.id);
          index[nom].set(objet.id, objet);
        });
      }
    
      const verifierLien = (collection, indexObjet, champ, cible) => {
        const objet = etat[collection][indexObjet];
        if (objet[champ] == null || objet[champ] === "") return;
        if (!estIdValide(objet[champ]) || !index[cible].has(objet[champ])) {
          anomalies.push({ collection, index: indexObjet, champ, raison: "Référence " + cible + " introuvable ou invalide" });
        }
      };
    
      etat.etudes.forEach((_, i) => verifierLien("etudes", i, "clientId", "clients"));
      etat.factures.forEach((_, i) => verifierLien("factures", i, "etudeId", "etudes"));
      etat.interventions.forEach((_, i) => {
        verifierLien("interventions", i, "etudeId", "etudes");
        verifierLien("interventions", i, "membreId", "membres");
      });
      etat.lignesBV.forEach((_, i) => {
        verifierLien("lignesBV", i, "bvId", "bvs");
        verifierLien("lignesBV", i, "membreId", "membres");
      });
    
      const analyseBVs = analyserCollectionBVs({
        bvs: etat.bvs,
        lignesBV: etat.lignesBV,
        membres: etat.membres,
      });
      analyseBVs.anomalies.forEach(anomalie => anomalies.push({
        collection: anomalie.collection || "bvs",
        index: anomalie.index,
        raison: anomalie.raison || anomalie,
      }));
    
      return { valide: anomalies.length === 0, anomalies };
    }
    
    function construireVueApplication(etat, options = {}) {
      const validation = validerEtat(etat);
      if (!validation.valide) {
        return {
          valide: false,
          anomalies: validation.anomalies,
          tableauDeBord: null,
          listes: null,
        };
      }
    
      const clients = indexer(etat.clients);
      const membres = indexer(etat.membres);
      const etudes = indexer(etat.etudes);
    
      const tableauDeBord = calculerTableauDeBord({
        etudes: etat.etudes,
        factures: etat.factures,
        interventions: etat.interventions,
        dateFin: options.dateFin,
        nombreMois: options.nombreMois ?? 6,
        tva: options.tva ?? 0.2,
      });
    
      if (!tableauDeBord.valide) {
        return {
          valide: false,
          anomalies: tableauDeBord.anomalies,
          tableauDeBord: null,
          listes: null,
        };
      }
    
      const etudesVue = etat.etudes.map(etude => ({
        ...etude,
        clientLibelle: etude.clientId
          ? libellePersonne(clients.get(etude.clientId))
          : etude.client || "Client non renseigné",
        factures: etat.factures.filter(f => f.etudeId === etude.id),
      })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    
      const facturesVue = etat.factures.map(facture => ({
        ...facture,
        etudeLibelle: etudes.get(facture.etudeId)?.num || facture.etudeId,
      }));
    
      const interventionsVue = etat.interventions.map(intervention => ({
        ...intervention,
        etudeLibelle: etudes.get(intervention.etudeId)?.num || intervention.etudeId,
        membreLibelle: libellePersonne(membres.get(intervention.membreId)),
      }));
    
      const lignesParBV = new Map();
      etat.lignesBV.forEach(ligne => {
        if (!lignesParBV.has(ligne.bvId)) lignesParBV.set(ligne.bvId, []);
        lignesParBV.get(ligne.bvId).push({
          ...ligne,
          membreLibelle: libellePersonne(membres.get(ligne.membreId)),
        });
      });
    
      const bvsVue = etat.bvs.map(bv => ({
        ...bv,
        lignes: lignesParBV.get(bv.id) || [],
      }));
    
      return {
        valide: true,
        anomalies: [],
        tableauDeBord,
        listes: {
          clients: etat.clients.map(client => ({ ...client, libelle: libellePersonne(client) })),
          membres: etat.membres.map(membre => ({ ...membre, libelle: libellePersonne(membre) })),
          etudes: etudesVue,
          factures: facturesVue,
          interventions: interventionsVue,
          bvs: bvsVue,
        },
      };
    }
    
    module.exports = { COLLECTIONS, creerEtatVide, validerEtat, construireVueApplication };
    
    },
    "application/commandes.js": function(require, module, exports) {
    /**
     * HAC refonte — commandes applicatives en mémoire.
     *
     * Prépare et applique des ajouts/modifications immuables sur un état de travail.
     * Ce module ne persiste rien et ne remplace pas les contrôles de version du serveur.
     */
    const { COLLECTIONS, construireVueApplication } = require("./lecture");
    
    function preparerAjout({ etat, collection, donnees, creerId }) {
      if (!COLLECTIONS.includes(collection)) {
        return { valide: false, anomalies: ["Collection inconnue"] };
      }
      if (!etat || !Array.isArray(etat[collection])) {
        return { valide: false, anomalies: ["État ou collection invalide"] };
      }
      if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) {
        return { valide: false, anomalies: ["Les données à ajouter doivent être un objet"] };
      }
      if (typeof creerId !== "function") {
        return { valide: false, anomalies: ["Un générateur d'identifiant stable doit être fourni"] };
      }
      const id = creerId(collection);
      if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) {
        return { valide: false, anomalies: ["Le générateur a fourni un identifiant invalide"] };
      }
      if (etat[collection].some(item => item?.id === id)) {
        return { valide: false, anomalies: ["Cet identifiant existe déjà"] };
      }
      if (Object.prototype.hasOwnProperty.call(donnees, "id") && donnees.id !== id) {
        return { valide: false, anomalies: ["L'identifiant des données ne peut pas remplacer celui généré"] };
      }
      return {
        valide: true,
        commande: {
          type: "ajouter",
          collection,
          id,
          enregistrement: { ...donnees, id },
        },
      };
    }
    
    function preparerModification({ etat, collection, id, modifications }) {
      if (!COLLECTIONS.includes(collection) || !etat || !Array.isArray(etat[collection])) {
        return { valide: false, anomalies: ["État ou collection invalide"] };
      }
      if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) {
        return { valide: false, anomalies: ["Identifiant stable invalide"] };
      }
      if (!modifications || typeof modifications !== "object" || Array.isArray(modifications)) {
        return { valide: false, anomalies: ["Les modifications doivent être un objet"] };
      }
      if (Object.prototype.hasOwnProperty.call(modifications, "id")) {
        return { valide: false, anomalies: ["L'identifiant stable est immuable"] };
      }
      const index = etat[collection].findIndex(item => item?.id === id);
      if (index < 0) return { valide: false, anomalies: ["Enregistrement introuvable"] };
    
      return {
        valide: true,
        commande: {
          type: "modifier",
          collection,
          id,
          modifications: { ...modifications },
        },
      };
    }
    
    function appliquerCommande(etat, commande) {
      if (!etat || typeof etat !== "object" || !commande || typeof commande !== "object") {
        return { valide: false, etat, anomalies: ["État ou commande invalide"] };
      }
      if (!COLLECTIONS.includes(commande.collection) || !Array.isArray(etat[commande.collection])) {
        return { valide: false, etat, anomalies: ["Collection inconnue ou invalide"] };
      }
    
      const collection = commande.collection;
      const copie = { ...etat };
      if (commande.type === "ajouter") {
        if (!commande.enregistrement || commande.enregistrement.id !== commande.id ||
            etat[collection].some(item => item?.id === commande.id)) {
          return { valide: false, etat, anomalies: ["Ajout invalide ou identifiant déjà utilisé"] };
        }
        copie[collection] = [...etat[collection], { ...commande.enregistrement }];
      } else if (commande.type === "modifier") {
        const index = etat[collection].findIndex(item => item?.id === commande.id);
        if (index < 0 || !commande.modifications ||
            Object.prototype.hasOwnProperty.call(commande.modifications, "id")) {
          return { valide: false, etat, anomalies: ["Modification invalide ou enregistrement introuvable"] };
        }
        copie[collection] = etat[collection].map((item, i) =>
          i === index ? { ...item, ...commande.modifications } : item
        );
      } else {
        return { valide: false, etat, anomalies: ["Type de commande non pris en charge"] };
      }
    
      const validation = construireVueApplication(copie);
      if (!validation.valide) {
        return { valide: false, etat, anomalies: validation.anomalies };
      }
      return { valide: true, etat: copie, anomalies: [] };
    }
    
    module.exports = { preparerAjout, preparerModification, appliquerCommande };
    
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
    ...charger("application/commandes.js")
  });
})(globalThis);
