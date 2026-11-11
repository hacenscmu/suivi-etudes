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
    
    function analyserIntervention(intervention, { plafondJehHt = 300 } = {}) {
      const anomalies = [];
      const alertes = [];
      if (!intervention || typeof intervention !== "object" || Array.isArray(intervention)) {
        return { valide: false, anomalies: ["Intervention invalide"], alertes };
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
    
      if (prixJehHt !== null && Number.isFinite(prixJehHt) && plafondJehHt !== null && prixJehHt > plafondJehHt) {
        alertes.push("Prix de la JEH intervenant supérieur au plafond HAC de " + plafondJehHt + " € HT");
      }
    
      const jeh = minutes !== null && Number.isFinite(minutes) && minutes > 0 ? minutes / 480 : null;
      const travaille = STATUTS_TRAVAILLE.has(intervention.statut);
      return {
        valide: anomalies.length === 0,
        anomalies,
        alertes,
        minutesIndividuelles: minutes,
        jeh,
        jehTravaillees: travaille && jeh !== null ? jeh : 0,
        statutTravaille: travaille,
        montantClientHt: jeh !== null && prixJehHt !== null ? jeh * prixJehHt : null,
      };
    }
    
    function agregerInterventions(interventions, options = {}) {
      if (!Array.isArray(interventions)) {
        return { valide: false, totalJehTravaillees: null, parMembre: [], parEtude: [], anomalies: ["La liste des interventions doit être un tableau"], alertes: [] };
      }
      const parMembre = new Map();
      const parEtude = new Map();
      let totalJehTravaillees = 0;
      const anomalies = [];
      const alertes = [];
      interventions.forEach((intervention, index) => {
        const analyse = analyserIntervention(intervention, options);
        analyse.alertes.forEach(raison => alertes.push({ index, raison }));
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
        alertes,
      };
    }
    
    module.exports = { STATUTS_INTERVENTION, STATUTS_TRAVAILLE, analyserIntervention, agregerInterventions, dateValide };
    
    },
    "domain/bv.js": function(require, module, exports) {
    /**
     * HAC refonte — validation métier des bulletins de versement.
     *
     * Un BV regroupe des lignes, une par personne.
     * Règle « minimum de 1 JEH par BV » (app.js v11 l. 181, 186, 490) : ce n'est PAS
     * une interdiction. Un BV de 0,5 JEH est valide : la personne est payée sur 0,5 JEH,
     * mais cotisations et charges sont calculées sur une assiette de 1 JEH.
     * L'assiette est calculée PAR PERSONNE (les cotisations sont individuelles) :
     * assietteJeh = max(jeh, 1) si jeh > 0, sinon 0.
     */
    
    const { estIdValide } = require("./identites");
    
    function assietteJeh(jeh) {
      return jeh > 0 ? Math.max(jeh, 1) : 0;
    }
    
    function validerBV(bv) {
      const anomalies = [];
      if (!bv || typeof bv !== "object") {
        return { valide: false, totalJeh: 0, anomalies: ["Bulletin de versement invalide"] };
      }
    
      const lignes = Array.isArray(bv.lignes) ? bv.lignes : [];
      if (lignes.length === 0) anomalies.push("Le BV doit contenir au moins une ligne");
    
      const personnes = new Set();
      const assiettes = [];
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
          assiettes.push({ personneId, jeh, assietteJeh: assietteJeh(jeh) });
        }
      });
    
      return { valide: anomalies.length === 0, totalJeh, assiettes, anomalies };
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
        const assiettes = [];
        let totalJeh = 0;
        entry.lignes.forEach(({ ligne, index }) => {
          if (typeof ligne.membreId === "string" && personnes.has(ligne.membreId)) {
            anomalies.push({ collection: "lignesBV", index, raison: "Une personne apparaît plusieurs fois sur le même BV" });
          }
          if (typeof ligne.membreId === "string") personnes.add(ligne.membreId);
          const jeh = Number(ligne.jeh);
          if (ligne.jeh !== "" && ligne.jeh != null && Number.isFinite(jeh) && jeh >= 0) {
            totalJeh += jeh;
            assiettes.push({ membreId: ligne.membreId, jeh, assietteJeh: assietteJeh(jeh) });
          }
        });
        if (entry.lignes.length === 0) {
          anomalies.push({ collection: "bvs", index: entry.index, raison: "Le BV ne contient aucune ligne" });
        }
        resume.push({ bvId, nombreLignes: entry.lignes.length, nombrePersonnes: personnes.size, totalJeh, assiettes });
      }
    
      return { valide: anomalies.length === 0, resume, anomalies };
    }
    
    module.exports = { validerBV, analyserCollectionBVs, assietteJeh };
    
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
      plafondJehHt = 300,
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
    
      const calculInterventions = agregerInterventions(interventions, { plafondJehHt });
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
        alertesInterventions: calculInterventions.alertes,
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
      "formation",
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
    
      const membresAvecFormation = new Set();
      etat.formation.forEach((fiche, i) => {
        if (!estIdValide(fiche.membreId) || !index.membres.has(fiche.membreId)) {
          anomalies.push({ collection: "formation", index: i, raison: "Membre de formation introuvable ou invalide" });
        }
        if (fiche.membreId && membresAvecFormation.has(fiche.membreId)) {
          anomalies.push({ collection: "formation", index: i, raison: "Plusieurs grilles de formation pour le même membre" });
        }
        if (fiche.membreId) membresAvecFormation.add(fiche.membreId);
        if (typeof fiche.nom !== "string" || !fiche.nom.trim()) {
          anomalies.push({ collection: "formation", index: i, raison: "Nom de formation absent ou invalide" });
        }
        if (!fiche.niveaux || typeof fiche.niveaux !== "object" || Array.isArray(fiche.niveaux)) {
          anomalies.push({ collection: "formation", index: i, raison: "Grille de niveaux invalide" });
        } else {
          for (const [etudeId, niveau] of Object.entries(fiche.niveaux)) {
            if (!estIdValide(etudeId) || !index.etudes.has(etudeId)) {
              anomalies.push({ collection: "formation", index: i, raison: "Étude de formation introuvable ou invalide" });
            }
            if (!Number.isInteger(niveau) || niveau < 0 || niveau > 4) {
              anomalies.push({ collection: "formation", index: i, raison: "Niveau de formation hors de 0 à 4" });
            }
          }
        }
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
    
    },
    "domain/clients.js": function(require, module, exports) {
    /**
     * HAC refonte — relation client et cadence de facturation.
     *
     * La durée de la relation commerciale et la périodicité de facturation
     * sont deux notions distinctes. Une relation longue durée (type CDI) ne
     * signifie pas automatiquement une facturation mensuelle ou récurrente.
     * Rien n'est déduit du nombre d'études passées.
     */
    const TYPES_RELATION = new Set(["ponctuelle", "longue_duree"]);
    const CADENCES = new Set(["mensuelle", "trimestrielle", "semestrielle", "annuelle"]);
    
    function resoudreRelation(client, etude = null) {
      const type = etude?.relationType ?? client?.relationType ?? "ponctuelle";
      if (!TYPES_RELATION.has(type)) {
        return { type: "invalide", cadenceFacturation: null, anomalie: "Type de relation absent ou inconnu" };
      }
    
      let cadenceFacturation;
      if (etude && Object.prototype.hasOwnProperty.call(etude, "cadenceFacturationMode")) {
        const mode = etude.cadenceFacturationMode;
        if (mode === "client") cadenceFacturation = client?.cadenceFacturation ?? null;
        else if (mode === "aucune") cadenceFacturation = null;
        else if (mode === "personnalisee") {
          cadenceFacturation = etude.cadenceFacturation ?? null;
          if (!CADENCES.has(cadenceFacturation)) {
            return { type, cadenceFacturation: null, anomalie: "Cadence personnalisée absente ou inconnue" };
          }
        } else {
          return { type, cadenceFacturation: null, anomalie: "Mode de cadence absent ou inconnu" };
        }
      } else {
        // Compatibilité des anciennes fiches : une cadence présente sur l'étude surcharge le client.
        cadenceFacturation = etude && Object.prototype.hasOwnProperty.call(etude, "cadenceFacturation")
          ? etude.cadenceFacturation
          : client?.cadenceFacturation ?? null;
      }
    
      if (cadenceFacturation !== null && !CADENCES.has(cadenceFacturation)) {
        return { type, cadenceFacturation: null, anomalie: "Cadence de facturation inconnue" };
      }
      return { type, cadenceFacturation, anomalie: null };
    }
    
    function calculerProchaineEcheance({ dateReference, cadence }) {
      if (!CADENCES.has(cadence)) return null;
      if (typeof dateReference !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateReference)) return null;
    
      const [year, month, day] = dateReference.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    
      const monthsToAdd = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 }[cadence];
      const targetMonthIndex = month - 1 + monthsToAdd;
      const targetYear = year + Math.floor(targetMonthIndex / 12);
      const targetMonth = targetMonthIndex % 12;
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const targetDay = Math.min(day, lastDay);
    
      return [
        String(targetYear).padStart(4, "0"),
        String(targetMonth + 1).padStart(2, "0"),
        String(targetDay).padStart(2, "0"),
      ].join("-");
    }
    
    function analyserAlerteClient(client, etude = null) {
      const relation = resoudreRelation(client, etude);
      if (relation.anomalie) {
        return { alerteActivable: false, prochaineEcheance: null, anomalie: relation.anomalie };
      }
      if (relation.type !== "longue_duree" || relation.cadenceFacturation === null) {
        return { alerteActivable: false, prochaineEcheance: null, anomalie: null };
      }
    
      const dateReference = etude?.dateProchaineFacture ?? client?.dateProchaineFacture;
      const prochaineEcheance = calculerProchaineEcheance({
        dateReference,
        cadence: relation.cadenceFacturation,
      });
      if (!prochaineEcheance) {
        return {
          alerteActivable: false,
          prochaineEcheance: null,
          anomalie: "Date de référence de facturation manquante ou invalide",
        };
      }
      return { alerteActivable: true, prochaineEcheance, anomalie: null };
    }
    
    module.exports = {
      TYPES_RELATION,
      CADENCES,
      resoudreRelation,
      calculerProchaineEcheance,
      analyserAlerteClient,
    };
    
    },
    "domain/alertes.js": function(require, module, exports) {
    /**
     * HAC — alertes par étude : portage des 22 alertes de l'app v12 (app.js, ALERTS / alertsOf / finStatus)
     * sur le modèle v3 (identifiants stables, interventions individuelles).
     * Règles reprises à l'identique, avec les corrections v12 : statut financier sur TOUTES les factures,
     * frais hors JEH, et minimum 1 JEH = assiette (jamais une alerte).
     */
    const DEFAUTS = { tva: 0.2, relance1: 3, relance2: 10, cnje: { date: "", min: 80, max: 450, maxInt: 300 } };
    const SIGNEES = ["Convention signée", "Convention étudiant avant réalisation", "En réalisation", "Archivée"]; // L_STAT v11
    const EN_COURS = ["Faisabilité", "Devis envoyé", "Devis signé", "Convention envoyée", "Convention signée", "Convention étudiant avant réalisation", "En réalisation"];
    const FACTUREES = ["Acompte facturé", "Facture intermédiaire", "Solde facturé"];
    
    const ALERTES = [
      ["retard", "Retard de paiement (+ relances)", "Facture émise et échéance dépassée."],
      ["arch_reste", "Archivée mais reste à encaisser", "Le client doit encore payer."],
      ["arch_solde", "Archivée sans solde encaissé", "Le solde n’est pas marqué encaissé."],
      ["arch_bv", "Archivée mais BV non payés", "Un intervenant est encore « À payer »."],
      ["enc_sup", "Encaissé supérieur au montant", "Erreur de saisie ou trop-perçu."],
      ["acompte", "Facturer l’acompte", "Convention signée ou en réalisation sans facture."],
      ["echeance", "Renseigner l’échéance", "Facture émise sans date d’échéance."],
      ["temps", "Renseigner le temps de travail", "En réalisation sans intervention."],
      ["jeh_manq", "Prix de la JEH manquant", "Interventions mais prix JEH client vide."],
      ["rem_sup", "Rémunérations > montant HT", "Les rémunérations dépassent le montant."],
      ["payer_bv", "Payer les BV", "Solde encaissé, intervenants « À payer »."],
      ["archiver", "Tout est soldé : archiver", "Rien à encaisser, BV payés."],
      ["refusee", "Étude refusée mais facturée", "Refusée avec facture."],
      ["solde_reste", "Solde encaissé mais reste à encaisser", "Montant ou encaissé à corriger."],
      ["solde_af", "Facturer le solde", "Étude archivée, solde pas encore facturé."],
      ["date", "Renseigner la date de création", "Étude sans date."],
      ["double", "N° d’étude en double", "Deux études avec le même numéro."],
      ["cnje_cli", "CNJE : JEH client hors fourchette", "Prix JEH client hors min–max."],
      ["cnje_int", "CNJE : JEH intervenant trop élevée", "Au-dessus du plafond intervenant."],
      ["cnje_fact", "CNJE : JEH facturées non entières", "(Montant HT − frais) ÷ prix JEH non entier."],
      ["cnje_rem", "CNJE : JEH rémunérées non entières", "Par intervenant sur une étude."],
      ["cnje_diff", "CNJE : facturées ≠ rémunérées", "Les deux totaux diffèrent."],
    ];
    
    const num = v => (v === "" || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
    const estNum = v => v !== "" && v != null && Number.isFinite(Number(v));
    const jour = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return null; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t); return d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1 ? t / 864e5 : null; };
    const entier = x => Math.abs(x - Math.round(x)) <= 0.005;
    
    /** Statut financier calculé (finStatus v12). */
    function statutFinancier(etude, factures) {
      const inv = [...factures].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))), st = etude.statut;
      const paye = f => f.etat === "Payée";
      if (st === "Refusé / sans suite") return inv.length ? (inv.some(f => !paye(f)) ? "Facture émise" : "Encaissé") : "";
      if (inv.some(f => f.type === "Solde")) return inv.every(paye) ? "Solde encaissé" : "Solde facturé";
      const impayee = inv.find(f => !paye(f));
      if (impayee) return impayee.type === "Intermédiaire" ? "Facture intermédiaire" : "Acompte facturé";
      const last = inv[inv.length - 1];
      if (!last) return st === "Archivée" ? (num(etude.montant) > 0 ? "Solde à facturer" : "") : SIGNEES.includes(st) ? "Acompte à facturer" : "";
      if (st === "Archivée") return "Solde à facturer";
      return last.type === "Intermédiaire" ? "Intermédiaire encaissé" : "Acompte encaissé";
    }
    
    /**
     * Calcule, pour chaque étude, ses indicateurs et alertes.
     * @returns {Map<string, {facture, encaisse, reste, echeance, bv, alertes:[{cle, texte}]}>}
     */
    function calculerAlertes({ etudes = [], factures = [], interventions = [], config = {}, aujourdhui }) {
      const c = { ...DEFAUTS, ...config, cnje: { ...DEFAUTS.cnje, ...(config.cnje || {}) } };
      const tva = num(c.tva), AUJ = jour(aujourdhui), cnjeDate = jour(c.cnje.date);
      const off = c.alertesOff || {}, actif = cle => c.alertesOn !== false && !off[cle];
      const nums = {}; etudes.forEach(e => { if (e.num) nums[e.num] = (nums[e.num] || 0) + 1; });
      const res = new Map();
      for (const e of etudes) {
        const inv = factures.filter(f => f.etudeId === e.id), ls = interventions.filter(i => i.etudeId === e.id);
        const st = e.statut, fa = statutFinancier(e, inv), montant = num(e.montant);
        const encaisse = inv.filter(f => f.etat === "Payée").reduce((s, f) => s + num(f.montant), 0);
        const reste = SIGNEES.includes(st) ? montant - encaisse : null;
        const ech = inv.filter(f => f.etat !== "Payée" && jour(f.echeance) !== null).map(f => jour(f.echeance));
        const echeance = ech.length ? Math.min(...ech) : null;
        const echeanceManquante = inv.some(f => f.etat !== "Payée" && jour(f.echeance) === null);
        const realisees = ls.filter(i => i.statut === "Payé" || i.statut === "Pas payé");
        const bv = !ls.length ? "" : ls.some(i => i.statut === "Pas payé") ? "À payer" : ls.some(i => i.statut === "A venir") ? "À venir" : ls.some(i => i.statut === "Payé") ? "Payé" : "Non effectué";
        const jehInter = i => num(i.minutesIndividuelles) / 480;
        const jehFact = estNum(e.jeh) && num(e.jeh) && montant ? Math.max(0, montant / (1 + tva) - num(e.frais)) / num(e.jeh) : null;
        const jehRem = ls.length ? realisees.reduce((s, i) => s + jehInter(i), 0) : null;
        const remun = realisees.reduce((s, i) => s + jehInter(i) * num(i.prixJehHt), 0);
        const A = [], add = (cle, texte) => { if (actif(cle)) A.push({ cle, texte }); };
    
        if (FACTUREES.includes(fa) && echeance !== null && AUJ !== null && echeance < AUJ) {
          const r = AUJ - echeance;
          add("retard", "Retard de " + r + " j" + (r > c.relance2 ? " : 2e relance" : r >= c.relance1 ? " : 1re relance par mail" : ""));
        }
        if (st === "Archivée" && reste > 0) add("arch_reste", "Archivée mais reste à encaisser");
        if (st === "Archivée" && fa !== "Solde encaissé") add("arch_solde", "Archivée sans solde encaissé");
        if (st === "Archivée" && bv === "À payer") add("arch_bv", "Archivée mais BV non payés");
        if (montant > 0 && encaisse > montant) add("enc_sup", "Encaissé supérieur au montant");
        if (fa === "Acompte à facturer") add("acompte", "Facturer l’acompte");
        if (fa === "Solde à facturer") add("solde_af", "Facturer le solde");
        if (FACTUREES.includes(fa) && echeanceManquante && st !== "Archivée" && st !== "Refusé / sans suite") add("echeance", "Renseigner l’échéance de paiement");
        if (st === "En réalisation" && !ls.length) add("temps", "Renseigner le temps de travail");
        if (ls.length && !estNum(e.jeh)) add("jeh_manq", "Prix de la JEH client manquant");
        if (montant > 0 && remun > montant / (1 + tva) + 1e-9) add("rem_sup", "Rémunérations supérieures au montant HT");
        if (fa === "Solde encaissé" && st !== "Archivée" && bv === "À payer") add("payer_bv", "Payer les BV");
        if (fa === "Solde encaissé" && st !== "Archivée" && st !== "Refusé / sans suite" && montant > 0 && bv !== "À payer" && reste <= 0) add("archiver", "Tout est soldé : archiver l’étude");
        if (st === "Refusé / sans suite" && inv.length) add("refusee", "Étude refusée mais facturée");
        if (fa === "Solde encaissé" && reste > 0) add("solde_reste", "Solde encaissé mais reste à encaisser");
        if (jour(e.date) === null) add("date", "Renseigner la date de création");
        if (e.num && nums[e.num] > 1) add("double", "N° d’étude en double");
        const cnje = cnjeDate !== null && ((jour(e.date) !== null && jour(e.date) >= cnjeDate) || (st !== "Archivée" && st !== "Refusé / sans suite"));
        if (cnje) {
          if (estNum(e.jeh) && (num(e.jeh) < c.cnje.min || num(e.jeh) > c.cnje.max)) add("cnje_cli", "CNJE : JEH client (" + num(e.jeh) + " €) hors de " + c.cnje.min + "–" + c.cnje.max + " €");
          const maxInt = ls.length ? Math.max(...ls.map(i => num(i.prixJehHt))) : null;
          if (maxInt !== null && maxInt > c.cnje.maxInt) add("cnje_int", "CNJE : JEH intervenant (" + maxInt + " €) supérieure à " + c.cnje.maxInt + " €");
          if (jehFact > 0 && !entier(jehFact)) add("cnje_fact", "CNJE : nb de JEH facturées non entier (" + Math.round(jehFact * 1000) / 1000 + ")");
          const parMembre = {}; realisees.forEach(i => { parMembre[i.membreId] = (parMembre[i.membreId] || 0) + jehInter(i); });
          if (Object.values(parMembre).some(x => !entier(x))) add("cnje_rem", "CNJE : JEH rémunérées non entières");
          if (["Convention étudiant avant réalisation", "En réalisation", "Archivée"].includes(st) && (jehFact > 0 || jehRem !== null) && Math.abs(num(jehFact) - num(jehRem)) > 0.005)
            add("cnje_diff", "CNJE : JEH facturées (" + Math.round(num(jehFact) * 1000) / 1000 + ") ≠ JEH rémunérées (" + Math.round(num(jehRem) * 1000) / 1000 + ")");
        }
        res.set(e.id, { facture: fa, encaisse, reste, echeance: echeance === null ? "" : new Date(echeance * 864e5).toISOString().slice(0, 10), bv, jehFacturees: jehFact, jehRemunerees: jehRem, alertes: A });
      }
      return res;
    }
    
    module.exports = { ALERTES, EN_COURS, statutFinancier, calculerAlertes };
    
    },
    "domain/paie.js": function(require, module, exports) {
    /**
     * HAC — rémunérations (portage de remun / vRemun v12) sur le modèle v3, avec la règle « minimum 1 JEH par BV ».
     *
     * Prochain BV d'une personne = ses interventions « Pas payé » (fait, pas encore payé) :
     *   brut = Σ JEH × prix JEH intervenant HT ;  assiette = max(JEH, 1) si JEH > 0
     *   net  = brut − assiette × base JEH × taux salariaux ;  coût Junior = brut × (1 + chômage) + assiette × base JEH × taux patronaux
     *   base JEH = 4 h de SMIC (paramètre smic). Les taux viennent des réglages (cot, patr, chomage).
     * Déjà payé = interventions « Payé » (brut seulement : leur ventilation en BV historiques n'est pas connue).
     */
    const num = v => (v === "" || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
    const somme = o => Object.values(o || {}).reduce((s, v) => s + num(v), 0);
    const DEFAUT = { smic: 12.31, cot: { maladie: 0.013, retraiteP: 0.069, retraiteD: 0.004, csgD: 0.068, csgND: 0.029 }, patr: { maladie: 0.13, at: 0.0123, retraiteP: 0.0855, retraiteD: 0.0211, famille: 0.0525, autres: 0 }, chomage: 0 };
    
    function calculerPaie({ interventions = [], membres = [], config = {} }) {
      const c = { ...DEFAUT, ...config };
      const base = 4 * num(c.smic), cotTot = somme(c.cot), patrTot = somme(c.patr), chom = num(c.chomage);
      const lignes = membres.map(m => {
        const L = interventions.filter(i => i.membreId === m.id);
        const jeh = i => num(i.minutesIndividuelles) / 480;
        const aPayer = L.filter(i => i.statut === "Pas payé"), payees = L.filter(i => i.statut === "Payé");
        const jehAPayer = aPayer.reduce((s, i) => s + jeh(i), 0), sansPrix = aPayer.some(i => !(num(i.prixJehHt) > 0)), brut = aPayer.filter(i => num(i.prixJehHt) > 0).reduce((s, i) => s + jeh(i) * num(i.prixJehHt), 0);
        const assiette = jehAPayer > 0 ? Math.max(jehAPayer, 1) : 0;
        return {
          membreId: m.id, nom: m.nomComplet, jehAPayer, brut, assiette,
          net: sansPrix ? 0 : brut - assiette * base * cotTot,
          cout: sansPrix ? 0 : brut * (1 + chom) + assiette * base * patrTot,
          jehDejaPayees: payees.reduce((s, i) => s + jeh(i), 0),
          dejaPaye: payees.reduce((s, i) => s + jeh(i) * num(i.prixJehHt), 0),
          sansPrix,
        };
      }).filter(r => r.jehAPayer > 0 || r.jehDejaPayees > 0);
      const total = lignes.reduce((t, r) => ({ brut: t.brut + r.brut, net: t.net + r.net, cout: t.cout + r.cout, jeh: t.jeh + r.jehAPayer }), { brut: 0, net: 0, cout: 0, jeh: 0 });
      return { lignes, total, parametres: { baseJeh: base, cotTot, patrTot, chomage: chom } };
    }
    
    module.exports = { calculerPaie };
    
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
