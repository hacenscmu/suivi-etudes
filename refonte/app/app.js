/* HAC — application v3 : interface branchée sur le serveur Apps Script (client v3, file hors ligne, synchronisation). */
(() => {
  "use strict";
  const { creerEtatVide, construireVueApplication, preparerAjout, preparerModification, appliquerCommande } = window.HAC;
  const { creerSynchro, creerClientApiV3, stockageNavigateur, transportFetch } = window.HAC;
  // ---- Connexion : adresse du serveur Apps Script et jeton personnel, gardés sur cet appareil ----
  const CONN = "hac.v3.connexion";
  const lireConnexion = () => { try { return JSON.parse(localStorage.getItem(CONN) || "null"); } catch { return null; } };
  let connexion = lireConnexion();
  let synchro = null;
  let data = creerEtatVide();
  let etatSynchro = { source: "vide", enAttente: 0, blocage: null };
  const aujourdHui = () => new Date().toISOString().slice(0, 10);
  const nouvelId = prefixe => prefixe + "_" + crypto.getRandomValues(new Uint32Array(3)).reduce((s, n) => s + n.toString(36), "").slice(0, 16).padEnd(8, "0");

  const pages = ["Accueil", "Études", "Finances", "Équipe", "Réglages"];
  const icons = ["⌂", "▤", "€", "♙", "⚙"];
  let current = "Accueil";
  let recherche = "";
  const money = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const view = () => construireVueApplication(data, { dateFin: aujourdHui(), nombreMois: 6, tva: synchro?.lireConfig()?.tva ?? 0.2 });

  function nav() {
    ["tabs", "mobileTabs"].forEach(id => {
      document.getElementById(id).innerHTML = pages.map((p, i) =>
        '<button data-page="' + p + '" class="' + (p === current ? "active" : "") + '">' +
        (id === "mobileTabs" ? "<b>" + icons[i] + "</b>" : "") + p + "</button>"
      ).join("");
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => { current = button.dataset.page; render(); });
    });
  }

  function heading(title, sub, action = "") {
    return '<div class="section-head"><div><h2>' + title + '</h2><span>' + sub + "</span></div>" + action + "</div>";
  }

  function dashboard(v) {
    const d = v.tableauDeBord;
    const mois = d.jehParMois || [];
    const max = Math.max(1, ...mois.map(m => m.jeh));
    const percent = d.caSigne > 0 ? Math.round(d.encaisse / d.caSigne * 100) : 0;
    const facturesOuvertes = data.factures.filter(f => f.etat !== "Payée");
    const alertesFactures = facturesOuvertes.map(f => {
      const study = data.etudes.find(e => e.id === f.etudeId);
      const client = data.clients.find(c => c.id === study?.clientId);
      return '<div class="alert"><div class="alert-icon">!</div><div><strong>Facture à encaisser · ' +
        escapeHtml(client?.raisonSociale || study?.client || "Client") + '</strong><small>' +
        escapeHtml(study?.num || "") + " · " + money(f.montant / 1.2) + " HT · " + escapeHtml(f.type || "Facture") +
        "</small></div></div>";
    }).join("");
    const alertesJeh = (d.alertesInterventions || []).map(a => {
      const intervention = data.interventions[a.index];
      const study = data.etudes.find(e => e.id === intervention?.etudeId);
      const member = data.membres.find(m => m.id === intervention?.membreId);
      return '<div class="alert"><div class="alert-icon">!</div><div><strong>Prix JEH intervenant supérieur à 300 € HT</strong><small>' +
        escapeHtml(member?.nomComplet || "Intervenant") + " · " + escapeHtml(study?.num || "Étude") +
        " · " + money(intervention?.prixJehHt) + " HT/JEH</small></div></div>";
    }).join("");
    const alerts = alertesFactures + alertesJeh;
    return '<div class="stats">' +
      '<div class="stat"><div class="label">JEH travaillées · étudiants</div><strong>' + (d.totalJehTravaillees ?? "—").toLocaleString?.("fr-FR") + '</strong><small>Interventions réalisées uniquement</small></div>' +
      '<div class="stat"><div class="label">Chiffre d’affaires signé HT</div><strong>' + money(d.caSigne) + '</strong><small>' + d.nombreEtudes + " études suivies</small></div>" +
      '<div class="stat"><div class="label">Déjà encaissé HT</div><strong>' + money(d.encaisse) + '</strong><small>' + percent + " % du CA signé</small></div>" +
      '<div class="stat"><div class="label">Reste à encaisser HT</div><strong>' + money(d.resteAEncaisser) + '</strong><small>' + facturesOuvertes.length + " facture(s) non payée(s)</small></div>" +
      "</div>" + heading("Activité", "JEH réellement travaillées · 6 derniers mois") +
      '<div class="grid"><section class="panel"><h3>Activité des étudiants</h3><div class="sub">Durées individuelles converties en JEH</div><div class="bars">' +
      mois.map((m, i) => '<div class="barcol"><b>' + m.jeh.toLocaleString("fr-FR") + '</b><div class="bar ' + (i === mois.length - 1 ? "hot" : "") +
        '" style="height:' + (m.jeh / max * 100) + '%"></div><small>' + escapeHtml(m.mois.slice(5)) + "</small></div>").join("") +
      '</div></section><section class="panel"><h3>Encaissement</h3><div class="sub">Part du CA signé déjà encaissée</div><div class="ring-wrap"><div class="ring" style="background:conic-gradient(var(--pink) 0 ' +
      percent + '%,#f4eaf0 ' + percent + '% 100%)"></div><div class="ring-info"><strong>' + money(d.encaisse) + '</strong><small>sur ' + money(d.caSigne) +
      ' HT signés</small></div></div><div class="sub">' + money(d.resteAEncaisser) + " HT restent à encaisser</div></section></div>" +
      heading("À surveiller", "Factures et suivis en cours") +
      '<section class="panel">' + (alerts || '<div class="empty">Aucune facture en attente.</div>') + "</section>";
  }

  function studies(v) {
    const rows = v.listes.etudes.filter(s => [s.num, s.clientLibelle, s.statut].join(" ").toLowerCase().includes(recherche.toLowerCase()));
    return heading("Études", data.etudes.length + " études",
      '<div class="toolbar"><input class="search" id="search" placeholder="Rechercher une étude…" value="' + escapeHtml(recherche) +
      '"><button class="action" id="addStudy">＋ Ajouter</button></div>') +
      '<section class="listbox rows">' + (rows.map(s => '<div class="item"><div class="item-main"><strong>' + escapeHtml(s.num) + " · " + escapeHtml(s.clientLibelle) +
        '</strong><small>' + escapeHtml(s.date) + " · " + s.factures.length + ' facture(s)</small></div><span class="pill ' +
        (s.statut === "Archivée" ? "green" : s.statut === "Devis envoyé" ? "pink" : "") + '">' + escapeHtml(s.statut) +
        '</span><div class="amount">' + money(s.montant / 1.2) + " HT</div></div>").join("") || '<div class="empty">Aucune étude trouvée.</div>') + "</section>";
  }

  function finances(v) {
    const d = v.tableauDeBord;
    return [
      '<div class="stats">',
      '<div class="stat"><div class="label">Facturé HT</div><strong>' + money(d.montantFacture) + '</strong><small>' + data.factures.length + ' factures</small></div>',
      '<div class="stat"><div class="label">Encaissé HT</div><strong>' + money(d.encaisse) + '</strong><small>Factures payées</small></div>',
      '<div class="stat"><div class="label">En attente HT</div><strong>' + money(d.resteAEncaisser) + '</strong><small>Factures non payées</small></div>',
      '<div class="stat"><div class="label">À facturer HT</div><strong>' + money(Math.max(0, d.caSigne - d.montantFacture)) + '</strong><small>CA signé moins facturé</small></div>',
      '</div>',
      heading("Factures", "Touchez une facture pour la marquer payée ou non payée"),
      '<section class="listbox rows">',
      v.listes.factures.map(f =>
        '<button class="item invoice-button" data-invoice="' + f.id + '" type="button">' +
        '<div class="item-main"><strong>' + escapeHtml(f.type || "Facture") + ' · ' + escapeHtml(f.etudeLibelle) + '</strong>' +
        '<small>' + escapeHtml(f.etat) + '</small></div>' +
        '<span class="pill ' + (f.etat === "Payée" ? "green" : "pink") + '">' +
        (f.etat === "Payée" ? "Payée" : "À encaisser") + '</span>' +
        '<div class="amount">' + money(f.montant / 1.2) + ' HT</div></button>'
      ).join(""),
      '</section>'
    ].join("");
  }

  function team(v) {
    const totals = new Map(v.tableauDeBord.jehParMembre.map(x => [x.membreId, x.jeh]));
    const bvTotal = data.lignesBV.reduce((sum, l) => sum + Number(l.jeh), 0);
    return heading("Équipe", "JEH réellement travaillées par étudiant") +
      '<section class="listbox rows">' + v.listes.membres.map(m => '<div class="item"><div class="mark" style="width:36px;height:36px;border-radius:50%;font-size:12px">' +
        escapeHtml(m.libelle.split(" ").map(x => x[0]).join("").slice(0, 2)) + '</div><div class="item-main"><strong>' + escapeHtml(m.libelle) +
        '</strong><small>' + escapeHtml(m.role || "Membre") + '</small></div><div class="amount">' +
        ((totals.get(m.id) || 0).toLocaleString("fr-FR")) + " JEH</div></div>").join("") +
      '</section><div class="section-head"><h2>Bulletins de versement</h2><span>' + data.bvs.length + " BV · " +
      bvTotal.toLocaleString("fr-FR") + " JEH enregistrées</span></div>";
  }

  function settings() {
    const e = etatSynchro;
    return heading("Réglages", "Connexion et synchronisation") +
      '<section class="listbox rows"><div class="item"><div class="item-main"><strong>Serveur</strong><small>' + escapeHtml(connexion?.url ? "Connecté" : "Non connecté") + '</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Données affichées</strong><small>' + (e.source === "serveur" ? "À jour avec le serveur" : e.source === "cache" ? "Dernière version gardée sur cet appareil (hors ligne)" : "Aucune") + '</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Modifications en attente d’envoi</strong><small>' + e.enAttente + '</small></div><button class="ghost action" id="syncNow">Synchroniser</button></div>' +
      '<div class="item"><div class="item-main"><strong>Taux de TVA</strong><small>' + Math.round((synchro?.lireConfig()?.tva ?? 0.2) * 100) + ' %</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Se déconnecter de cet appareil</strong><small>Efface l’adresse, le jeton et les données gardées sur ce téléphone</small></div><button class="ghost action" id="logout">Déconnexion</button></div></section>';
  }

  function ouvrirAjoutEtude() {
    const clients = data.clients.map(c => '<option value="' + c.id + '">' + escapeHtml(c.raisonSociale) + "</option>").join("");
    const dialog = document.createElement("dialog");
    dialog.className = "study-dialog";
    dialog.innerHTML = '<form method="dialog" id="studyForm"><div class="section-head"><h2>Nouvelle étude</h2><button class="ghost close-dialog" value="cancel" aria-label="Fermer">×</button></div>' +
      '<label>Client<select name="clientId" required>' + clients + '</select></label>' +
      '<label>Intitulé / numéro<input name="num" required maxlength="80" placeholder="HAC-2026-022"></label>' +
      '<label>Montant TTC (€)<input name="montant" type="number" min="0" step="0.01" required></label>' +
      '<label>Statut<select name="statut"><option>Faisabilité</option><option>Devis envoyé</option><option>Devis signé</option><option>Convention envoyée</option><option>Convention signée</option></select></label>' +
      '<div class="dialog-actions"><button class="ghost" value="cancel">Annuler</button><button class="action" id="saveStudy" value="default">Créer l’étude</button></div></form>';
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("#studyForm").addEventListener("submit", event => {
      if (event.submitter?.id !== "saveStudy") return;
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const clientId = form.get("clientId");
      const client = data.clients.find(c => c.id === clientId);
      const numero = String(form.get("num") || "").trim();
      const montant = Number(form.get("montant"));
      if (!client || !numero || !Number.isFinite(montant) || montant < 0) return;
      const id = nouvelId("etude");
      const prepared = preparerAjout({
        etat: data,
        collection: "etudes",
        donnees: {
          clientId,
          client: client.raisonSociale,
          num: numero,
          date: aujourdHui(),
          statut: form.get("statut"),
          montant,
          jeh: null,
        },
        creerId: () => id,
      });
      executer(prepared).then(ok => { if (ok) { dialog.close(); current = "Études"; render(); } });
    });
    dialog.showModal();
  }

  function render() {
    const v = view();
    nav();
    banniere();
    const content = document.getElementById("content");
    if (!v.valide) {
      content.innerHTML = '<section class="panel"><h2>Données incohérentes</h2><p>Les indicateurs sont masqués pour éviter un résultat trompeur.</p><ul>' +
        v.anomalies.map(a => "<li>" + escapeHtml(a.raison || a) + "</li>").join("") + "</ul></section>";
      return;
    }
    content.innerHTML = ({
      Accueil: () => dashboard(v),
      Études: () => studies(v),
      Finances: () => finances(v),
      Équipe: () => team(v),
      Réglages: settings,
    })[current]();
    document.getElementById("syncNow")?.addEventListener("click", () => synchroniser());
    document.getElementById("logout")?.addEventListener("click", deconnecter);
    const search = document.getElementById("search");
    if (search) search.addEventListener("input", () => { recherche = search.value; const pos = search.selectionStart; render(); const next = document.getElementById("search"); next?.focus(); next?.setSelectionRange(pos, pos); });
    document.getElementById("addStudy")?.addEventListener("click", ouvrirAjoutEtude);
    document.querySelectorAll("[data-invoice]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.invoice;
      const invoice = data.factures.find(f => f.id === id);
      const prepared = preparerModification({
        etat: data,
        collection: "factures",
        id,
        modifications: { etat: invoice.etat === "Payée" ? "Émise" : "Payée" },
      });
      executer(prepared).then(render);
    }));
  }

  // ---- Synchronisation ----
  async function majStatut() { if (synchro) etatSynchro = await synchro.statut(); }
  function banniere() {
    const el = document.getElementById("syncBanner");
    const e = { ...etatSynchro, blocage: etatSynchro.blocage?.code === "NETWORK_ERROR" ? null : etatSynchro.blocage }; // hors ligne = simple attente
    if (e.blocage?.code === "VERSION_CONFLICT") {
      el.className = "sync conflict";
      el.innerHTML = "Quelqu’un a modifié la même fiche entre-temps. Vos modifications en attente n’ont pas été envoyées. " +
        '<button class="action" id="resolve">Reprendre la version à jour</button>';
      document.getElementById("resolve").onclick = async () => {
        if (!confirm("Les modifications non envoyées seront abandonnées. Continuer ?")) return;
        await synchro.abandonnerEtRecharger(); data = synchro.lireEtat(); await majStatut(); render();
      };
    } else if (e.blocage) {
      el.className = "sync warn"; el.textContent = "Synchronisation interrompue (" + e.blocage.code + "). Réessayez avec « Synchroniser » dans Réglages.";
    } else if (e.enAttente > 0) {
      el.className = "sync warn"; el.textContent = e.enAttente + " modification(s) gardée(s) sur ce téléphone, envoi dès le retour du réseau.";
    } else if (e.source === "cache") {
      el.className = "sync warn"; el.textContent = "Hors ligne : dernière version connue affichée.";
    } else { el.className = "sync hidden"; el.textContent = ""; }
  }
  async function executer(prepared) {
    if (!prepared.valide) { alert(prepared.anomalies.map(a => a.raison || a).join("\n")); return false; }
    const r = await synchro.executer(prepared.commande);
    if (!r.valide) { alert(r.anomalies.map(a => a.raison || a).join("\n")); return false; }
    data = synchro.lireEtat(); await majStatut(); return true;
  }
  async function synchroniser() {
    try { await synchro.synchroniser(); } catch (e) { /* hors ligne : on garde l'état local */ }
    data = synchro.lireEtat(); await majStatut(); render();
  }
  function deconnecter() {
    if (!confirm("Déconnecter cet appareil ? Les modifications non envoyées seront perdues.")) return;
    Object.keys(localStorage).filter(k => k.startsWith("hac.v3.")).forEach(k => localStorage.removeItem(k));
    location.reload();
  }
  async function demarrer() {
    const client = creerClientApiV3({ transport: transportFetch(connexion.url), obtenirToken: () => connexion.token });
    synchro = creerSynchro({ client, stockage: stockageNavigateur(), creerOpId: () => nouvelId("op") });
    try { etatSynchro = await synchro.demarrer(); }
    catch (e) {
      if (e.code === "AUTH_INVALID" || e.code === "AUTH_REQUIRED") { localStorage.removeItem(CONN); afficherConnexion("Jeton refusé par le serveur."); return; }
      afficherConnexion("Connexion impossible : " + (e.message || e.code)); return;
    }
    data = synchro.lireEtat();
    document.getElementById("login").classList.add("hidden");
    render();
    window.addEventListener("online", synchroniser);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) synchroniser(); });
  }
  function afficherConnexion(message) {
    const box = document.getElementById("login");
    box.classList.remove("hidden");
    document.getElementById("loginMsg").textContent = message || "";
    document.getElementById("loginForm").onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const url = String(f.get("url") || "").trim(), token = String(f.get("token") || "").trim();
      if (!/^https:\/\/script\.google\.com\//.test(url)) { document.getElementById("loginMsg").textContent = "L’adresse doit commencer par https://script.google.com/"; return; }
      if (!token) return;
      connexion = { url, token };
      localStorage.setItem(CONN, JSON.stringify(connexion));
      demarrer();
    };
  }

  document.getElementById("quickAdd").addEventListener("click", () => { current = "Études"; render(); ouvrirAjoutEtude(); });
  if (connexion?.url && connexion?.token) demarrer(); else afficherConnexion();
})();
