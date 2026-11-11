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
