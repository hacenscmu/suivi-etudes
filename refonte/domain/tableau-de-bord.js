/**
 * HAC refonte — agrégats du tableau de bord.
 *
 * Ce module ne lit aucune source externe et ne modifie aucune donnée.
 * Les JEH sont calculées uniquement via les statuts métier autorisés.
 * Le CA signé vient des études ; facturation et encaissement viennent
 * exclusivement des factures liées par etudeId.
 */

const { calculerJehTravaillees } = require("./jeh");
const { analyserFacture } = require("./factures");

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
} = {}) {
  const anomalies = [];
  if (![etudes, factures, interventions].every(Array.isArray)) {
    return { valide: false, anomalies: ["Les collections du tableau de bord doivent être des tableaux"] };
  }
  if (!dateValide(dateFin) || !Number.isInteger(nombreMois) || nombreMois < 1 || nombreMois > 24) {
    return { valide: false, anomalies: ["Paramètres de période invalides"] };
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
    const montant = montantValide(etude.montant);
    if (montant === null) {
      anomalies.push({ collection: "etudes", index, raison: "Montant signé absent ou invalide" });
      caSigneComplet = false;
    } else {
      caSigne += montant;
    }
  });

  let montantFacture = 0;
  let encaisse = 0;
  let facturesCompletes = true;
  const facturesParEtude = new Map();

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
    montantFacture += montant;
    if (analyse.payee) encaisse += montant;
    facturesParEtude.set(facture.etudeId, (facturesParEtude.get(facture.etudeId) || 0) + montant);
  });

  const calculJeh = calculerJehTravaillees(interventions);
  calculJeh.anomalies.forEach(a => anomalies.push({ collection: "interventions", ...a }));

  const fin = new Date(dateFin + "T00:00:00.000Z");
  const debut = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - (nombreMois - 1), 1));
  const mois = [];
  for (let i = 0; i < nombreMois; i++) {
    const d = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    mois.push({ mois: key, jeh: 0 });
  }
  const moisIndex = new Map(mois.map((m, i) => [m.mois, i]));
  const parMembre = new Map();

  interventions.forEach((ligne, index) => {
    if (!ligne || !["Payé", "Pas payé"].includes(ligne.statut)) return;
    const jeh = montantValide(ligne.jeh);
    if (jeh === null) return;
    if (!dateValide(ligne.date)) {
      anomalies.push({ collection: "interventions", index, raison: "Date d'intervention absente ou invalide" });
    } else {
      const idx = moisIndex.get(ligne.date.slice(0, 7));
      if (idx !== undefined) mois[idx].jeh += jeh;
    }
    if (typeof ligne.membreId === "string" && ligne.membreId.trim()) {
      parMembre.set(ligne.membreId, (parMembre.get(ligne.membreId) || 0) + jeh);
    }
  });

  return {
    valide: anomalies.length === 0,
    nombreEtudes: etudes.length,
    caSigne: caSigneComplet ? caSigne : null,
    montantFacture: facturesCompletes ? montantFacture : null,
    encaisse: facturesCompletes ? encaisse : null,
    resteAEncaisser: facturesCompletes ? montantFacture - encaisse : null,
    totalJehTravaillees: calculJeh.total,
    jehParMois: mois,
    jehParMembre: [...parMembre].map(([membreId, jeh]) => ({ membreId, jeh })),
    anomalies,
  };
}

module.exports = { calculerTableauDeBord };
