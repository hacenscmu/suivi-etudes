# Contrat cible du backend HAC — proposition v3

> Document de conception uniquement. Il ne modifie ni le serveur Apps Script actuel, ni le candidat Claude, ni les données de production.

## 1. Décisions structurantes

- Le serveur v11 reste la référence de compatibilité tant que la bascule n'est pas validée.
- Le nouveau client et le nouveau serveur doivent partager une version de contrat explicite (`apiVersion: 3`).
- Le format cible de réponse est toujours enveloppé : `{ ok, apiVersion, data, meta, error }`. Le client de migration pourra lire temporairement l'ancien `loadAll` à racine directe, mais le nouveau serveur ne doit pas mélanger les deux formes.
- Le contrat doit accepter l'ensemble des collections nécessaires : `etudes`, `clients`, `membres`, `factures`, `bvs`, `lignesBV`, `temps` (compatibilité), `formation`, `config`, `appareils`. Une collection inconnue est refusée explicitement, pas ignorée.
- Les droits restent identiques pour tous les membres dans la première version : pas de permission cachée par rôle.
- Une authentification absente ou vide doit faire échouer toute opération protégée. Aucun secret ne doit être renvoyé dans `loadAll`, les erreurs ou les journaux.

## 2. Enveloppe commune

Chaque réponse doit exposer :

| Champ | Règle |
| --- | --- |
| `ok` | booléen obligatoire |
| `apiVersion` | entier, vaut `3` |
| `data` | résultat métier, présent en cas de succès |
| `meta` | métadonnées non sensibles : révision, pagination éventuelle |
| `error.code` | code stable exploitable par le client en cas d'échec |
| `error.message` | message lisible, sans secret ni trace interne |

Les erreurs métier doivent rester identifiables même si Apps Script renvoie un statut HTTP générique. Le client se fonde sur `ok` et `error.code`, pas uniquement sur le statut HTTP.

Codes minimaux : `AUTH_REQUIRED`, `AUTH_INVALID`, `INVALID_REQUEST`, `UNKNOWN_COLLECTION`, `NOT_FOUND`, `VERSION_CONFLICT`, `DUPLICATE_OPERATION`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`.

## 3. Authentification

- Le contrat v3 utilise un champ unique `token` dans les requêtes protégées.
- Un adaptateur côté client peut convertir l'ancien champ v11 `pass` en `token` pendant une transition contrôlée.
- Le serveur refuse un token absent, vide ou invalide. Aucun mode « mot de passe vide = accès autorisé ».
- Les comparaisons de secrets doivent être faites côté serveur ; le token n'est jamais stocké dans les fiches métier ni renvoyé au client.
- Une rotation de token doit pouvoir être faite sans modifier les données.

## 4. Opérations

### `ping`

Vérifie la disponibilité et renvoie uniquement la version de l'API, l'état d'authentification non sensible et la révision du schéma. Ne renvoie aucune donnée métier.

### `loadAll`

Renvoie les collections autorisées sous une forme stable :

```json
{
  "ok": true,
  "apiVersion": 3,
  "data": {
    "etudes": { "id-etude": { "id": "id-etude", "_v": 4 } },
    "clients": {},
    "membres": {},
    "factures": {},
    "bvs": {},
    "lignesBV": {},
    "temps": {},
    "formation": {},
    "config": {},
    "appareils": {}
  },
  "meta": { "schemaVersion": 3, "revision": "revision-serveur" }
}
```

Les clés ci-dessus sont illustratives : le serveur doit conserver les données existantes et ne pas remplacer une collection absente par une collection vide lors d'une écriture partielle.

### `save`

Requête cible :

```json
{
  "action": "save",
  "apiVersion": 3,
  "token": "…",
  "collection": "factures",
  "id": "identifiant-stable",
  "record": { "id": "identifiant-stable" },
  "opId": "uuid-operation",
  "expectedVersion": 4
}
```

- `id` doit être identique à `record.id`.
- `opId` est obligatoire et unique par opération logique.
- `expectedVersion` est obligatoire pour modifier une fiche existante ; création = version attendue explicitement égale à 0.
- Le serveur vérifie la version et effectue le contrôle + écriture sous verrou. Une écriture obsolète renvoie `VERSION_CONFLICT` avec la version actuelle, sans écraser les données.
- Le serveur incrémente `_v` et conserve des métadonnées de provenance telles que `_par` et `_le` sans les accepter aveuglément depuis le client.

### `delete`

- La suppression logique crée un tombstone avec identifiant, version, date et opération d'origine.
- Le tombstone est synchronisé comme une modification versionnée ; le client ne doit pas réimporter l'ancienne fiche depuis un cache hors ligne.
- La purge physique est une tâche d'administration distincte, jamais le comportement normal de l'API.

## 5. Idempotence et file hors ligne

- Chaque opération locale reçoit un `opId` stable avant son premier envoi.
- Répéter le même `opId` avec le même contenu renvoie le résultat initial sans réappliquer l'écriture.
- Réutiliser un `opId` avec un contenu différent renvoie `DUPLICATE_OPERATION`.
- Le registre d'idempotence est durable (dans le stockage serveur), pas un cache temporaire de quelques heures.
- La file locale ne retire une opération qu'après une réponse métier explicite de succès ou après arbitrage explicite d'un conflit.
- L'ordre FIFO est conservé pour une même fiche ; les opérations indépendantes peuvent être traitées séparément.
- Un conflit n'est jamais transformé automatiquement en « dernière écriture gagnante ».

## 6. Validation, taille et concurrence

- Valider côté serveur les noms de collection, les identifiants, la structure JSON, les champs obligatoires et les relations parent/enfant.
- Mesurer les limites de payload en octets UTF-8, pas en nombre de caractères JavaScript.
- Protéger lecture/écriture/version/idempotence par une stratégie de verrou cohérente. Les opérations sur une même fiche ne doivent pas pouvoir passer en parallèle sans contrôle.
- Les erreurs internes sont journalisées côté serveur sans token ni données personnelles inutiles.
- Le serveur ne doit pas faire confiance aux champs `_v`, `_par`, `_le` fournis par le client.

## 7. Compatibilité et migration

1. Sauvegarder le tableur et le script v11 ; tester la restauration sur une copie.
2. Exporter les collections v11 sans les modifier.
3. Auditer les identifiants et références ; traiter les ambiguïtés avant conversion.
4. Tester le client v3 sur une copie du backend et un jeu de données anonymisé.
5. Tester les scénarios : hors ligne, doublon d'opération, conflit de version, suppression hors ligne, reprise après fermeture, perte réseau pendant une écriture.
6. Comparer les comptes et totaux métier avant/après migration.
7. Ne basculer qu'après validation explicite ; conserver un chemin de retour vers v11.

## 8. Conditions bloquantes avant intégration

- La collection `clients` doit être réellement inscriptible.
- Le serveur doit prendre en charge les entités `bvs` et `lignesBV` nécessaires à la structure « une ligne par personne ».
- Le client et le serveur doivent partager le même nom de champ d'authentification et le même format de réponse.
- Les conflits, suppressions et répétitions d'opérations doivent être testés de bout en bout.
- Une sauvegarde restaurable et un test de retour arrière sont obligatoires.

Tant que ces conditions ne sont pas remplies, aucun module métier de la refonte ne doit écrire sur le backend de production.
