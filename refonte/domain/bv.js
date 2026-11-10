/**
 * HAC refonte — validation métier des bulletins de versement.
 *
 * Un BV peut contenir plusieurs lignes (une par personne).
 * Le minimum de 1 JEH s'applique au total du BV, pas à chaque ligne,
 * ni au cumul annuel d'une personne.
 */

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

module.exports = { validerBV };
