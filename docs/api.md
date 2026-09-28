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
| GET | `/bo/me` | compte et nom du client |
| GET | `/bo/establishments` | établissements du client |
| PATCH | `/bo/establishments/:id` | nom, adresse, en-tête et pied de ticket, mode de service, envoi en préparation |
| GET | `/bo/dashboard?establishmentId` | journée en cours ou dernière journée, 14 derniers jours, état des tablettes |
| GET | `/bo/reports/days?establishmentId` | liste des journées avec CA et nombre de tickets |
| GET | `/bo/reports/days/:id` | rapport X ou Z : TVA par taux, modes de paiement, serveurs, sessions de caisse, meilleures ventes, activité par heure |
| GET | `/bo/roles` | rôles et droits |
| PATCH | `/bo/roles/:id` | `{ permissions }` (le rôle Manager garde tous les droits) |
| GET | `/bo/staff` | personnel |
| POST | `/bo/staff` | `{ fullName, roleId, pin, establishmentIds, initials? }` ; PIN unique parmi le personnel actif |
| PATCH | `/bo/staff/:id` | nom, initiales, rôle, actif, établissements |
| PUT | `/bo/staff/:id/pin` | `{ pin }` |
| GET | `/bo/customers` | clients avec solde d'ardoise |
| GET | `/bo/customers/:id/ledger` | historique de l'ardoise |
| POST | `/bo/customers/:id/settlements` | `{ amountCents, paymentMethodId, note? }` : règlement saisi au back-office |

### Catalogue, salle et paramètres : `/bo/r/:ressource`

`GET` (liste, filtres en query string), `POST` (création), `PATCH /:id` (modification), `DELETE /:id` (tables de liaison seulement ; le reste s'archive ou se désactive).

| Ressource | Table | Filtres |
|---|---|---|
| `tax-rates` | taux de TVA (un seul par défaut) | |
| `printers` | imprimantes Bluetooth ou Wi-Fi | `establishment_id` |
| `families` | familles (couleur, imprimante, TVA) | `establishment_id`, `archived` |
| `items` | articles et menus | `family_id`, `kind`, `archived` |
| `option-groups`, `options` | groupes d'options et suppléments | `group_id` |
| `item-option-groups` | options d'un article (suppression possible) | `item_id` |
| `menu-steps`, `menu-step-choices` | étapes et choix d'un menu composé (suppression possible) | `menu_item_id`, `step_id` |
| `zones`, `tables` | salle | `establishment_id`, `zone_id` |
| `reason-codes` | motifs | `category` |
| `payment-methods` | modes de paiement (ajout de type « autre » seulement) | |
| `customers` | clients | `archived` |

Chaque identifiant référencé (famille, imprimante, zone…) est vérifié sous RLS : impossible de rattacher un élément à une donnée d'un autre client.

## Console BACYBRAINS (jeton `operator`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/console/tenants` | clients avec nombre d'établissements et de tablettes |
| GET | `/console/tenants/:id` | fiche, établissements, gérants, matériel |
| GET | `/console/devices?status` | parc matériel |
| POST | `/console/tenants` | création d'un client avec paramètres par défaut (rôles, TVA 10 % et 20 %, 4 modes de paiement, motifs, « Client divers », salle) |
| POST | `/console/tenants/:id/establishments` | nouvel établissement |
| POST | `/console/devices` | entrée d'un matériel dans le parc |
| POST | `/console/devices/:id/deploy` | affectation ; pour une tablette, renvoie le secret une seule fois |
| POST | `/console/devices/:id/retire` | panne, perte, retour en stock : le secret est effacé |
| POST | `/console/establishments/:id/access` | niveau de blocage pour impayé |

## Divers

`GET /health` : état de l'API et de la base.
