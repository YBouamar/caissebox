# Protocole de synchronisation (version 1)

Développé en interne. Deux sens : la tablette **pousse** ses écritures, puis **tire** les changements du serveur.

## Montée : `POST /sync/push`

Chaque écriture locale devient une opération placée dans une boîte d'envoi :

```json
{
  "opId": "uuid unique de l'opération",
  "deviceSeq": 42,
  "entity": "order_lines",
  "entityId": "uuid de la ligne",
  "kind": "insert | patch",
  "data": { "quantity": 2 },
  "createdAt": "2026-09-28T12:30:00+01:00"
}
```

Règles :

1. `deviceSeq` est strictement croissant par tablette, sans trou. La tablette envoie ses opérations dans l'ordre, par lots de 500 au plus.
2. Le serveur les applique une par une, chacune dans un `SAVEPOINT`.
3. **Idempotence** : un `opId` déjà reçu répond `duplicate` sans rien réécrire. Renvoyer un lot après une coupure réseau est donc sans danger.
4. **Trou de séquence** : si `deviceSeq` n'est pas le suivant attendu, l'opération et toutes les suivantes du lot sont refusées avec `SEQUENCE_GAP` sans être consommées ; la tablette renvoie à partir de `lastDeviceSeq + 1`.
5. **Rejet** : une opération refusée pour une règle métier est consommée (enregistrée comme rejetée). La tablette l'affiche au manager et passe à la suite ; sinon une seule erreur bloquerait toute la file.
6. **Erreur technique** (base indisponible, interblocage) : le lot entier est annulé, la tablette réessaie plus tard.
7. Seules les colonnes listées dans `WRITE_RULES` (`packages/shared/src/sync.ts`) sont acceptées. `tenant_id`, `establishment_id` et `device_id` sont imposés par le serveur.

Réponse :

```json
{ "results": [{ "opId": "…", "deviceSeq": 42, "status": "applied" }], "lastDeviceSeq": 42 }
```

Codes de rejet : `SEQUENCE_GAP`, `SEQUENCE_STALE`, `UNKNOWN_ENTITY`, `FORBIDDEN_COLUMN`, `NOT_FOUND`, `CONFLICT`, `BUSINESS_RULE`, `INVALID`.

`SEQUENCE_STALE` : le numéro de séquence a déjà servi (tablette réinstallée). Rien n'est consommé ; la tablette renumérote à partir de `lastDeviceSeq + 1` et renvoie.

## Relecture : `POST /sync/fetch`

`{ items: [{ entity, id }] }` renvoie la version serveur de chaque ligne (ou `null` si elle n'existe pas). La tablette s'en sert après un rejet pour remplacer sa version locale.

## Descente : `GET /sync/pull?cursor=N&limit=1000`

Toute écriture en base (tablettes, back-office, console) alimente `change_log` par trigger, avec un numéro `server_seq`. La tablette demande tout ce qui suit son curseur, pour son établissement ou commun au client.

Le trigger prend un verrou consultatif par client jusqu'au `COMMIT` : un numéro n'est attribué qu'après la validation des transactions précédentes du même client. Une tablette qui lit « tout après mon curseur » ne peut donc jamais sauter une ligne validée plus tard avec un numéro plus petit.

La tablette applique les changements dans l'ordre (upsert par `id`), puis rappelle `pull` tant que `hasMore` vaut `true`. Ses propres écritures redescendent aussi : c'est la version validée par le serveur (total recalculé, écart de caisse, etc.) qui remplace la version locale.

## Instantané : `GET /sync/snapshot`

Pour une tablette neuve ou réinitialisée : données de référence complètes et données des journées encore ouvertes, lues dans une transaction `REPEATABLE READ`, avec le curseur correspondant. La réponse contient aussi `device` : dernier `device_seq` acquitté, dernier numéro de ticket de la tablette et dernier numéro de Z de l'établissement. La tablette enchaîne ensuite par des `pull` depuis ce curseur.

## Cycle conseillé côté tablette

1. Au démarrage : `snapshot` si la base locale est vide, sinon `push` puis `pull`.
2. Après chaque écriture locale : `push` immédiat si le réseau est là.
3. Toutes les 15 secondes : `push` puis `pull`.
