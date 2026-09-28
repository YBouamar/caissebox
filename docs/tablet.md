# Application tablette

Application Android (React Native, Expo SDK 57) pour tablettes 10" en paysage. Elle fait toute la caisse **sans internet** : la base locale est la référence pendant le service, le serveur est rattrapé dès que le réseau revient.

## Organisation du code

```
apps/tablet
├─ src/core/            logique de caisse, sans React Native (testée sous Node)
│  ├─ sql.ts            accès SQLite sérialisé + schéma local
│  ├─ store.ts          données en mémoire + SQLite, boîte d'envoi atomique
│  ├─ api.ts            client HTTP de la tablette (jeton renouvelé tout seul)
│  ├─ sync.ts           moteur de synchronisation (push, pull, instantané, rejets)
│  ├─ pos.ts            règles de caisse : journée, sessions, tickets, envoi, paiements, rapports
│  ├─ printing.ts       file d'impression persistante, par imprimante
│  └─ caisse.ts         assemblage
├─ src/services/        branchements Android : SQLCipher, coffre SecureStore, impression native
├─ src/ui/              composants (thème des maquettes, pavés, validation manager…)
├─ src/app/             écrans (Expo Router)
├─ modules/caissebox-printer/   module natif Kotlin : ESC/POS en TCP 9100 et Bluetooth SPP
└─ test/                parcours complet de deux tablettes contre la vraie API
```

## Écrans

| Écran | Rôle |
|---|---|
| Enrôlement | premier démarrage : adresse du serveur, identifiant et secret donnés par la console |
| Connexion | « Qui êtes-vous ? » puis PIN à 4 chiffres (vérifié hors ligne) ; verrouillage après 5 min d'inactivité ou mise en veille |
| Salle | plan de la zone, tables libres ou occupées (serveur, couverts, montant), ticket comptoir |
| Commande | familles, recherche, grille d'articles, options et menus composés, ticket en cours, envoi en préparation, remise, addition, changement de table, fusion, client |
| Paiement | tout, par articles ou en parts égales ; espèces avec rendu, carte, ardoise (client identifié, plafond), titre-restaurant ; plusieurs paiements par ticket |
| À emporter | commandes comptoir et à emporter avec numéro d'appel et nom du client |
| Tickets | tickets du jour, détail, duplicata numéroté |
| Caisse | ouverture de journée (manager, fond de caisse), session de caisse, sorties et apports, tiroir sans vente, rapport X, clôture de session (comptage à l'aveugle, écart motivé), clôture de journée avec impression du Z |
| Clients | soldes d'ardoise, règlement en caisse (en espèces, l'apport est enregistré pour que le tiroir tombe juste) |
| Plus | état de la synchro et refus du serveur, impressions en échec (réessayer, rediriger, abandonner), test des imprimantes, appareils Bluetooth appairés, informations du poste, réinitialisation |

Toute action réservée (ouverture et clôture de journée, annulation après envoi, offert, remise au-delà de la limite du rôle, tiroir sans vente, duplicata sans droit) ouvre la fenêtre **Validation manager** : choix du manager, PIN, puis motif quand il est exigé. L'action est tracée dans le journal d'audit.

## Données locales

- **SQLCipher** : la base est chiffrée ; la clé (256 bits) est générée au premier lancement et rangée dans le coffre Android.
- Les identifiants d'enrôlement sont aussi dans le coffre, jamais dans la base.
- Les lignes utiles (catalogue, salle, équipe, journée en cours) sont gardées en mémoire ; les journées closes depuis plus de 36 h sont oubliées localement (le serveur garde tout).
- Chaque écriture met à jour la ligne **et** ajoute l'opération à la boîte d'envoi dans la même transaction. Les écritures sont sérialisées : pas de mise à jour perdue, pas de numéro de séquence en double.

## Synchronisation

Voir [sync-protocol.md](sync-protocol.md). Côté tablette :

1. **Push** toutes les 15 s et 0,4 s après chaque écriture, par lots de 200.
2. Un **rejet métier** (paiement en double sur deux tablettes hors ligne, par exemple) est affiché, gardé dans « Plus », et la ligne concernée est **relue sur le serveur** (`POST /sync/fetch`) pour que la tablette ne garde pas une version refusée.
3. `SEQUENCE_STALE` (réinstallation) ou `SEQUENCE_GAP` : la tablette renumérote ses opérations en attente et renvoie. Les `op_id` ne changent pas, donc rien n'est jamais appliqué deux fois.
4. **Pull** ensuite ; une ligne qui a encore des opérations locales en attente n'est pas écrasée.
5. Au premier démarrage, **instantané** : il donne aussi le dernier numéro de séquence, le dernier numéro de ticket de la tablette et le dernier Z, pour reprendre sans conflit après une réinstallation.

Numéros de ticket : préfixe du poste tiré du nom donné dans la console (« Caisse 1 » → `C1`, « Serveur 2 » → `S2`) suivi d'un compteur continu (`C1-0147`).

## Impression

- Les tickets (client, addition, duplicata, bons de préparation et d'annulation, rapports X et Z, test) sont mis en forme en ESC/POS par `@caissebox/shared` (58 ou 80 mm, accents en CP858), puis envoyés en octets bruts.
- Le module natif `caissebox-printer` ne fait que le transport : **Wi-Fi** en socket TCP (port 9100) et **Bluetooth** en profil série SPP vers une imprimante appairée dans Android. L'autorisation Bluetooth est demandée à la première impression.
- La **file d'impression** est persistante : un ticket n'est jamais perdu, chaque imprimante est servie dans l'ordre, une panne n'en bloque pas une autre. Après 3 échecs, le travail passe en échec et l'en-tête le signale ; on peut réessayer ou le rediriger vers une autre imprimante.
- Routage des bons : imprimante propre à l'article, sinon celle de sa famille ; un menu envoie chaque composant vers l'imprimante de sa famille.
- Le tiroir-caisse s'ouvre par l'imprimante qui le porte (impulsion ESC p), à chaque encaissement en espèces.

## Développer

```bash
pnpm install
pnpm --filter @caissebox/shared build

# Tests : parcours complet de deux tablettes contre une API démarrée
TEST_API_URL=http://localhost:3000 TEST_OPERATOR_PASSWORD=... pnpm --filter @caissebox/tablet test

# Vérifications
cd apps/tablet && npx tsc --noEmit && npx expo-doctor
```

**Aperçu web** (démonstration commerciale, contrôle visuel des écrans) : `npx expo start --web`. La base y est en mémoire (sql.js) et l'impression est simulée ; l'API doit autoriser l'origine du navigateur (`CORS_ORIGIN`).

Le module d'impression et SQLCipher sont du code natif : l'application ne tourne pas dans Expo Go. Pour une tablette de développement branchée en USB : `npx expo run:android`.

## Construire l'APK

```bash
cd apps/tablet
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# APK : android/app/build/outputs/apk/release/app-release.apk
```

Avant la mise en production, remplacer la signature de démonstration par une clé de publication BACYBRAINS (`android/app/build.gradle`, `signingConfigs.release`) ou passer par EAS Build. L'APK est ensuite déployé sur le parc par Headwind MDM (mode kiosque, mises à jour).

## Limites connues de cette version

- Pas encore de lecture de QR code à l'enrôlement (saisie de l'identifiant et du secret).
- L'état « addition demandée » du plan de salle et le transfert d'une partie des lignes vers une autre table ne sont pas encore faits (on peut déplacer ou fusionner un ticket entier).
- Le stock n'est pas affiché sur la tablette : il est décompté par le serveur à l'encaissement.
