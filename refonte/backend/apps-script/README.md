# Serveur Apps Script HAC — API v3 (candidat)

`Code.gs` est le vrai serveur Google Apps Script du contrat [`../contrat-api-v3.md`](../contrat-api-v3.md).
**Il n'est pas déployé.** Il ne doit être installé que sur une **copie** du tableur, dans un projet Apps Script de test.

## Ce qu'il garantit

- Enveloppe v3 `{ ok, apiVersion, data, meta, error }` et codes d'erreur du contrat.
- Jetons individuels : le serveur ne garde que l'empreinte SHA-256 (propriété `TOKENS`), révocation par membre.
- Versions optimistes, `VERSION_CONFLICT` sans écrasement, suppression logique (`_deleted`), `temps` en lecture seule.
- Relations vérifiées : facture → étude ; intervention → étude + membre ; ligne de BV → BV + membre.
- Idempotence **durable** (feuille `Journal`) et **récupérable après panne** : Journal `pending` → fiche écrite avec `_opId` → Journal `committed`. Une panne entre deux écritures est résolue au rejeu ou au prochain accès à la fiche ; une écriture n'est jamais appliquée deux fois.
- Clés en doublon et lignes illisibles jamais publiées ni écrasées ; `mettreEnQuarantaine(collection, id)` pour réparer.
- Taille mesurée en octets UTF-8 ; aucun tableur créé en silence ; aucun jeton ni donnée dans les journaux.

## Tests

`simulateur.js` exécute le vrai `Code.gs` dans Node avec de faux services Google.

- `code-gs.test.js` rejoue **contre Code.gs** les suites écrites pour le faux serveur (`mock-serveur-v3`, `integration-v3`, `file-hors-ligne`) : 33 tests.
- `code-gs-robustesse.test.js` : pannes entre écritures, doublons, corruption, jetons, configuration : 10 tests.

Ces tests sont simulés : ils ne remplacent pas un essai sur un vrai projet Apps Script (quotas, temps de réponse, concurrence réelle).

## Installation sur une copie (étapes pour plus tard)

1. Copier le tableur de données → noter l'identifiant de la **copie**.
2. Nouveau projet Apps Script → coller `Code.gs`.
3. Propriétés du script : `SSID` = identifiant de la copie. Créer les feuilles `Données` (déjà présente), `Journal` et `Quarantaine` avec leurs en-têtes.
4. Générer chaque jeton hors d'Apps Script (console du navigateur, `crypto.getRandomValues`), puis `enregistrerJeton('membre', '<empreinte sha256>')` depuis l'éditeur.
5. Déployer en application Web (exécuter en tant que : moi ; accès : tout le monde — le jeton fait le contrôle d'accès).
