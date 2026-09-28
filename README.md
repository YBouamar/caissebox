# CaisseBox

Caisse cloud pour cafés et restaurants au Maroc, proposée en location (matériel + logiciel) par BACYBRAINS.

- **Tablette Android 10"** : prise de commande, tables, emporter, encaissement, impression Bluetooth et Wi-Fi. Fonctionne sans internet et se synchronise dès que le réseau revient.
- **Back-office web** : catalogue, personnel, salle, stock, rapports.
- **Console BACYBRAINS** : clients, contrats, parc matériel, facturation des loyers, blocage progressif pour impayé.

## Contenu du dépôt

| Dossier | Rôle | État |
|---|---|---|
| `packages/shared` | Logique métier commune : montants en centimes, TVA, totaux de ticket, partage d'addition, caisse, PIN, protocole de synchronisation, tickets ESC/POS | fait, testé |
| `db/migrations` | Schéma PostgreSQL 16 : RLS par client, journal de changements, règles d'inaltérabilité | fait |
| `apps/api` | API NestJS : authentification, synchronisation, back-office (catalogue, salle, équipe, ardoises, rapports), console | fait, testé |
| `apps/backoffice` | Back-office des clients et console BACYBRAINS en Next.js | fait, testé de bout en bout |
| `infra` | Docker Compose pour le VPS (PostgreSQL, API, back-office, Caddy, sauvegardes) | fait |
| `scripts/seed-demo.mjs` | Client de démonstration avec 7 journées de ventes, créé par l'API | fait |
| `apps/tablet` | Application tablette Android (Expo) : caisse hors ligne, base chiffrée, synchronisation, impression Bluetooth et Wi-Fi | fait, testé contre l'API |

## Démarrer en local

Prérequis : Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
pnpm build

# Base locale
createdb caissebox
export DATABASE_URL=postgres://postgres@localhost:5432/caissebox
export JWT_SECRET=$(openssl rand -base64 48)
pnpm db:migrate

# Premier compte opérateur BACYBRAINS
pnpm --filter @caissebox/api create-operator ops@bacybrains.ma "Nom Prénom" "mot-de-passe-long"

# API sur le port 3000
pnpm --filter @caissebox/api start

# Back-office sur le port 3001 (dans un autre terminal)
API_URL=http://localhost:3000 pnpm --filter @caissebox/backoffice dev

# Facultatif : client de démonstration (Café Atlas, 7 journées de ventes)
OPERATOR_PASSWORD="mot-de-passe-long" node scripts/seed-demo.mjs
# puis connexion au back-office : demo@caissebox.ma / demo-caissebox
```

Le back-office sert aussi la console : un compte opérateur BACYBRAINS arrive sur `/console`, un compte gérant sur son tableau de bord.

## Tests

```bash
pnpm --filter @caissebox/shared test        # 39 tests unitaires
TEST_PG_ADMIN_URL=postgres://postgres@localhost:5432/postgres \
  pnpm --filter @caissebox/api test          # 27 tests d'intégration sur une base jetable
```

Les tests d'intégration recréent une base `caissebox_it` et déroulent un service complet : ouverture de journée, ticket, envoi en cuisine, annulation avec manager, paiement fractionné espèces et ardoise, décompte du stock, clôture de caisse, Z. Ils vérifient aussi l'idempotence, les trous de séquence, les colonnes interdites, l'isolation entre clients, le catalogue, les ardoises et les chiffres du rapport de journée (TVA, modes de paiement, serveurs).

## Mise en production (VPS Contabo)

```bash
cd infra
cp .env.example .env    # renseigner mots de passe et domaines
docker compose up -d --build
docker compose exec api node dist/db/create-operator.js ops@bacybrains.ma "Nom" "mot-de-passe-long"
```

Caddy obtient les certificats HTTPS automatiquement pour l'API, le back-office et la console. Les migrations s'appliquent au démarrage de l'API. La base est sauvegardée chaque nuit dans `infra/backups` (à recopier hors du VPS).

## Documentation

- [Architecture](docs/architecture.md)
- [Protocole de synchronisation](docs/sync-protocol.md)
- [API](docs/api.md)
- [Application tablette](docs/tablet.md)
