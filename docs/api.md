# API

Toutes les routes attendent et renvoient du JSON. Les routes protégées demandent `Authorization: Bearer <jeton>`.

## Authentification

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ token, role }` |
| POST | `/auth/device` | `{ deviceId, secret, appVersion? }` | `{ token, tenantId, establishmentId, accessState }` |

## Tablette (jeton `device`)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/sync/push` | envoi des opérations (voir [protocole](sync-protocol.md)) |
| GET | `/sync/pull?cursor&limit` | changements après le curseur |
| GET | `/sync/snapshot` | instantané complet |

## Back-office (jeton `owner`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/bo/establishments` | établissements du client |
| GET | `/bo/roles` | rôles et droits |
| GET | `/bo/staff` | personnel |
| POST | `/bo/staff` | `{ fullName, roleId, pin, establishmentIds, initials? }` ; PIN unique parmi le personnel actif |

## Console BACYBRAINS (jeton `operator`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/console/tenants` | clients avec nombre d'établissements et de tablettes |
| POST | `/console/tenants` | création d'un client avec paramètres par défaut (rôles, TVA 10 % et 20 %, 4 modes de paiement, motifs, « Client divers », salle) |
| POST | `/console/tenants/:id/establishments` | nouvel établissement |
| POST | `/console/devices` | entrée d'un matériel dans le parc |
| POST | `/console/devices/:id/deploy` | affectation ; pour une tablette, renvoie le secret une seule fois |
| POST | `/console/devices/:id/retire` | panne, perte, retour en stock : le secret est effacé |
| POST | `/console/establishments/:id/access` | niveau de blocage pour impayé |

## Divers

`GET /health` : état de l'API et de la base.
