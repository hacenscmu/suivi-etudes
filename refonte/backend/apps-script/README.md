# Serveur Apps Script HAC — API v3 (candidat)

`Code.gs` est le vrai serveur Google Apps Script du contrat [`../contrat-api-v3.md`](../contrat-api-v3.md).
**Il n'est pas déployé.** Il ne doit être installé que sur une **copie** du tableur, dans un projet Apps Script de test.

## Ce qu'il garantit

- Enveloppe v3 `{ ok, apiVersion, data, meta, error }` et codes d'erreur du contrat.
- Jetons individuels : le serveur ne garde que l'empreinte SHA-256 (propriété `TOKENS`). Les rôles d'accès sont distincts du rôle fonctionnel dans la fiche membre : `Membre` (tous droits) ou `Salarie` (lecture personnelle seule).\n- `adminAcces` détecte les fiches membres sans accès et crée un code salarié aléatoire de 8 caractères maximum, affiché une seule fois à l'administrateur. Les codes ne sont jamais conservés en clair. Le serveur filtre les données salarié et bloque ses écritures ; les actions de gestion des accès sont réservées aux membres. Le dernier compte Membre ne peut pas être rétrogradé ou désactivé.
- Versions optimistes, `VERSION_CONFLICT` sans écrasement, suppression logique (`_deleted`), `temps` en lecture seule, suppression parent refusée si des fiches actives le référencent.
- Validation des champs métier principaux : études, factures, interventions, lignes de BV, clients, membres et formations ; les relations facture → étude, intervention → étude + membre et ligne de BV → BV + membre sont vérifiées.
- Idempotence **durable** (feuille `Journal`) et **récupérable après panne** : Journal `pending` → fiche écrite avec `_opId` → Journal `committed`. Une panne entre deux écritures est résolue au rejeu ou au prochain accès à la fiche ; une écriture n'est jamais appliquée deux fois.
- Clés en doublon et lignes illisibles jamais publiées ni écrasées ; `mettreEnQuarantaine(collection, id)` pour réparer.
- Taille mesurée en octets UTF-8 ; aucun tableur créé en silence ; aucun jeton ni donnée dans les journaux.

## Tests

`simulateur.js` exécute le vrai `Code.gs` dans Node avec de faux services Google.

- `code-gs.test.js` rejoue **contre Code.gs** les suites complètes du faux serveur, de l’intégration client/serveur et de la file hors ligne.
- `code-gs-robustesse.test.js` : pannes entre écritures, doublons, corruption, jetons, configuration, tombstones privés et dépendances à la suppression.

Ces tests sont simulés : ils ne remplacent pas un essai sur un vrai projet Apps Script (quotas, temps de réponse, concurrence réelle).

## Installation sur une copie (étapes pour plus tard)

1. Copier le tableur de données → noter l'identifiant de la **copie**.
2. Nouveau projet Apps Script → coller `Code.gs`.
3. Propriétés du script : `SSID` = identifiant de la copie. Créer les feuilles `Données` (déjà présente), `Journal` et `Quarantaine` avec leurs en-têtes.
4. Créer le premier accès administrateur pour un identifiant stable de la collection `membres` : générer un jeton fort hors d'Apps Script, calculer son SHA-256, puis exécuter `enregistrerJeton('membre_XXXXXXXX', '<empreinte sha256>', 'Membre')` depuis l'éditeur. Ne jamais enregistrer le jeton en clair dans les propriétés du script.
5. Déployer en application Web (exécuter en tant que : moi ; accès : tout le monde — le jeton fait le contrôle d'accès).



## Signalements JEH

La collection `signalementsJEH` est stockée dans la feuille `Données` au même format `collection | id | json` ; aucune quatrième feuille métier n'est nécessaire. Elle est en lecture seule via `save` / `delete` et n'est modifiée que par les actions serveur dédiées :

- `signalerJEH` : accès Salarié uniquement ; le serveur impose l'identité et vérifie l'association à l'étude.
- `traiterSignalementJEH` : accès Membre uniquement ; création de l'intervention « Pas payé » ou refus du signalement.
- `loadAll` filtre les signalements du salarié et expose la file complète aux Membres.

## Recette isolée avant tout déploiement

La copie doit contenir la feuille `Données` avec ses en-têtes `collection | id | json`. Ajouter les feuilles `Journal` avec `opId | empreinte | reponse | date | état | collection | id | membre` (les colonnes de réserve facultatives du simulateur ne sont pas requises) et `Quarantaine` avec `date | ligne d'origine | collection | id | json brut`.

Sur le projet Apps Script rattaché à la copie uniquement :

1. Vérifier l'identifiant de la copie dans `SSID` avant toute action.
2. Créer `TOKENS` via `enregistrerJeton` pour un identifiant membre réellement présent dans la copie ; enregistrer uniquement l'empreinte SHA-256 d'un jeton administrateur fort. Ne jamais mettre le jeton en clair dans les propriétés.
3. Initialiser `REVISION` à `0` si la propriété n'existe pas.
4. Exécuter d'abord des lectures (`doGet`, `ping`, `loadAll`) et vérifier qu'aucune donnée hors copie n'est touchée.
5. Tester les écritures et les signalements avec des données fictives, vérifier le journal, les versions, le refus des écritures Salarié et la création d'une intervention unique.
6. Vérifier les permissions du projet et les autorisations Google avant d'envisager un déploiement Web App.

**Blocage d'accès actuel :** le connecteur Google Drive/Sheets n'est pas disponible pour cette session (désactivé par l'administrateur). La recette réelle ne peut donc pas être lancée depuis ChatGPT pour le moment. Ne pas remplacer cette étape par un test sur le classeur de production.
