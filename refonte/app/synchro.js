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
const { creerEtatVide } = require("../application/lecture");
const { appliquerCommande } = require("../application/commandes");
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
      const res = appliquerCommande(etat, commande);
      if (!res.valide) return { valide: false, anomalies: res.anomalies };
      const col = commande.collection, id = commande.id;
      const fiche = res.etat[col].find(x => x.id === id);
      const attendue = Number.isSafeInteger(fiche?._v) ? fiche._v : 0;
      await file.ajouter({ type: "save", collection: col, id, record: sansChampsServeur(fiche), opId: creerOpId(), expectedVersion: attendue });
      etat = { ...res.etat, [col]: res.etat[col].map(x => (x.id === id ? { ...x, _v: attendue + 1 } : x)) };
      await memoriser();
      let envoi;
      try { envoi = await synchroniser(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; envoi = { restantes: (await file.inspecter()).length }; }
      return { valide: true, envoi };
    },

    synchroniser,

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

module.exports = { creerSynchro, stockageNavigateur, transportFetch };
