# Installer le serveur sécurisé (Code.gs) — à faire avec la mise en ligne de l'appli v17

Les données ne bougent pas : même Google Sheet, même feuille « Données ».
Faites ces étapes **sur ordinateur**, le même jour que la fusion de l'appli v17.

1. **Sauvegarde** : dans l'appli, Paramètres → Exporter mes données (fichier .json). Gardez-le.
2. **Ouvrir le script** : script.google.com → votre projet « Suivi des études ».
3. **Garder l'ancienne version** : copiez tout le contenu actuel de `Code.gs` dans un fichier texte (retour arrière possible).
4. **Remplacer** : effacez tout `Code.gs`, collez le contenu de `serveur/Code.gs`, puis Enregistrer (icône disquette).
5. **Le code des membres (première fois seulement)** : si un appareil est déjà connecté, ouvrez dans l'appli Paramètres → Membres et codes d'accès : le code des membres y est affiché. Sinon, dans l'éditeur, choisissez la fonction `codeMembres`, cliquez sur **Exécuter** et lisez le code dans le **Journal d'exécution**.
6. **Déployer** : Déployer → Gérer les déploiements → crayon → Version : **Nouvelle version** → Déployer. L'adresse /exec ne change pas.
7. **Dans l'appli** : Paramètres → Code d'accès de cet appareil → saisissez le code (membres : le code commun ; salariés : leur code) → Valider.

Dans l'appli (Paramètres → Membres et mots de passe, visible par les membres) :
- **Chacun son mot de passe**, membres compris. Les noms saisis dans les JEH ou la formation sont ajoutés automatiquement comme **Salarié** ; « + Ajouter une personne » permet de choisir Membre ou Salarié. Statuts : Membre (tous les droits), Salarié (ses données seulement), Sans accès. On ne supprime personne.
- **Mot de passe de départ** (8 caractères) visible par les membres pour le transmettre ; chacun le change ensuite dans ses Paramètres → Changer mon mot de passe, et il n'est alors plus visible par personne. Les membres ne peuvent pas changer le mot de passe de quelqu'un d'autre.
- **Connexion** : page « Nom + Mot de passe » (avec un œil), une seule fois par appareil ; elle est redemandée si le mot de passe change.
- **Code de secours** : l'ancien code commun des membres n'est plus affiché dans l'appli. Il reste utilisable pour dépanner (nom « Membres ») et se lit dans l'éditeur avec la fonction `codeMembres`.

Qui peut retrouver les mots de passe : les mots de passe de départ sont visibles par les membres tant qu'ils n'ont pas été changés ; le code de secours est lisible par les comptes Google qui ont accès au projet Apps Script. Rien n'est écrit dans le Google Sheet.
Retour arrière : recollez l'ancien Code.gs (étape 3) et redéployez une nouvelle version.
